import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
	CheckpointResult,
	CheckpointStatus,
	CheckpointsState,
	LessonCheckpoint,
	LessonModule,
	LessonModuleWithLockState,
	WorkspaceId,
} from "@frc-coderunner/contracts";
import { type CatalogSource, IMAGE_CATALOG_DIR } from "./catalog";
import { workspaceScopeStatePath } from "./containers/metadata";
import { SCOPE_STATE_CONTAINER_DIR } from "./containers/types";
import { ImportError } from "./imports";
import { getLogger } from "./logging";
import type { WorkspaceRuntimeProvider } from "./runtime";
import type { AppStorage } from "./storage";

const log = getLogger("checkpoints");

const SCRIPT_TIMEOUT_MS = 15_000;
const WORKSPACE_USER = "abc";
const PROJECT_DIR = "/workspace/project";
const SCOPE_LAYOUT_FILENAME = "layout.json";
const HINT_MAX_LENGTH = 300;

export class CheckpointVerifyError extends Error {}

export class CheckpointVerifyBusyError extends CheckpointVerifyError {
	constructor() {
		super("A verify is already running for this workspace.");
	}
}

/**
 * Runs a lesson module's checkpoint verifiers on demand (never on a code
 * change - only in response to the student clicking Verify) and persists
 * results per workspace/module/checkpoint. Verification is only available for
 * bundled modules, since the hidden checkpoint scripts live only in the
 * image, not in a remote catalog.
 */
export class CheckpointManager {
	private readonly active = new Set<WorkspaceId>();

	constructor(
		private readonly storage: AppStorage,
		private readonly runtimeProvider: WorkspaceRuntimeProvider,
		private readonly catalogSource: CatalogSource,
	) {}

	async getState(
		workspaceId: WorkspaceId,
		moduleId: string | null,
	): Promise<CheckpointsState> {
		if (!moduleId) {
			return { moduleId: null, available: false, checkpoints: [] };
		}
		try {
			const module = await this.catalogSource.resolveModule(moduleId);
			return this.stateForModule(workspaceId, module.id, module.checkpoints);
		} catch (error) {
			if (error instanceof ImportError) {
				return { moduleId, available: false, checkpoints: [] };
			}
			throw error;
		}
	}

	private stateForModule(
		workspaceId: WorkspaceId,
		moduleId: string,
		checkpoints: LessonCheckpoint[],
	): CheckpointsState {
		if (checkpoints.length === 0 || this.catalogSource.kind !== "bundled") {
			return { moduleId, available: false, checkpoints: [] };
		}
		const results = new Map(
			this.storage
				.getCheckpointResults(workspaceId, moduleId)
				.map((result) => [result.checkpointId, result] as const),
		);
		return {
			moduleId,
			available: true,
			checkpoints: checkpoints.map((checkpoint) => ({
				...checkpoint,
				result: results.get(checkpoint.id) ?? null,
			})),
		};
	}

	/**
	 * Verifies `checkpointIds` (or every checkpoint in the current module when
	 * omitted), one at a time, and persists each result as it lands. Throws
	 * `CheckpointVerifyBusyError` if a verify is already running for this
	 * workspace, or `CheckpointVerifyError` for anything else that keeps it
	 * from starting (no lesson loaded, module has no checkpoints, etc).
	 */
	async verify(
		workspaceId: WorkspaceId,
		moduleId: string | null,
		checkpointIds?: string[],
		scopeLayout?: unknown,
	): Promise<CheckpointsState> {
		if (!moduleId) {
			throw new CheckpointVerifyError("No lesson is loaded.");
		}
		if (this.active.has(workspaceId)) {
			throw new CheckpointVerifyBusyError();
		}
		this.active.add(workspaceId);
		try {
			const runtime =
				await this.runtimeProvider.ensureWorkspaceRunning(workspaceId);
			if (runtime.state !== "running") {
				throw new CheckpointVerifyError(
					"The workspace isn't running. Open the editor, then try again.",
				);
			}
			const module = await this.catalogSource.resolveModule(moduleId);
			const state = this.stateForModule(
				workspaceId,
				module.id,
				module.checkpoints,
			);
			if (!state.available) {
				throw new CheckpointVerifyError(
					"This lesson has no checkpoints to verify.",
				);
			}
			// Written before the loop so every checkpoint in this pass sees the
			// exact same snapshot, captured at the moment the student clicked
			// Verify. Direct host-fs write (no docker exec) into the bind mount
			// set up alongside `project`/`home` - see workspaceScopeStatePath.
			if (scopeLayout !== undefined) {
				const workspace = this.storage.findWorkspaceById(workspaceId);
				if (workspace) {
					const dir = workspaceScopeStatePath(workspace);
					await mkdir(dir, { recursive: true, mode: 0o755 });
					await writeFile(
						resolve(dir, SCOPE_LAYOUT_FILENAME),
						JSON.stringify(scopeLayout ?? null),
						"utf8",
					);
				}
			}
			const targets = checkpointIds
				? module.checkpoints.filter((cp) => checkpointIds.includes(cp.id))
				: module.checkpoints;
			for (const checkpoint of targets) {
				const result = await this.runVerifier(workspaceId, checkpoint);
				this.storage.setCheckpointResult(workspaceId, module.id, result);
			}
			return this.stateForModule(workspaceId, module.id, module.checkpoints);
		} finally {
			this.active.delete(workspaceId);
		}
	}

	/**
	 * True when every non-optional checkpoint of `module` has passed for this
	 * workspace. A module with no required checkpoints of its own is always
	 * "complete" - there is nothing to gate on.
	 */
	isModuleComplete(workspaceId: WorkspaceId, module: LessonModule): boolean {
		const required = module.checkpoints.filter((cp) => !cp.optional);
		if (required.length === 0) return true;
		const results = new Map(
			this.storage
				.getCheckpointResults(workspaceId, module.id)
				.map((result) => [result.checkpointId, result] as const),
		);
		return required.every(
			(checkpoint) => results.get(checkpoint.id)?.status === "passed",
		);
	}

	/**
	 * Resolves `module.requires` against `allModules` and reports which of
	 * them are still incomplete. Hard lock: any incomplete prerequisite locks
	 * the module. An unknown prerequisite id (a manifest typo) is skipped
	 * rather than permanently locking the module.
	 */
	lockState(
		workspaceId: WorkspaceId,
		module: LessonModule,
		allModules: LessonModule[],
	): { locked: boolean; missingPrerequisites: string[] } {
		if (module.requires.length === 0) {
			return { locked: false, missingPrerequisites: [] };
		}
		const byId = new Map(allModules.map((m) => [m.id, m]));
		const missing = module.requires
			.map((id) => byId.get(id))
			.filter((prereq): prereq is LessonModule => Boolean(prereq))
			.filter((prereq) => !this.isModuleComplete(workspaceId, prereq))
			.map((prereq) => prereq.title);
		return { locked: missing.length > 0, missingPrerequisites: missing };
	}

	/** Attaches lock state to every module in a catalog listing (GET /api/lessons). */
	withLockState(
		workspaceId: WorkspaceId,
		modules: LessonModule[],
	): LessonModuleWithLockState[] {
		return modules.map((module) => ({
			...module,
			...this.lockState(workspaceId, module, modules),
		}));
	}

	private async runVerifier(
		workspaceId: WorkspaceId,
		checkpoint: LessonCheckpoint,
	): Promise<CheckpointResult> {
		const verifiedAt = new Date().toISOString();
		const scriptPath = `${IMAGE_CATALOG_DIR}/${checkpoint.verifier.path}`;
		try {
			const result = await this.runtimeProvider.exec(
				workspaceId,
				[
					"bash",
					scriptPath,
					PROJECT_DIR,
					`${SCOPE_STATE_CONTAINER_DIR}/${SCOPE_LAYOUT_FILENAME}`,
				],
				{
					user: WORKSPACE_USER,
					workdir: PROJECT_DIR,
					timeoutMs: SCRIPT_TIMEOUT_MS,
				},
			);
			const status: CheckpointStatus =
				result.exitCode === 0 ? "passed" : "failed";
			const message =
				lastNonEmptyLine(result.stdout) ?? lastNonEmptyLine(result.stderr);
			return { checkpointId: checkpoint.id, status, message, verifiedAt };
		} catch (error) {
			log.error("checkpoint verifier crashed", {
				workspaceId,
				checkpointId: checkpoint.id,
				err: error instanceof Error ? error : new Error(String(error)),
			});
			return {
				checkpointId: checkpoint.id,
				status: "error",
				message: "The verifier crashed. Try again, or ask a mentor.",
				verifiedAt,
			};
		}
	}
}

function lastNonEmptyLine(text: string): string | null {
	const lines = text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const last = lines.at(-1);
	return last ? last.slice(0, HINT_MAX_LENGTH) : null;
}
