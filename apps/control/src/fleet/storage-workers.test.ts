import { describe, expect, test } from "bun:test";
import { login, withApp, workspaceBySlug } from "../__tests__/helpers";

describe("AppStorage worker fleet CRUD (docs/decisions/048)", () => {
	test("create/list/status/heartbeat round-trip", async () => {
		await withApp(async (app) => {
			const created = app.storage.createWorker({
				id: "worker-1",
				doDropletId: "do-123",
				privateIp: "10.0.0.5",
				capacity: 4,
			});
			expect(created.status).toBe("provisioning");
			expect(created.last_heartbeat_at).toBeNull();

			expect(app.storage.listWorkers().map((w) => w.id)).toEqual(["worker-1"]);

			app.storage.setWorkerStatus("worker-1", "ready");
			app.storage.recordWorkerHeartbeat("worker-1");

			const reloaded = app.storage.getWorker("worker-1");
			expect(reloaded?.status).toBe("ready");
			expect(reloaded?.last_heartbeat_at).not.toBeNull();
		});
	});

	test("getWorker returns null for an unknown id", async () => {
		await withApp(async (app) => {
			expect(app.storage.getWorker("nope")).toBeNull();
		});
	});

	test("setWorkspaceWorker assigns/clears placement, reflected in workspace and lease rows", async () => {
		await withApp(
			async (app) => {
				await login(app, "alice");
				const workspace = workspaceBySlug(app, "alice");

				app.storage.createWorker({
					id: "worker-1",
					doDropletId: "do-123",
					privateIp: "10.0.0.5",
					capacity: 4,
				});
				app.storage.setWorkerStatus("worker-1", "ready");

				expect(app.storage.countWorkspacesOnWorker("worker-1")).toBe(0);

				app.storage.setWorkspaceWorker(workspace.id, "worker-1");
				expect(app.storage.findWorkspaceById(workspace.id)?.worker_id).toBe(
					"worker-1",
				);
				expect(app.storage.countWorkspacesOnWorker("worker-1")).toBe(1);

				app.storage.setWorkspaceWorker(workspace.id, null);
				expect(
					app.storage.findWorkspaceById(workspace.id)?.worker_id,
				).toBeNull();
				expect(app.storage.countWorkspacesOnWorker("worker-1")).toBe(0);
			},
			{ containerAutoStart: false },
		);
	});

	test("deleting a worker clears worker_id on its workspaces (ON DELETE SET NULL)", async () => {
		await withApp(
			async (app) => {
				await login(app, "alice");
				const workspace = workspaceBySlug(app, "alice");

				app.storage.createWorker({
					id: "worker-1",
					doDropletId: "do-123",
					privateIp: "10.0.0.5",
					capacity: 4,
				});
				app.storage.setWorkspaceWorker(workspace.id, "worker-1");

				const deleted = app.storage.deleteWorker("worker-1");
				expect(deleted).toBe(true);
				expect(
					app.storage.findWorkspaceById(workspace.id)?.worker_id,
				).toBeNull();
				expect(app.storage.getWorker("worker-1")).toBeNull();
			},
			{ containerAutoStart: false },
		);
	});
});
