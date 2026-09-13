import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceId } from "@frc-coderunner/contracts";
import { BundledCatalogSource } from "../catalog";
import {
	CheckpointManager,
	CheckpointVerifyBusyError,
	CheckpointVerifyError,
} from "../checkpoints";
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
