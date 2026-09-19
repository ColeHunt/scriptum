import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	BundledCatalogSource,
	createCatalogSource,
	parseCatalogRepo,
	RemoteCatalogSource,
} from "../catalog";
import type { ControlConfig } from "../config";
import { ImportError } from "../imports";
import { writeCatalogDir } from "./helpers";

const MODULES: Array<
	Record<string, unknown> & { id: string; order: number; track?: string }
> = [
	{
		id: "robot-starter",
		title: "Robot Starter",
		description: "A robot.",
		subdir: "modules/robot-starter",
		kind: "robot",
		order: 20,
	},
	{
		id: "hello-world",
		title: "Hello, World",
		description: "Plain java.",
		subdir: "modules/hello-world",
		kind: "plain-java",
		order: 10,
	},
];

async function makeBundledCatalog(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "frc-catalog-"));
	await writeCatalogDir(dir, 2, MODULES);
	return dir;
}

describe("BundledCatalogSource", () => {
	test("reads modules sorted by order", async () => {
		const dir = await makeBundledCatalog();
		try {
			const source = new BundledCatalogSource(dir);
			const { modules, error } = await source.getManifest();
			expect(error).toBeNull();
			expect(modules.map((m) => m.id)).toEqual([
				"hello-world",
				"robot-starter",
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("resolveModule finds a module and throws on unknown id", async () => {
		const dir = await makeBundledCatalog();
		try {
			const source = new BundledCatalogSource(dir);
			const module = await source.resolveModule("hello-world");
			expect(module.kind).toBe("plain-java");
			expect(module.subdir).toBe("modules/hello-world");
			await expect(source.resolveModule("nope")).rejects.toThrow(ImportError);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("surfaces an error string when the manifest is missing", async () => {
		const dir = await mkdtemp(join(tmpdir(), "frc-catalog-empty-"));
		try {
			const source = new BundledCatalogSource(dir);
			const { modules, error } = await source.getManifest();
			expect(modules).toEqual([]);
			expect(error).toBeTruthy();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("surfaces an error string when a bundled manifest has an unsafe subdir", async () => {
		const dir = await mkdtemp(join(tmpdir(), "frc-catalog-unsafe-"));
		try {
			await writeCatalogDir(dir, 2, [
				{
					id: "unsafe",
					title: "Unsafe",
					description: "A robot.",
					subdir: "../escape",
					kind: "robot",
					order: 20,
				},
			]);
			const source = new BundledCatalogSource(dir);
			const { modules, error } = await source.getManifest();
			expect(modules).toEqual([]);
			expect(error).toBeTruthy();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("parseCatalogRepo", () => {
	test("parses https and shorthand forms", () => {
		expect(parseCatalogRepo("https://github.com/owner/repo")).toEqual({
			owner: "owner",
			repo: "repo",
		});
		expect(parseCatalogRepo("https://github.com/owner/repo.git")).toEqual({
			owner: "owner",
			repo: "repo",
		});
		expect(parseCatalogRepo("owner/repo")).toEqual({
			owner: "owner",
			repo: "repo",
		});
	});

	test("rejects garbage", () => {
		expect(() => parseCatalogRepo("not a repo")).toThrow(ImportError);
	});
});

describe("RemoteCatalogSource", () => {
	/** Serves `modules` as the split index + detail format a real
	 * RemoteCatalogSource fetches: the index at `.../modules.json`, and each
	 * module's own detail at `.../modules-meta/<id>.json`. `failAll` lets a
	 * test flip every subsequent response to a failure, index or detail alike. */
	function stubCatalogFetch(
		modules: typeof MODULES,
		options: { failAll?: () => boolean } = {},
	): { fetch: typeof fetch; calls: string[] } {
		const calls: string[] = [];
		const byId = new Map(modules.map((m) => [m.id, m]));
		const index = {
			schemaVersion: 2,
			modules: modules.map(({ id, order, track }) =>
				track === undefined ? { id, order } : { id, order, track },
			),
		};
		const fetchImpl = (async (input: unknown) => {
			const url = String(input);
			calls.push(url);
			if (options.failAll?.()) {
				return { ok: false, status: 500, json: async () => null } as Response;
			}
			if (url.endsWith("/modules.json")) {
				return { ok: true, status: 200, json: async () => index } as Response;
			}
			const detailMatch = /\/modules-meta\/([^/]+)\.json$/.exec(url);
			const module = detailMatch && byId.get(detailMatch[1] ?? "");
			if (!module) {
				return { ok: false, status: 404, json: async () => null } as Response;
			}
			const { id: _id, order: _order, track: _track, ...detail } = module;
			return { ok: true, status: 200, json: async () => detail } as Response;
		}) as typeof fetch;
		return { fetch: fetchImpl, calls };
	}

	test("fetches the index, then each module's detail in parallel, sorts, and caches within the TTL", async () => {
		const { fetch: fetchImpl, calls } = stubCatalogFetch(MODULES);
		const source = new RemoteCatalogSource(
			"https://github.com/owner/lessons",
			"main",
			fetchImpl,
		);
		expect(source.cloneUrl).toBe("https://github.com/owner/lessons.git");
		expect(source.branchName).toBe("main");

		const first = await source.getManifest();
		expect(first.error).toBeNull();
		expect(first.modules.map((m) => m.id)).toEqual([
			"hello-world",
			"robot-starter",
		]);
		expect(calls[0]).toBe(
			"https://raw.githubusercontent.com/owner/lessons/main/modules.json",
		);
		expect(new Set(calls.slice(1))).toEqual(
			new Set([
				"https://raw.githubusercontent.com/owner/lessons/main/modules-meta/robot-starter.json",
				"https://raw.githubusercontent.com/owner/lessons/main/modules-meta/hello-world.json",
			]),
		);

		// Second call within TTL is served from cache (no extra fetches).
		await source.getManifest();
		expect(calls.length).toBe(3);
	});

	test("serves last-good cache on a later fetch failure", async () => {
		let failNext = false;
		const { fetch: fetchImpl } = stubCatalogFetch(MODULES, {
			failAll: () => failNext,
		});
		const source = new RemoteCatalogSource("owner/lessons", "main", fetchImpl);

		const first = await source.getManifest();
		expect(first.modules.length).toBe(2);

		// Force a refetch by reaching past the TTL via the private cache time.
		(source as unknown as { cached: { fetchedAt: number } }).cached.fetchedAt =
			Date.now() - 120_000;
		failNext = true;
		const second = await source.getManifest();
		expect(second.error).toBeNull();
		expect(second.modules.length).toBe(2);
	});

	test("returns an error state when the first fetch fails and there is no cache", async () => {
		const { fetch: fetchImpl } = stubCatalogFetch(MODULES, {
			failAll: () => true,
		});
		const source = new RemoteCatalogSource("owner/lessons", "main", fetchImpl);
		const { modules, error } = await source.getManifest();
		expect(modules).toEqual([]);
		expect(error).toBeTruthy();
	});

	test("returns an error state when one module's detail fetch fails", async () => {
		const { fetch: fetchImpl } = stubCatalogFetch(
			MODULES.filter((m) => m.id !== "hello-world"),
		);
		// The index still lists hello-world, but its detail file 404s - the
		// whole manifest load should fail rather than silently drop a module.
		const source = new RemoteCatalogSource("owner/lessons", "main", (async (
			input: unknown,
		) => {
			const url = String(input);
			if (url.endsWith("/modules.json")) {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						schemaVersion: 2,
						modules: [
							{ id: "hello-world", order: 10 },
							{ id: "robot-starter", order: 20 },
						],
					}),
				} as Response;
			}
			return fetchImpl(input as never);
		}) as typeof fetch);
		const { modules, error } = await source.getManifest();
		expect(modules).toEqual([]);
		expect(error).toContain("hello-world");
	});

	test("resolveModule throws ImportError for an unknown id", async () => {
		const { fetch: fetchImpl } = stubCatalogFetch(MODULES);
		const source = new RemoteCatalogSource("owner/lessons", "main", fetchImpl);
		await expect(source.resolveModule("nope")).rejects.toThrow(ImportError);
	});
});

describe("createCatalogSource", () => {
	test("returns a bundled source when catalogRepo is null", () => {
		const config = {
			catalogRepo: null,
			catalogBranch: "main",
			catalogDir: "/tmp/catalog",
		} as ControlConfig;
		expect(createCatalogSource(config)).toBeInstanceOf(BundledCatalogSource);
	});

	test("returns a remote source when catalogRepo is set", () => {
		const config = {
			catalogRepo: "owner/lessons",
			catalogBranch: "main",
			catalogDir: "/tmp/catalog",
		} as ControlConfig;
		expect(createCatalogSource(config)).toBeInstanceOf(RemoteCatalogSource);
	});
});
