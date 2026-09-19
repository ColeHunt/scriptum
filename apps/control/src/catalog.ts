import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	type LessonModule,
	type LessonModuleIndexEntry,
	lessonCatalogIndexSchema,
	lessonModuleDetailSchema,
	lessonModuleSchema,
} from "@frc-scriptum/contracts";
import type { ControlConfig } from "./config";
import { ImportError } from "./imports";
import { getLogger } from "./logging";

const log = getLogger("catalog");

/**
 * The bundled catalog is baked into the code image at this path. A bundled
 * module load `cp -a`s `<IMAGE_CATALOG_DIR>/<subdir>/.` into the workspace
 * project dir inside the container — no network. (Decision 029 #1.)
 */
export const IMAGE_CATALOG_DIR = "/opt/frc-catalog";

const REMOTE_CACHE_TTL_MS = 60_000;

export type CatalogManifest = {
	modules: LessonModule[];
	error: string | null;
};

export interface CatalogSource {
	readonly kind: "remote" | "bundled";
	getManifest(): Promise<CatalogManifest>;
	resolveModule(moduleId: string): Promise<LessonModule>;
	/** Set for "remote" sources only - lets checkpoints.ts fetch a module's
	 * checkpoints/<id>/ tree on demand, the same way imports.ts fetches its
	 * modules/<id>/ tree. */
	readonly cloneUrl?: string;
	readonly branchName?: string;
}

function sortByOrder(modules: LessonModule[]): LessonModule[] {
	return [...modules].sort((a, b) => a.order - b.order);
}

/** Merges an index entry with its `module.json` detail (fetched/read by
 * `readDetail`) back into the full `LessonModule` shape. Any failure -
 * unreadable file, bad JSON, schema mismatch - is rethrown with the module
 * id attached, since a bare zod/fs error gives no clue which of N modules
 * broke the load. */
async function mergeModule(
	entry: LessonModuleIndexEntry,
	readDetail: () => Promise<unknown>,
): Promise<LessonModule> {
	let detailRaw: unknown;
	try {
		detailRaw = await readDetail();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Module "${entry.id}": ${message}`);
	}
	const parsed = lessonModuleDetailSchema.safeParse(detailRaw);
	if (!parsed.success) {
		throw new Error(
			`Module "${entry.id}": invalid module.json - ${parsed.error.message}`,
		);
	}
	return lessonModuleSchema.parse({ ...parsed.data, ...entry });
}

/**
 * Normalize a configured catalog repo (either `https://github.com/owner/repo(.git)`
 * or `owner/repo`) into its `owner` / `repo` parts.
 */
export function parseCatalogRepo(repo: string): {
	owner: string;
	repo: string;
} {
	const trimmed = repo.trim();
	const httpsMatch =
		/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(
			trimmed,
		);
	if (httpsMatch) {
		return { owner: httpsMatch[1]!, repo: httpsMatch[2]! };
	}
	const shorthandMatch =
		/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(trimmed);
	if (shorthandMatch) {
		return { owner: shorthandMatch[1]!, repo: shorthandMatch[2]! };
	}
	throw new ImportError(
		`Invalid LESSONS_CATALOG_REPO "${repo}". Expected https://github.com/owner/repo or owner/repo.`,
	);
}

export class BundledCatalogSource implements CatalogSource {
	readonly kind = "bundled" as const;

	constructor(private readonly catalogDir: string) {}

	async getManifest(): Promise<CatalogManifest> {
		const manifestPath = resolve(this.catalogDir, "modules.json");
		try {
			const raw = await readFile(manifestPath, "utf8");
			const index = lessonCatalogIndexSchema.parse(JSON.parse(raw));
			const modules = await Promise.all(
				index.modules.map((entry) =>
					mergeModule(entry, async () => {
						const detailPath = resolve(
							this.catalogDir,
							"modules-meta",
							`${entry.id}.json`,
						);
						return JSON.parse(await readFile(detailPath, "utf8"));
					}),
				),
			);
			return { modules: sortByOrder(modules), error: null };
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Unable to read catalog.";
			log.error("bundled catalog manifest unreadable", {
				manifestPath,
				err: error instanceof Error ? error : new Error(message),
			});
			return { modules: [], error: message };
		}
	}

	async resolveModule(moduleId: string): Promise<LessonModule> {
		const { modules } = await this.getManifest();
		return findModuleOrThrow(modules, moduleId);
	}
}

export class RemoteCatalogSource implements CatalogSource {
	readonly kind = "remote" as const;

	private readonly owner: string;
	private readonly repo: string;
	private cached: { modules: LessonModule[]; fetchedAt: number } | null = null;

	constructor(
		repo: string,
		private readonly branch: string,
		private readonly fetchImpl: typeof fetch = fetch,
	) {
		const parsed = parseCatalogRepo(repo);
		this.owner = parsed.owner;
		this.repo = parsed.repo;
	}

	/** The HTTPS URL used by the catalog load step's sparse shallow clone. */
	get cloneUrl(): string {
		return `https://github.com/${this.owner}/${this.repo}.git`;
	}

	get branchName(): string {
		return this.branch;
	}

	private get manifestUrl(): string {
		return `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${this.branch}/modules.json`;
	}

	private moduleDetailUrl(id: string): string {
		return `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${this.branch}/modules-meta/${id}.json`;
	}

	async getManifest(): Promise<CatalogManifest> {
		const now = Date.now();
		if (this.cached && now - this.cached.fetchedAt < REMOTE_CACHE_TTL_MS) {
			return { modules: this.cached.modules, error: null };
		}

		try {
			const response = await this.fetchImpl(this.manifestUrl);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status} fetching catalog manifest.`);
			}
			const index = lessonCatalogIndexSchema.parse(await response.json());
			// One raw-content fetch per module, in parallel - still a single
			// round trip's worth of wall-clock latency, cached for
			// REMOTE_CACHE_TTL_MS same as the index itself. See decision 051 for
			// why this doesn't use a repo clone instead.
			const modules = sortByOrder(
				await Promise.all(
					index.modules.map((entry) =>
						mergeModule(entry, async () => {
							const detailResponse = await this.fetchImpl(
								this.moduleDetailUrl(entry.id),
							);
							if (!detailResponse.ok) {
								throw new Error(
									`HTTP ${detailResponse.status} fetching module.json.`,
								);
							}
							return detailResponse.json();
						}),
					),
				),
			);
			this.cached = { modules, fetchedAt: now };
			return { modules, error: null };
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Unable to fetch catalog.";
			log.warn("remote catalog fetch failed", {
				manifestUrl: this.manifestUrl,
				err: error instanceof Error ? error : new Error(message),
			});
			// Serve last-good cached manifest on failure.
			if (this.cached) {
				return { modules: this.cached.modules, error: null };
			}
			return { modules: [], error: message };
		}
	}

	async resolveModule(moduleId: string): Promise<LessonModule> {
		const { modules } = await this.getManifest();
		return findModuleOrThrow(modules, moduleId);
	}
}

function findModuleOrThrow(
	modules: LessonModule[],
	moduleId: string,
): LessonModule {
	const found = modules.find((module) => module.id === moduleId);
	if (!found) {
		throw new ImportError(`Unknown lesson module "${moduleId}".`);
	}
	return found;
}

export function createCatalogSource(config: ControlConfig): CatalogSource {
	if (config.catalogRepo) {
		return new RemoteCatalogSource(config.catalogRepo, config.catalogBranch);
	}
	return new BundledCatalogSource(config.catalogDir);
}
