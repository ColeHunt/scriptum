import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LessonModule, WorkspaceId } from "@frc-scriptum/contracts";
import { BundledCatalogSource, type CatalogSource } from "../catalog";
import {
	CheckpointManager,
	CheckpointVerifyBusyError,
	CheckpointVerifyError,
} from "../checkpoints";
import type { Nt4AutoChooserBridge } from "../nt4-auto";
import type { RunManager, RunSnapshot } from "../runs";
import type { WorkspaceRow } from "../storage";
import { login, MockWorkspaceRuntimeProvider, withApp } from "./helpers";

const MANIFEST = {
	schemaVersion: 1,
	modules: [
		{
			id: "checkpoint-demo",
			title: "Checkpoint Demo",
			description: "",
			subdir: "modules/checkpoint-demo",
			kind: "git",
			order: 1,
			checkpoints: [
				{
					id: "always-pass",
					title: "Always passes",
					description: "",
					verifier: {
						type: "script",
						path: "checkpoints/checkpoint-demo/pass.sh",
					},
				},
				{
					id: "always-fail",
					title: "Always fails",
					description: "",
					verifier: {
						type: "script",
						path: "checkpoints/checkpoint-demo/fail.sh",
					},
				},
			],
		},
		{
			id: "no-checkpoints",
			title: "No Checkpoints",
			description: "",
			subdir: "modules/no-checkpoints",
			kind: "plain-java",
			order: 2,
		},
	],
};

async function makeCatalogDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "frc-checkpoint-catalog-"));
	await writeFile(join(dir, "modules.json"), JSON.stringify(MANIFEST), "utf8");
	return dir;
}

function runningRuntime(workspaceId: WorkspaceId) {
	return {
		workspaceId,
		state: "running",
		runtimeName: "fake",
		image: "coderunner-workspace",
		ports: { nt4: 1, vscode: 2, halsim: 3 },
		endpoints: {
			vscode: { httpBaseUrl: "http://x", wsBaseUrl: "ws://x", basePath: "/" },
			nt4: { httpUrl: "http://n", wsUrl: "ws://n" },
			halsim: { wsUrl: "ws://h" },
		},
		lastUsedAt: null,
		error: null,
	} as never;
}

// --- "nt4-value" checkpoints - evaluated live against the control plane's
// own NT4 auto-chooser bridge rather than an exec'd script. ---

const NT4_MANIFEST = {
	schemaVersion: 1,
	modules: [
		{
			id: "nt4-demo",
			title: "NT4 Demo",
			description: "",
			subdir: "modules/nt4-demo",
			kind: "robot",
			order: 1,
			checkpoints: [
				{
					id: "range-check",
					title: "Range check",
					description: "",
					verifier: {
						type: "nt4-value",
						topic: "/AdvantageKit/RealOutputs/ClimberSpeed",
						check: "range",
						min: 0,
						max: 1,
					},
				},
				{
					id: "changes-check",
					title: "Changes check",
					description: "",
					verifier: {
						type: "nt4-value",
						topic: "/AdvantageKit/RealOutputs/GamePieceLoaded",
						check: "changes",
					},
				},
			],
		},
	],
};

async function makeNt4CatalogDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "frc-nt4-catalog-"));
	await writeFile(
		join(dir, "modules.json"),
		JSON.stringify(NT4_MANIFEST),
		"utf8",
	);
	return dir;
}

/** Minimal stand-in for `RunManager` - only `getWorkspaceSnapshot` is used. */
class FakeRunManager {
	status: RunSnapshot["status"] = "running";
	getWorkspaceSnapshot(_workspaceId: WorkspaceId): RunSnapshot {
		return {
			status: this.status,
			runId: this.status === "running" ? "run_fake" : null,
		};
	}
}

/**
 * Minimal stand-in for `Nt4AutoChooserBridge` - only `ensureConnected` and
 * `getValue` are used by `checkNt4Value`. Each topic gets a fixed sequence of
 * samples; once exhausted, the last value repeats (mirrors a value that
 * settled).
 */
class FakeNt4AutoChooserBridge {
	private readonly sequences = new Map<string, unknown[]>();
	ensureConnectCalls = 0;

	setSequence(topic: string, values: unknown[]): void {
		this.sequences.set(topic, values);
	}

	ensureConnected(_workspaceId: WorkspaceId, _wsUrl: string): unknown {
		this.ensureConnectCalls++;
		return undefined;
	}

	getValue(_workspaceId: WorkspaceId, topicName: string): unknown {
		const queue = this.sequences.get(topicName);
		if (!queue || queue.length === 0) return undefined;
		return queue.length > 1 ? queue.shift() : queue[0];
	}
}

async function withNt4Manager(
	fn: (deps: {
		manager: CheckpointManager;
		workspace: WorkspaceRow;
		nt4Auto: FakeNt4AutoChooserBridge;
		runs: FakeRunManager;
	}) => Promise<void>,
): Promise<void> {
	await withApp(async (app) => {
		await login(app, "alice");
		const workspace = app.storage.db
			.query("SELECT * FROM workspaces WHERE slug = ?")
			.get("alice") as WorkspaceRow;
		const catalogDir = await makeNt4CatalogDir();
		try {
			const mock = new MockWorkspaceRuntimeProvider([
				runningRuntime(workspace.id),
			]);
			const nt4Auto = new FakeNt4AutoChooserBridge();
			const runs = new FakeRunManager();
			const manager = new CheckpointManager(
				app.storage,
				mock,
				new BundledCatalogSource(catalogDir),
				nt4Auto as unknown as Nt4AutoChooserBridge,
				runs as unknown as RunManager,
			);
			await fn({ manager, workspace, nt4Auto, runs });
		} finally {
			await rm(catalogDir, { recursive: true, force: true });
		}
	});
}

describe("CheckpointManager — nt4-value checkpoints", () => {
	test("fails with a friendly message when no run is active", async () => {
		await withNt4Manager(async ({ manager, workspace, runs }) => {
			runs.status = "idle";
			const state = await manager.verify(workspace.id, "nt4-demo", [
				"range-check",
			]);
			const byId = new Map(state.checkpoints.map((c) => [c.id, c]));
			expect(byId.get("range-check")?.result).toMatchObject({
				status: "failed",
				message: "Run your robot code first, then click Verify again.",
			});
		});
	});

	test("range check passes when every sample is within bounds", async () => {
		await withNt4Manager(async ({ manager, workspace, nt4Auto }) => {
			nt4Auto.setSequence(
				"/AdvantageKit/RealOutputs/ClimberSpeed",
				[0.1, 0.2, 0.3, 0.4, 0.5],
			);
			const state = await manager.verify(workspace.id, "nt4-demo", [
				"range-check",
			]);
			const byId = new Map(state.checkpoints.map((c) => [c.id, c]));
			expect(byId.get("range-check")?.result).toMatchObject({
				status: "passed",
			});
			expect(nt4Auto.ensureConnectCalls).toBeGreaterThan(0);
		});
	});

	test("range check fails when a sample falls outside bounds", async () => {
		await withNt4Manager(async ({ manager, workspace, nt4Auto }) => {
			nt4Auto.setSequence(
				"/AdvantageKit/RealOutputs/ClimberSpeed",
				[0.1, 0.2, 1.5, 0.4, 0.5],
			);
			const state = await manager.verify(workspace.id, "nt4-demo", [
				"range-check",
			]);
			const byId = new Map(state.checkpoints.map((c) => [c.id, c]));
			expect(byId.get("range-check")?.result).toMatchObject({
				status: "failed",
			});
			expect(byId.get("range-check")?.result?.message).toContain("1.5");
		});
	});

	test("changes check passes when distinct values are observed", async () => {
		await withNt4Manager(async ({ manager, workspace, nt4Auto }) => {
			nt4Auto.setSequence("/AdvantageKit/RealOutputs/GamePieceLoaded", [
				false,
				false,
				true,
				true,
				false,
			]);
			const state = await manager.verify(workspace.id, "nt4-demo", [
				"changes-check",
			]);
			const byId = new Map(state.checkpoints.map((c) => [c.id, c]));
			expect(byId.get("changes-check")?.result).toMatchObject({
				status: "passed",
			});
		});
	});

	test("changes check fails when the value looks constant", async () => {
		await withNt4Manager(async ({ manager, workspace, nt4Auto }) => {
			nt4Auto.setSequence("/AdvantageKit/RealOutputs/GamePieceLoaded", [false]);
			const state = await manager.verify(workspace.id, "nt4-demo", [
				"changes-check",
			]);
			const byId = new Map(state.checkpoints.map((c) => [c.id, c]));
			expect(byId.get("changes-check")?.result).toMatchObject({
				status: "failed",
				message: expect.stringContaining("looks constant"),
			});
		});
	});
});

describe("CheckpointManager", () => {
	test("getState reports unavailable when no lesson is loaded", async () => {
		await withApp(async (app) => {
			await login(app, "alice");
			const workspace = app.storage.db
				.query("SELECT * FROM workspaces WHERE slug = ?")
				.get("alice") as WorkspaceRow;
			const catalogDir = await makeCatalogDir();
			try {
				const mock = new MockWorkspaceRuntimeProvider([
					runningRuntime(workspace.id),
				]);
				const manager = new CheckpointManager(
					app.storage,
					mock,
					new BundledCatalogSource(catalogDir),
				);
				const state = await manager.getState(workspace.id, null);
				expect(state).toEqual({
					moduleId: null,
					available: false,
					checkpoints: [],
				});
			} finally {
				await rm(catalogDir, { recursive: true, force: true });
			}
		});
	});

	test("getState reports unavailable for a module with no checkpoints", async () => {
		await withApp(async (app) => {
			await login(app, "alice");
			const workspace = app.storage.db
				.query("SELECT * FROM workspaces WHERE slug = ?")
				.get("alice") as WorkspaceRow;
			const catalogDir = await makeCatalogDir();
			try {
				const mock = new MockWorkspaceRuntimeProvider([
					runningRuntime(workspace.id),
				]);
				const manager = new CheckpointManager(
					app.storage,
					mock,
					new BundledCatalogSource(catalogDir),
				);
				const state = await manager.getState(workspace.id, "no-checkpoints");
				expect(state).toEqual({
					moduleId: "no-checkpoints",
					available: false,
					checkpoints: [],
				});
			} finally {
				await rm(catalogDir, { recursive: true, force: true });
			}
		});
	});

	test("verify runs each checkpoint's script as the workspace user against the project dir", async () => {
		await withApp(async (app) => {
			await login(app, "alice");
			const workspace = app.storage.db
				.query("SELECT * FROM workspaces WHERE slug = ?")
				.get("alice") as WorkspaceRow;
			const catalogDir = await makeCatalogDir();
			try {
				const mock = new MockWorkspaceRuntimeProvider([
					runningRuntime(workspace.id),
				]);
				mock.injectExecFailure(
					workspace.id,
					(cmd) => cmd.some((a) => a.endsWith("fail.sh")),
					{
						exitCode: 1,
						stdout: "roster.txt still has the placeholder line.\n",
						stderr: "",
					},
				);
				const manager = new CheckpointManager(
					app.storage,
					mock,
					new BundledCatalogSource(catalogDir),
				);

				const state = await manager.verify(workspace.id, "checkpoint-demo");

				expect(state.available).toBe(true);
				const byId = new Map(state.checkpoints.map((c) => [c.id, c]));
				expect(byId.get("always-pass")?.result).toMatchObject({
					status: "passed",
				});
				expect(byId.get("always-fail")?.result).toMatchObject({
					status: "failed",
					message: "roster.txt still has the placeholder line.",
				});

				for (const call of mock.execCalls) {
					if (
						call.command[0] === "bash" &&
						call.command[1]?.includes("pass.sh")
					) {
						expect(call.options.user).toBe("abc");
						expect(call.options.workdir).toBe("/workspace/project");
						expect(call.command).toContain("/workspace/project");
					}
				}
			} finally {
				await rm(catalogDir, { recursive: true, force: true });
			}
		});
	});

	test("verify results are persisted and returned by a later getState call", async () => {
		await withApp(async (app) => {
			await login(app, "alice");
			const workspace = app.storage.db
				.query("SELECT * FROM workspaces WHERE slug = ?")
				.get("alice") as WorkspaceRow;
			const catalogDir = await makeCatalogDir();
			try {
				const mock = new MockWorkspaceRuntimeProvider([
					runningRuntime(workspace.id),
				]);
				const manager = new CheckpointManager(
					app.storage,
					mock,
					new BundledCatalogSource(catalogDir),
				);
				await manager.verify(workspace.id, "checkpoint-demo");

				const state = await manager.getState(workspace.id, "checkpoint-demo");
				const byId = new Map(state.checkpoints.map((c) => [c.id, c]));
				expect(byId.get("always-pass")?.result?.status).toBe("passed");
			} finally {
				await rm(catalogDir, { recursive: true, force: true });
			}
		});
	});

	test("verify with checkpointIds only re-runs the requested checkpoints", async () => {
		await withApp(async (app) => {
			await login(app, "alice");
			const workspace = app.storage.db
				.query("SELECT * FROM workspaces WHERE slug = ?")
				.get("alice") as WorkspaceRow;
			const catalogDir = await makeCatalogDir();
			try {
				const mock = new MockWorkspaceRuntimeProvider([
					runningRuntime(workspace.id),
				]);
				const manager = new CheckpointManager(
					app.storage,
					mock,
					new BundledCatalogSource(catalogDir),
				);
				const state = await manager.verify(workspace.id, "checkpoint-demo", [
					"always-pass",
				]);
				const byId = new Map(state.checkpoints.map((c) => [c.id, c]));
				expect(byId.get("always-pass")?.result?.status).toBe("passed");
				expect(byId.get("always-fail")?.result).toBeNull();
			} finally {
				await rm(catalogDir, { recursive: true, force: true });
			}
		});
	});

	test("rejects a second concurrent verify for the same workspace", async () => {
		await withApp(async (app) => {
			await login(app, "alice");
			const workspace = app.storage.db
				.query("SELECT * FROM workspaces WHERE slug = ?")
				.get("alice") as WorkspaceRow;
			const catalogDir = await makeCatalogDir();
			try {
				const mock = new MockWorkspaceRuntimeProvider([
					runningRuntime(workspace.id),
				]);
				const manager = new CheckpointManager(
					app.storage,
					mock,
					new BundledCatalogSource(catalogDir),
				);
				const first = manager.verify(workspace.id, "checkpoint-demo");
				await expect(
					manager.verify(workspace.id, "checkpoint-demo"),
				).rejects.toThrow(CheckpointVerifyBusyError);
				await first;
			} finally {
				await rm(catalogDir, { recursive: true, force: true });
			}
		});
	});

	test("verify throws CheckpointVerifyError when no lesson is loaded", async () => {
		await withApp(async (app) => {
			await login(app, "alice");
			const workspace = app.storage.db
				.query("SELECT * FROM workspaces WHERE slug = ?")
				.get("alice") as WorkspaceRow;
			const catalogDir = await makeCatalogDir();
			try {
				const mock = new MockWorkspaceRuntimeProvider([
					runningRuntime(workspace.id),
				]);
				const manager = new CheckpointManager(
					app.storage,
					mock,
					new BundledCatalogSource(catalogDir),
				);
				await expect(manager.verify(workspace.id, null)).rejects.toThrow(
					CheckpointVerifyError,
				);
			} finally {
				await rm(catalogDir, { recursive: true, force: true });
			}
		});
	});
});

// --- Remote catalog: "script" checkpoints have nowhere persistent to live
// in the container (unlike bundled, baked into the image), so they're
// fetched fresh on every verify - see docs/decisions/044-remote-catalog-checkpoints.md ---

class FakeRemoteCatalogSource implements CatalogSource {
	readonly kind = "remote" as const;
	readonly cloneUrl = "https://github.com/owner/lessons.git";
	readonly branchName = "main";

	constructor(private readonly modules: LessonModule[]) {}

	async getManifest() {
		return { modules: this.modules, error: null };
	}

	async resolveModule(moduleId: string): Promise<LessonModule> {
		const found = this.modules.find((m) => m.id === moduleId);
		if (!found) throw new Error(`Unknown lesson module "${moduleId}".`);
		return found;
	}
}

describe("CheckpointManager — remote catalog", () => {
	test("getState reports available for a remote-sourced module with checkpoints", async () => {
		await withApp(async (app) => {
			await login(app, "alice");
			const workspace = app.storage.db
				.query("SELECT * FROM workspaces WHERE slug = ?")
				.get("alice") as WorkspaceRow;
			const mock = new MockWorkspaceRuntimeProvider([
				runningRuntime(workspace.id),
			]);
			const manager = new CheckpointManager(
				app.storage,
				mock,
				new FakeRemoteCatalogSource(
					MANIFEST.modules as unknown as LessonModule[],
				),
			);

			const state = await manager.getState(workspace.id, "checkpoint-demo");
			expect(state.available).toBe(true);
		});
	});

	test("verify fetches checkpoints/<id> fresh, runs the script from there, and cleans up", async () => {
		await withApp(async (app) => {
			await login(app, "alice");
			const workspace = app.storage.db
				.query("SELECT * FROM workspaces WHERE slug = ?")
				.get("alice") as WorkspaceRow;
			const mock = new MockWorkspaceRuntimeProvider([
				runningRuntime(workspace.id),
			]);
			const manager = new CheckpointManager(
				app.storage,
				mock,
				new FakeRemoteCatalogSource(
					MANIFEST.modules as unknown as LessonModule[],
				),
			);

			const state = await manager.verify(workspace.id, "checkpoint-demo", [
				"always-pass",
			]);
			expect(
				state.checkpoints.find((c) => c.id === "always-pass")?.result,
			).toMatchObject({ status: "passed" });

			const cloneCallIndex = mock.execCalls.findIndex(
				(c) => c.command[0] === "git" && c.command[1] === "clone",
			);
			expect(cloneCallIndex).toBeGreaterThanOrEqual(0);
			expect(mock.execCalls[cloneCallIndex]!.command).toContain("--sparse");

			const sparseCallIndex = mock.execCalls.findIndex(
				(c) =>
					c.command[0] === "git" &&
					c.command.includes("sparse-checkout") &&
					c.command.includes("set"),
			);
			expect(sparseCallIndex).toBeGreaterThan(cloneCallIndex);
			expect(mock.execCalls[sparseCallIndex]!.command).toContain(
				"checkpoints/checkpoint-demo",
			);

			const scriptCallIndex = mock.execCalls.findIndex(
				(c) => c.command[0] === "bash" && c.command[1]?.endsWith("pass.sh"),
			);
			expect(scriptCallIndex).toBeGreaterThan(sparseCallIndex);
			expect(mock.execCalls[scriptCallIndex]!.command[1]).not.toContain(
				"/opt/frc-catalog",
			);

			// Cleanup runs after the script, against the same staging dir the
			// clone was made into.
			const cleanupCallIndex = mock.execCalls.findIndex(
				(c) => c.command[0] === "rm" && c.command.includes("-rf"),
			);
			expect(cleanupCallIndex).toBeGreaterThan(scriptCallIndex);
			const stagingDirArg = mock.execCalls[cleanupCallIndex]!.command.at(-1)!;
			expect(mock.execCalls[cloneCallIndex]!.command.at(-1)).toContain(
				stagingDirArg,
			);
		});
	});

	test("verifying only nt4-value checkpoints never fetches from the remote repo", async () => {
		await withApp(async (app) => {
			await login(app, "alice");
			const workspace = app.storage.db
				.query("SELECT * FROM workspaces WHERE slug = ?")
				.get("alice") as WorkspaceRow;
			const mock = new MockWorkspaceRuntimeProvider([
				runningRuntime(workspace.id),
			]);
			const nt4Auto = new FakeNt4AutoChooserBridge();
			nt4Auto.setSequence("/AdvantageKit/RealOutputs/ClimberSpeed", [0.5]);
			nt4Auto.setSequence("/AdvantageKit/RealOutputs/GamePieceLoaded", [
				true,
				false,
			]);
			const manager = new CheckpointManager(
				app.storage,
				mock,
				new FakeRemoteCatalogSource(
					NT4_MANIFEST.modules as unknown as LessonModule[],
				),
				nt4Auto as unknown as Nt4AutoChooserBridge,
			);

			await manager.verify(workspace.id, "nt4-demo");

			expect(
				mock.execCalls.some(
					(c) => c.command[0] === "git" && c.command[1] === "clone",
				),
			).toBe(false);
		});
	});
});

// --- Whole-lesson locking (module.requires) — not per-checkpoint gating
// within a lesson, but whether an entire other lesson can be loaded at all. ---

const LOCK_MODULES = [
	{
		id: "checkpoint-demo",
		title: "Checkpoint Demo",
		description: "",
		subdir: "modules/checkpoint-demo",
		kind: "git",
		order: 1,
		checkpoints: [
			{
				id: "required-one",
				title: "Required One",
				description: "",
				verifier: { type: "script", path: "checkpoints/x/required-one.sh" },
			},
			{
				id: "optional-one",
				title: "Optional One",
				description: "",
				optional: true,
				verifier: { type: "script", path: "checkpoints/x/optional-one.sh" },
			},
		],
	},
	{
		id: "no-checkpoints",
		title: "No Checkpoints",
		description: "",
		subdir: "modules/no-checkpoints",
		kind: "plain-java",
		order: 2,
	},
	{
		id: "locked-followup",
		title: "Locked Followup",
		description: "",
		subdir: "modules/no-checkpoints",
		kind: "plain-java",
		order: 3,
		requires: ["checkpoint-demo"],
	},
	{
		id: "locked-on-no-checkpoints",
		title: "Locked On No Checkpoints",
		description: "",
		subdir: "modules/no-checkpoints",
		kind: "plain-java",
		order: 4,
		requires: ["no-checkpoints"],
	},
	{
		id: "locked-on-unknown",
		title: "Locked On Unknown",
		description: "",
		subdir: "modules/no-checkpoints",
		kind: "plain-java",
		order: 5,
		requires: ["does-not-exist"],
	},
];

async function makeLockCatalogDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "frc-lock-catalog-"));
	await writeFile(
		join(dir, "modules.json"),
		JSON.stringify({ schemaVersion: 1, modules: LOCK_MODULES }),
		"utf8",
	);
	return dir;
}

describe("CheckpointManager — whole-lesson locking", () => {
	test("a module with no requires is never locked", async () => {
		await withApp(async (app) => {
			await login(app, "alice");
			const workspace = app.storage.db
				.query("SELECT * FROM workspaces WHERE slug = ?")
				.get("alice") as WorkspaceRow;
			const catalogDir = await makeLockCatalogDir();
			try {
				const mock = new MockWorkspaceRuntimeProvider([
					runningRuntime(workspace.id),
				]);
				const manager = new CheckpointManager(
					app.storage,
					mock,
					new BundledCatalogSource(catalogDir),
				);
				const { modules } = await new BundledCatalogSource(
					catalogDir,
				).getManifest();
				const checkpointDemo = modules.find((m) => m.id === "checkpoint-demo")!;
				expect(
					manager.lockState(workspace.id, checkpointDemo, modules),
				).toEqual({ locked: false, missingPrerequisites: [] });
			} finally {
				await rm(catalogDir, { recursive: true, force: true });
			}
		});
	});

	test("a prerequisite with zero checkpoints of its own always counts as complete", async () => {
		await withApp(async (app) => {
			await login(app, "alice");
			const workspace = app.storage.db
				.query("SELECT * FROM workspaces WHERE slug = ?")
				.get("alice") as WorkspaceRow;
			const catalogDir = await makeLockCatalogDir();
			try {
				const mock = new MockWorkspaceRuntimeProvider([
					runningRuntime(workspace.id),
				]);
				const manager = new CheckpointManager(
					app.storage,
					mock,
					new BundledCatalogSource(catalogDir),
				);
				const { modules } = await new BundledCatalogSource(
					catalogDir,
				).getManifest();
				const target = modules.find(
					(m) => m.id === "locked-on-no-checkpoints",
				)!;
				expect(manager.lockState(workspace.id, target, modules)).toEqual({
					locked: false,
					missingPrerequisites: [],
				});
			} finally {
				await rm(catalogDir, { recursive: true, force: true });
			}
		});
	});

	test("an unknown prerequisite id is skipped rather than permanently locking the module", async () => {
		await withApp(async (app) => {
			await login(app, "alice");
			const workspace = app.storage.db
				.query("SELECT * FROM workspaces WHERE slug = ?")
				.get("alice") as WorkspaceRow;
			const catalogDir = await makeLockCatalogDir();
			try {
				const mock = new MockWorkspaceRuntimeProvider([
					runningRuntime(workspace.id),
				]);
				const manager = new CheckpointManager(
					app.storage,
					mock,
					new BundledCatalogSource(catalogDir),
				);
				const { modules } = await new BundledCatalogSource(
					catalogDir,
				).getManifest();
				const target = modules.find((m) => m.id === "locked-on-unknown")!;
				expect(manager.lockState(workspace.id, target, modules)).toEqual({
					locked: false,
					missingPrerequisites: [],
				});
			} finally {
				await rm(catalogDir, { recursive: true, force: true });
			}
		});
	});

	test("stays locked until the prerequisite's required checkpoint passes, ignoring the optional one", async () => {
		await withApp(async (app) => {
			await login(app, "alice");
			const workspace = app.storage.db
				.query("SELECT * FROM workspaces WHERE slug = ?")
				.get("alice") as WorkspaceRow;
			const catalogDir = await makeLockCatalogDir();
			try {
				const mock = new MockWorkspaceRuntimeProvider([
					runningRuntime(workspace.id),
				]);
				const manager = new CheckpointManager(
					app.storage,
					mock,
					new BundledCatalogSource(catalogDir),
				);
				const { modules } = await new BundledCatalogSource(
					catalogDir,
				).getManifest();
				const target = modules.find((m) => m.id === "locked-followup")!;

				expect(manager.lockState(workspace.id, target, modules)).toEqual({
					locked: true,
					missingPrerequisites: ["Checkpoint Demo"],
				});

				// Only the required checkpoint passes; the optional one never runs.
				app.storage.setCheckpointResult(workspace.id, "checkpoint-demo", {
					checkpointId: "required-one",
					status: "passed",
					message: null,
					verifiedAt: new Date().toISOString(),
				});

				expect(manager.lockState(workspace.id, target, modules)).toEqual({
					locked: false,
					missingPrerequisites: [],
				});
			} finally {
				await rm(catalogDir, { recursive: true, force: true });
			}
		});
	});

	test("re-locks if the required checkpoint's latest result is a failure, not just missing", async () => {
		await withApp(async (app) => {
			await login(app, "alice");
			const workspace = app.storage.db
				.query("SELECT * FROM workspaces WHERE slug = ?")
				.get("alice") as WorkspaceRow;
			const catalogDir = await makeLockCatalogDir();
			try {
				const mock = new MockWorkspaceRuntimeProvider([
					runningRuntime(workspace.id),
				]);
				const manager = new CheckpointManager(
					app.storage,
					mock,
					new BundledCatalogSource(catalogDir),
				);
				const { modules } = await new BundledCatalogSource(
					catalogDir,
				).getManifest();
				const target = modules.find((m) => m.id === "locked-followup")!;

				app.storage.setCheckpointResult(workspace.id, "checkpoint-demo", {
					checkpointId: "required-one",
					status: "failed",
					message: "not yet",
					verifiedAt: new Date().toISOString(),
				});

				expect(manager.lockState(workspace.id, target, modules).locked).toBe(
					true,
				);
			} finally {
				await rm(catalogDir, { recursive: true, force: true });
			}
		});
	});

	test("withLockState attaches lock info to every module in one pass", async () => {
		await withApp(async (app) => {
			await login(app, "alice");
			const workspace = app.storage.db
				.query("SELECT * FROM workspaces WHERE slug = ?")
				.get("alice") as WorkspaceRow;
			const catalogDir = await makeLockCatalogDir();
			try {
				const mock = new MockWorkspaceRuntimeProvider([
					runningRuntime(workspace.id),
				]);
				const manager = new CheckpointManager(
					app.storage,
					mock,
					new BundledCatalogSource(catalogDir),
				);
				const { modules } = await new BundledCatalogSource(
					catalogDir,
				).getManifest();

				const withLock = manager.withLockState(workspace.id, modules);
				const byId = new Map(withLock.map((m) => [m.id, m]));
				expect(byId.get("checkpoint-demo")).toMatchObject({
					locked: false,
					completed: false,
				});
				expect(byId.get("locked-followup")).toMatchObject({
					locked: true,
					missingPrerequisites: ["Checkpoint Demo"],
					// Vacuously complete: it has no checkpoints of its own to fail.
					completed: true,
				});
			} finally {
				await rm(catalogDir, { recursive: true, force: true });
			}
		});
	});

	test("withLockState marks a module completed once every required checkpoint has passed", async () => {
		await withApp(async (app) => {
			await login(app, "alice");
			const workspace = app.storage.db
				.query("SELECT * FROM workspaces WHERE slug = ?")
				.get("alice") as WorkspaceRow;
			const catalogDir = await makeLockCatalogDir();
			try {
				const mock = new MockWorkspaceRuntimeProvider([
					runningRuntime(workspace.id),
				]);
				const manager = new CheckpointManager(
					app.storage,
					mock,
					new BundledCatalogSource(catalogDir),
				);
				const { modules } = await new BundledCatalogSource(
					catalogDir,
				).getManifest();

				app.storage.setCheckpointResult(workspace.id, "checkpoint-demo", {
					checkpointId: "required-one",
					status: "passed",
					message: null,
					verifiedAt: new Date().toISOString(),
				});

				const withLock = manager.withLockState(workspace.id, modules);
				const byId = new Map(withLock.map((m) => [m.id, m]));
				expect(byId.get("checkpoint-demo")).toMatchObject({
					completed: true,
				});
			} finally {
				await rm(catalogDir, { recursive: true, force: true });
			}
		});
	});
});
