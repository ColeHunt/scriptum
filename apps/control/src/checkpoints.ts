import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
	CheckpointResult,
	CheckpointStatus,
	CheckpointsState,
	LessonCheckpoint,
	LessonCheckpointVerifier,
	LessonModule,
	LessonModuleWithLockState,
	WorkspaceId,
} from "@frc-scriptum/contracts";
import { runIsActive } from "./app/status";
import { type CatalogSource, IMAGE_CATALOG_DIR } from "./catalog";
import { workspaceScopeStatePath } from "./containers/metadata";
import { SCOPE_STATE_CONTAINER_DIR } from "./containers/types";
import { ImportError } from "./imports";
import { getLogger } from "./logging";
import type { Nt4AutoChooserBridge } from "./nt4-auto";
import type { RunManager } from "./runs";
import type { WorkspaceRuntimeProvider } from "./runtime";
import type { AppStorage } from "./storage";

const log = getLogger("checkpoints");

const SCRIPT_TIMEOUT_MS = 15_000;
const CHECKPOINT_FETCH_TIMEOUT_MS = 60_000;
const WORKSPACE_USER = "abc";
const PROJECT_DIR = "/workspace/project";
const SCOPE_LAYOUT_FILENAME = "layout.json";
const HINT_MAX_LENGTH = 300;
/** How many times an "nt4-value" checkpoint samples the live topic, and how
 * far apart, to distinguish a frozen value from real changing telemetry. */
const NT4_VALUE_SAMPLE_COUNT = 5;
const NT4_VALUE_SAMPLE_INTERVAL_MS = 300;

export class CheckpointVerifyError extends Error {}

export class CheckpointVerifyBusyError extends CheckpointVerifyError {
	constructor() {
		super("A verify is already running for this workspace.");
	}
}

/**
 * Runs a lesson module's checkpoint verifiers on demand (never on a code
 * change - only in response to the student clicking Verify) and persists
 * results per workspace/module/checkpoint. For a bundled module the hidden
 * "script" verifier scripts are read straight from the image
 * (IMAGE_CATALOG_DIR); for a remote catalog they're fetched fresh into a
 * throwaway staging dir on every verify (not cached/persisted - a workspace
 * container can be fully recreated between a lesson load and a later Verify
 * click, so nothing written at load time is guaranteed to still be there).
 * Trust model matches the bundled path: the control plane runs whatever
 * script the configured catalog repo ships, same as it always has for the
 * bundled catalog. See docs/decisions/044-remote-catalog-checkpoints.md.
 */
export class CheckpointManager {
	private readonly active = new Set<WorkspaceId>();

	constructor(
		private readonly storage: AppStorage,
		private readonly runtimeProvider: WorkspaceRuntimeProvider,
		private readonly catalogSource: CatalogSource,
		// Optional: only needed for "nt4-value" checkpoints (robot-kind
		// lessons). Left undefined in most existing tests, which never
		// construct a module using that verifier type.
		private readonly nt4Auto?: Nt4AutoChooserBridge,
		private readonly runs?: RunManager,
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
		if (checkpoints.length === 0) {
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

			// Fetched once per verify call (not per checkpoint - a module can have
			// several "script" checkpoints sharing the same checkpoints/<id>/ dir),
			// and only when actually needed: a batch of pure "nt4-value" checkpoints
			// never touches the filesystem.
			let scriptRoot = IMAGE_CATALOG_DIR;
			let scriptRootStagingDir: string | null = null;
			if (
				this.catalogSource.kind !== "bundled" &&
				targets.some((cp) => cp.verifier.type === "script")
			) {
				const fetched = await this.fetchRemoteCheckpointRoot(
					workspaceId,
					module.id,
				);
				scriptRoot = fetched.scriptRoot;
				scriptRootStagingDir = fetched.stagingDir;
			}

			try {
				for (const checkpoint of targets) {
					const result = await this.runVerifier(
						workspaceId,
						checkpoint,
						scriptRoot,
					);
					this.storage.setCheckpointResult(workspaceId, module.id, result);
				}
			} finally {
				if (scriptRootStagingDir) {
					await this.runtimeProvider
						.exec(workspaceId, ["rm", "-rf", scriptRootStagingDir], {
							timeoutMs: SCRIPT_TIMEOUT_MS,
						})
						.catch(() => {});
				}
			}
			return this.stateForModule(workspaceId, module.id, module.checkpoints);
		} finally {
			this.active.delete(workspaceId);
		}
	}

	/**
	 * Sparse shallow clones just checkpoints/<moduleId>/ from the configured
	 * remote catalog repo into a throwaway staging dir inside the container,
	 * mirroring how imports.ts fetches modules/<id>/. Not reused/cached across
	 * verify calls - see the class doc for why.
	 */
	private async fetchRemoteCheckpointRoot(
		workspaceId: WorkspaceId,
		moduleId: string,
	): Promise<{ scriptRoot: string; stagingDir: string }> {
		const { cloneUrl, branchName } = this.catalogSource;
		if (!cloneUrl || !branchName) {
			throw new CheckpointVerifyError(
				"Remote catalog is not configured correctly.",
			);
		}
		const stagingDir = `/workspace/.checkpoint-fetch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const sourceDir = `${stagingDir}/source`;
		const checkpointsSubdir = `checkpoints/${moduleId}`;

		const cloneResult = await this.runtimeProvider.exec(
			workspaceId,
			[
				"git",
				"clone",
				"--depth",
				"1",
				"--filter=blob:none",
				"--sparse",
				"--branch",
				branchName,
				"--",
				cloneUrl,
				sourceDir,
			],
			{ timeoutMs: CHECKPOINT_FETCH_TIMEOUT_MS },
		);
		if (cloneResult.exitCode !== 0) {
			const detail =
				cloneResult.stderr.trim() ||
				cloneResult.stdout.trim() ||
				`exit ${cloneResult.exitCode}`;
			throw new CheckpointVerifyError(
				`Could not fetch checkpoint scripts from the lessons repo: ${detail}`,
			);
		}

		const sparseResult = await this.runtimeProvider.exec(
			workspaceId,
			["git", "-C", sourceDir, "sparse-checkout", "set", checkpointsSubdir],
			{ timeoutMs: CHECKPOINT_FETCH_TIMEOUT_MS },
		);
		if (sparseResult.exitCode !== 0) {
			const detail =
				sparseResult.stderr.trim() ||
				sparseResult.stdout.trim() ||
				`exit ${sparseResult.exitCode}`;
			throw new CheckpointVerifyError(
				`Could not fetch checkpoint scripts from the lessons repo: ${detail}`,
			);
		}

		return { scriptRoot: sourceDir, stagingDir };
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
		scriptRoot: string,
	): Promise<CheckpointResult> {
		const verifiedAt = new Date().toISOString();
		try {
			const { status, message } =
				checkpoint.verifier.type === "nt4-value"
					? await this.checkNt4Value(workspaceId, checkpoint.verifier)
					: await this.checkScript(
							workspaceId,
							checkpoint.verifier,
							scriptRoot,
						);
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

	private async checkScript(
		workspaceId: WorkspaceId,
		verifier: Extract<LessonCheckpointVerifier, { type: "script" }>,
		scriptRoot: string,
	): Promise<{ status: CheckpointStatus; message: string | null }> {
		const scriptPath = `${scriptRoot}/${verifier.path}`;
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
		return { status, message };
	}

	/**
	 * Checks a live NT4 topic directly against the control plane's own
	 * already-connected auto-chooser bridge (it subscribes to every topic
	 * already - see Nt4AutoChooserBridge.getValue). Used for robot-kind
	 * lessons, where a hidden checkpoint class can't be compiled against the
	 * student's Gradle/WPILib project the way plain-java checkpoints work.
	 */
	private async checkNt4Value(
		workspaceId: WorkspaceId,
		verifier: Extract<LessonCheckpointVerifier, { type: "nt4-value" }>,
	): Promise<{ status: CheckpointStatus; message: string | null }> {
		if (!this.nt4Auto || !this.runs) {
			return {
				status: "error",
				message: "Live-data checkpoints aren't available right now.",
			};
		}
		const run = this.runs.getWorkspaceSnapshot(workspaceId);
		const runtime =
			await this.runtimeProvider.ensureWorkspaceRunning(workspaceId);
		if (
			!runIsActive(run.status) ||
			runtime.state !== "running" ||
			runtime.endpoints.nt4 === null
		) {
			return {
				status: "failed",
				message: "Run your robot code first, then click Verify again.",
			};
		}
		this.nt4Auto.ensureConnected(workspaceId, runtime.endpoints.nt4.wsUrl);

		const samples: unknown[] = [];
		for (let i = 0; i < NT4_VALUE_SAMPLE_COUNT; i++) {
			samples.push(this.nt4Auto.getValue(workspaceId, verifier.topic));
			if (i < NT4_VALUE_SAMPLE_COUNT - 1) {
				await sleep(NT4_VALUE_SAMPLE_INTERVAL_MS);
			}
		}
		if (samples.every((value) => value === undefined)) {
			return {
				status: "failed",
				message: `No data seen yet on ${verifier.topic} - make sure your code is publishing it.`,
			};
		}

		if (verifier.check === "range") {
			const { min, max } = verifier;
			const outOfRange = samples.find(
				(value) =>
					typeof value !== "number" ||
					(min !== undefined && value < min) ||
					(max !== undefined && value > max),
			);
			if (outOfRange !== undefined) {
				return {
					status: "failed",
					message: `${verifier.topic} was ${JSON.stringify(outOfRange)}, expected a number between ${min} and ${max}.`,
				};
			}
			return { status: "passed", message: `${verifier.topic} looks good.` };
		}

		// "changes"
		const distinct = new Set(samples.map((value) => JSON.stringify(value)));
		if (distinct.size < 2) {
			return {
				status: "failed",
				message: `${verifier.topic} looks constant - it should change over time.`,
			};
		}
		return { status: "passed", message: `${verifier.topic} looks good.` };
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((res) => setTimeout(res, ms));
}

function lastNonEmptyLine(text: string): string | null {
	const lines = text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const last = lines.at(-1);
	return last ? last.slice(0, HINT_MAX_LENGTH) : null;
}
