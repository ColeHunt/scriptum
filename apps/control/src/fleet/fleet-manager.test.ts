import { describe, expect, test } from "bun:test";
import { login, withApp, workspaceBySlug } from "../__tests__/helpers";
import { FleetManager } from "./fleet-manager";
import type { FleetProvisioner, ProvisionedWorker, WorkerSpec } from "./types";

/** In-memory FleetProvisioner: no DigitalOcean account needed - a real one
 * (Phase 2) is tested separately once real DO infrastructure exists. */
function createFakeProvisioner() {
	const created: WorkerSpec[] = [];
	const destroyed: string[] = [];
	let nextDropletId = 1;

	const provisioner: FleetProvisioner = {
		async createWorker(spec: WorkerSpec): Promise<ProvisionedWorker> {
			created.push(spec);
			const dropletId = `do-${nextDropletId++}`;
			return { doDropletId: dropletId, privateIp: `10.0.0.${nextDropletId}` };
		},
		async destroyWorker(doDropletId: string): Promise<void> {
			destroyed.push(doDropletId);
		},
	};

	return { provisioner, created, destroyed };
}

const BASE_OPTIONS = {
	workerMemoryMb: 16384,
	codeMemoryLimitMb: 4096, // capacity 4
	idleGracePeriodMs: 10 * 60_000,
};

describe("FleetManager.placeWorkspace", () => {
	test("provisions a new worker when the fleet is empty", async () => {
		await withApp(
			async (app) => {
				await login(app, "alice");
				const alice = workspaceBySlug(app, "alice");

				const { provisioner, created } = createFakeProvisioner();
				const manager = new FleetManager(
					app.storage,
					provisioner,
					BASE_OPTIONS,
				);

				const workerId = await manager.placeWorkspace(alice.id);

				expect(created.length).toBe(1);
				expect(app.storage.getWorker(workerId)).not.toBeNull();
				expect(app.storage.findWorkspaceById(alice.id)?.worker_id).toBe(
					workerId,
				);
			},
			{ containerAutoStart: false },
		);
	});

	test("reuses an existing ready worker with room instead of provisioning", async () => {
		await withApp(
			async (app) => {
				await login(app, "alice");
				await login(app, "bob");
				const alice = workspaceBySlug(app, "alice");
				const bob = workspaceBySlug(app, "bob");

				const { provisioner, created } = createFakeProvisioner();
				const manager = new FleetManager(
					app.storage,
					provisioner,
					BASE_OPTIONS,
				);

				const firstWorker = await manager.placeWorkspace(alice.id);
				manager.markWorkerReady(firstWorker);
				const secondWorker = await manager.placeWorkspace(bob.id);

				expect(secondWorker).toBe(firstWorker);
				expect(created.length).toBe(1);
			},
			{ containerAutoStart: false },
		);
	});

	test("is idempotent for an already-placed workspace", async () => {
		await withApp(
			async (app) => {
				await login(app, "alice");
				const alice = workspaceBySlug(app, "alice");

				const { provisioner, created } = createFakeProvisioner();
				const manager = new FleetManager(
					app.storage,
					provisioner,
					BASE_OPTIONS,
				);

				const first = await manager.placeWorkspace(alice.id);
				const second = await manager.placeWorkspace(alice.id);

				expect(second).toBe(first);
				expect(created.length).toBe(1);
			},
			{ containerAutoStart: false },
		);
	});

	test("provisions a new worker once the ready one is at capacity", async () => {
		await withApp(
			async (app) => {
				const slugs = ["s1", "s2", "s3", "s4", "s5"];
				for (const slug of slugs) {
					await login(app, slug);
				}

				const { provisioner, created } = createFakeProvisioner();
				const manager = new FleetManager(
					app.storage,
					provisioner,
					BASE_OPTIONS,
				);

				const workers = new Set<string>();
				for (const slug of slugs) {
					const workspace = workspaceBySlug(app, slug);
					const workerId = await manager.placeWorkspace(workspace.id);
					manager.markWorkerReady(workerId);
					workers.add(workerId);
				}

				// Capacity 4: the 5th student needs a second worker.
				expect(created.length).toBe(2);
				expect(workers.size).toBe(2);
			},
			{ containerAutoStart: false },
		);
	});

	test("a still-provisioning worker is not reused for a new placement", async () => {
		await withApp(
			async (app) => {
				await login(app, "alice");
				await login(app, "bob");
				const alice = workspaceBySlug(app, "alice");
				const bob = workspaceBySlug(app, "bob");

				const { provisioner, created } = createFakeProvisioner();
				const manager = new FleetManager(
					app.storage,
					provisioner,
					BASE_OPTIONS,
				);

				await manager.placeWorkspace(alice.id);
				// markWorkerReady is never called - worker stays 'provisioning'.
				await manager.placeWorkspace(bob.id);

				expect(created.length).toBe(2);
			},
			{ containerAutoStart: false },
		);
	});
});

describe("FleetManager.sweepIdleWorkers", () => {
	test("does not destroy a worker that still has placed workspaces", async () => {
		await withApp(
			async (app) => {
				await login(app, "alice");
				const alice = workspaceBySlug(app, "alice");

				const { provisioner, destroyed } = createFakeProvisioner();
				const manager = new FleetManager(
					app.storage,
					provisioner,
					BASE_OPTIONS,
				);
				const workerId = await manager.placeWorkspace(alice.id);
				manager.markWorkerReady(workerId);

				await manager.sweepIdleWorkers(Date.now() + 24 * 60 * 60_000);

				expect(destroyed).toEqual([]);
				expect(app.storage.getWorker(workerId)).not.toBeNull();
			},
			{ containerAutoStart: false },
		);
	});

	test("does not destroy an empty worker before the grace period elapses", async () => {
		await withApp(
			async (app) => {
				await login(app, "alice");
				const alice = workspaceBySlug(app, "alice");

				const { provisioner, destroyed } = createFakeProvisioner();
				const manager = new FleetManager(
					app.storage,
					provisioner,
					BASE_OPTIONS,
				);
				const workerId = await manager.placeWorkspace(alice.id);
				manager.markWorkerReady(workerId);
				app.storage.setWorkspaceWorker(alice.id, null); // idle-stopped, unplaced

				const t0 = Date.now();
				await manager.sweepIdleWorkers(t0); // first observed empty
				await manager.sweepIdleWorkers(t0 + BASE_OPTIONS.idleGracePeriodMs / 2); // still within grace period

				expect(destroyed).toEqual([]);
				expect(app.storage.getWorker(workerId)).not.toBeNull();
			},
			{ containerAutoStart: false },
		);
	});

	test("destroys a worker once empty for at least the grace period", async () => {
		await withApp(
			async (app) => {
				await login(app, "alice");
				const alice = workspaceBySlug(app, "alice");

				const { provisioner, destroyed } = createFakeProvisioner();
				const manager = new FleetManager(
					app.storage,
					provisioner,
					BASE_OPTIONS,
				);
				const workerId = await manager.placeWorkspace(alice.id);
				manager.markWorkerReady(workerId);
				const worker = app.storage.getWorker(workerId);
				expect(worker).not.toBeNull();
				app.storage.setWorkspaceWorker(alice.id, null);

				const t0 = Date.now();
				await manager.sweepIdleWorkers(t0);
				await manager.sweepIdleWorkers(t0 + BASE_OPTIONS.idleGracePeriodMs);

				expect(destroyed).toEqual([worker!.do_droplet_id]);
				expect(app.storage.getWorker(workerId)).toBeNull();
			},
			{ containerAutoStart: false },
		);
	});

	test("re-arms the debounce if a worker becomes non-empty and then empty again", async () => {
		await withApp(
			async (app) => {
				await login(app, "alice");
				await login(app, "bob");
				const alice = workspaceBySlug(app, "alice");
				const bob = workspaceBySlug(app, "bob");

				const { provisioner, destroyed } = createFakeProvisioner();
				const manager = new FleetManager(
					app.storage,
					provisioner,
					BASE_OPTIONS,
				);
				const workerId = await manager.placeWorkspace(alice.id);
				manager.markWorkerReady(workerId);

				const t0 = Date.now();
				app.storage.setWorkspaceWorker(alice.id, null); // empty
				await manager.sweepIdleWorkers(t0);

				// A new session lands on it before the grace period elapses.
				await manager.placeWorkspace(bob.id);
				await manager.sweepIdleWorkers(t0 + BASE_OPTIONS.idleGracePeriodMs);
				expect(destroyed).toEqual([]); // not empty anymore, timer cleared

				// It goes empty again - the grace period must restart from here.
				app.storage.setWorkspaceWorker(bob.id, null);
				await manager.sweepIdleWorkers(t0 + BASE_OPTIONS.idleGracePeriodMs); // re-observed empty now
				await manager.sweepIdleWorkers(
					t0 +
						BASE_OPTIONS.idleGracePeriodMs +
						BASE_OPTIONS.idleGracePeriodMs / 2,
				);
				expect(destroyed).toEqual([]); // only half the grace period since re-arming

				await manager.sweepIdleWorkers(
					t0 + BASE_OPTIONS.idleGracePeriodMs + BASE_OPTIONS.idleGracePeriodMs,
				);
				expect(destroyed.length).toBe(1);
			},
			{ containerAutoStart: false },
		);
	});
});
