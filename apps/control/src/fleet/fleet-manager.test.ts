import { describe, expect, test } from "bun:test";
import { login, withApp, workspaceBySlug } from "../__tests__/helpers";
import { CapacityExceededError } from "../containers/errors";
import type { AppStorage, WorkerRow } from "../storage";
import { FleetManager, type FleetManagerOptions } from "./fleet-manager";
import type {
	FleetProvisioner,
	ProvisionedWorker,
	WorkerDroplet,
	WorkerProbe,
} from "./types";

type Deferred = {
	resolve(value: ProvisionedWorker): void;
	reject(err: Error): void;
};

/** In-memory DigitalOcean: creates stay pending until the test settles them,
 * and `droplets` is what listWorkerDroplets reports. */
function createFakeCloud() {
	const creates: Deferred[] = [];
	const destroyed: string[] = [];
	const droplets = new Map<string, WorkerDroplet>();
	let nextId = 1;
	let failDestroy = false;

	const provisioner: FleetProvisioner = {
		createWorker() {
			return new Promise<ProvisionedWorker>((resolve, reject) => {
				creates.push({ resolve, reject });
			});
		},
		async destroyWorker(doDropletId) {
			if (failDestroy) throw new Error("DO API unavailable");
			destroyed.push(doDropletId);
			droplets.delete(doDropletId);
		},
		async listWorkerDroplets() {
			return [...droplets.values()];
		},
	};

	/** Settle the oldest pending create successfully. */
	async function finishCreate(nowMs = 0): Promise<string> {
		const create = creates.shift();
		if (!create) throw new Error("no pending create");
		const id = nextId++;
		const dropletId = `do-${id}`;
		droplets.set(dropletId, { doDropletId: dropletId, createdAtMs: nowMs });
		create.resolve({ doDropletId: dropletId, privateIp: `10.0.0.${id}` });
		await flush();
		return dropletId;
	}

	async function failCreate(message = "quota exceeded"): Promise<void> {
		const create = creates.shift();
		if (!create) throw new Error("no pending create");
		create.reject(new Error(message));
		await flush();
	}

	return {
		provisioner,
		creates,
		destroyed,
		droplets,
		finishCreate,
		failCreate,
		setFailDestroy(value: boolean) {
			failDestroy = value;
		},
	};
}

function createProbe(readyIps: Set<string>): WorkerProbe {
	return {
		async isReady(worker: WorkerRow) {
			return readyIps.has(worker.private_ip);
		},
	};
}

async function flush(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

const BASE_OPTIONS = {
	workerMemoryMb: 8192,
	codeMemoryLimitMb: 3072, // capacity 2
	maxWorkers: 3,
	idleGracePeriodMs: 20 * 60_000,
};

function setup(
	storage: AppStorage,
	overrides: Partial<FleetManagerOptions> = {},
) {
	const cloud = createFakeCloud();
	const readyIps = new Set<string>();
	const clock = { now: 0 };
	const removed: string[] = [];
	const manager = new FleetManager(
		storage,
		cloud.provisioner,
		createProbe(readyIps),
		{
			...BASE_OPTIONS,
			now: () => clock.now,
			onWorkerRemoved: (id) => removed.push(id),
			...overrides,
		},
	);
	return { cloud, readyIps, clock, removed, manager };
}

function workerOf(storage: AppStorage, workspaceId: string): WorkerRow | null {
	const workerId = storage.findWorkspaceById(workspaceId as never)?.worker_id;
	return workerId ? storage.getWorker(workerId) : null;
}

async function logins(
	app: Parameters<Parameters<typeof withApp>[0]>[0],
	slugs: string[],
) {
	for (const slug of slugs) await login(app, slug);
	return slugs.map((slug) => workspaceBySlug(app, slug));
}

describe("FleetManager placement", () => {
	test("an empty fleet creates one worker without blocking, then places onto it", async () => {
		await withApp(
			async (app) => {
				const [alice] = await logins(app, ["alice"]);
				const { cloud, manager } = setup(app.storage);

				expect(manager.placeWorkspace(alice!.id)).toEqual({ kind: "pending" });
				expect(cloud.creates.length).toBe(1);
				// Polling again while the droplet boots doesn't create another.
				expect(manager.placeWorkspace(alice!.id)).toEqual({ kind: "pending" });
				expect(cloud.creates.length).toBe(1);

				await cloud.finishCreate();
				const worker = workerOf(app.storage, alice!.id);
				expect(worker?.status).toBe("provisioning");
				expect(manager.placeWorkspace(alice!.id)).toEqual({
					kind: "placed",
					workerId: worker!.id,
					ready: false,
				});
			},
			{ containerAutoStart: false },
		);
	});

	test("workspaces arriving during a boot share that worker up to its capacity", async () => {
		await withApp(
			async (app) => {
				const [a, b, c] = await logins(app, ["alice", "bob", "carol"]);
				const { cloud, manager } = setup(app.storage);

				manager.placeWorkspace(a!.id);
				manager.placeWorkspace(b!.id);
				expect(cloud.creates.length).toBe(1);
				// Capacity 2: the third needs a second droplet.
				manager.placeWorkspace(c!.id);
				expect(cloud.creates.length).toBe(2);

				await cloud.finishCreate();
				await cloud.finishCreate();
				expect(workerOf(app.storage, a!.id)?.id).toBe(
					workerOf(app.storage, b!.id)?.id,
				);
				expect(workerOf(app.storage, c!.id)?.id).not.toBe(
					workerOf(app.storage, a!.id)?.id,
				);
			},
			{ containerAutoStart: false },
		);
	});

	test("prefers a ready worker over a booting one, and the fullest ready one", async () => {
		await withApp(
			async (app) => {
				const [a, b] = await logins(app, ["alice", "bob"]);
				const { cloud, manager } = setup(app.storage, {
					workerMemoryMb: 16384, // capacity 5
				});
				for (const id of ["booting", "emptier", "fuller"]) {
					app.storage.createWorker({
						id,
						doDropletId: `do-${id}`,
						privateIp: `10.1.0.${id.length}`,
						capacity: 5,
					});
				}
				app.storage.setWorkerStatus("emptier", "ready");
				app.storage.setWorkerStatus("fuller", "ready");
				app.storage.setWorkspaceWorker(a!.id, "fuller");

				expect(manager.placeWorkspace(b!.id)).toEqual({
					kind: "placed",
					workerId: "fuller",
					ready: true,
				});
				expect(cloud.creates.length).toBe(0);
			},
			{ containerAutoStart: false },
		);
	});

	test("refuses placement at maxWorkers instead of creating more", async () => {
		await withApp(
			async (app) => {
				const [a, b, c] = await logins(app, ["alice", "bob", "carol"]);
				const { cloud, manager } = setup(app.storage, { maxWorkers: 1 });

				manager.placeWorkspace(a!.id);
				manager.placeWorkspace(b!.id);
				expect(() => manager.placeWorkspace(c!.id)).toThrow(
					CapacityExceededError,
				);
				expect(cloud.creates.length).toBe(1);

				await cloud.finishCreate();
				expect(() => manager.placeWorkspace(c!.id)).toThrow(
					CapacityExceededError,
				);
				expect(cloud.creates.length).toBe(0);
			},
			{ containerAutoStart: false },
		);
	});

	test("a failed create backs off instead of retrying on every poll", async () => {
		await withApp(
			async (app) => {
				const [alice] = await logins(app, ["alice"]);
				const { cloud, clock, manager } = setup(app.storage, {
					createFailureBackoffMs: 120_000,
				});

				manager.placeWorkspace(alice!.id);
				await cloud.failCreate("size not available");

				const placement = manager.placeWorkspace(alice!.id);
				expect(placement.kind).toBe("failed");
				expect(placement.kind === "failed" ? placement.message : "").toContain(
					"size not available",
				);
				expect(cloud.creates.length).toBe(0);

				clock.now = 120_000;
				expect(manager.placeWorkspace(alice!.id)).toEqual({ kind: "pending" });
				expect(cloud.creates.length).toBe(1);
			},
			{ containerAutoStart: false },
		);
	});

	test("unplacing drops a reservation on a droplet still being created", async () => {
		await withApp(
			async (app) => {
				const [alice] = await logins(app, ["alice"]);
				const { cloud, manager } = setup(app.storage);

				manager.placeWorkspace(alice!.id);
				manager.unplaceWorkspace(alice!.id);
				expect(manager.lookup(alice!.id)).toEqual({ kind: "unplaced" });

				await cloud.finishCreate();
				expect(workerOf(app.storage, alice!.id)).toBeNull();
			},
			{ containerAutoStart: false },
		);
	});
});

describe("FleetManager maintenance", () => {
	test("promotes a booting worker once the probe answers", async () => {
		await withApp(
			async (app) => {
				const [alice] = await logins(app, ["alice"]);
				const { cloud, readyIps, manager } = setup(app.storage);
				manager.placeWorkspace(alice!.id);
				await cloud.finishCreate();
				const worker = workerOf(app.storage, alice!.id)!;

				await manager.checkProvisioningWorkers();
				expect(app.storage.getWorker(worker.id)?.status).toBe("provisioning");

				readyIps.add(worker.private_ip);
				await manager.checkProvisioningWorkers();
				expect(manager.lookup(alice!.id)).toEqual({
					kind: "placed",
					workerId: worker.id,
					ready: true,
				});
			},
			{ containerAutoStart: false },
		);
	});

	test("destroys a worker that never becomes ready and unplaces its workspaces", async () => {
		await withApp(
			async (app) => {
				const [alice] = await logins(app, ["alice"]);
				const { cloud, clock, removed, manager } = setup(app.storage, {
					readyTimeoutMs: 10 * 60_000,
				});
				manager.placeWorkspace(alice!.id);
				const dropletId = await cloud.finishCreate();
				const worker = workerOf(app.storage, alice!.id)!;

				clock.now = Date.parse(worker.created_at) + 10 * 60_000;
				await manager.checkProvisioningWorkers();

				expect(cloud.destroyed).toEqual([dropletId]);
				expect(app.storage.getWorker(worker.id)).toBeNull();
				expect(manager.lookup(alice!.id)).toEqual({ kind: "unplaced" });
				expect(removed).toEqual([worker.id]);
			},
			{ containerAutoStart: false },
		);
	});

	test("destroys a ready worker only after it has been empty for the grace period", async () => {
		await withApp(
			async (app) => {
				const [alice] = await logins(app, ["alice"]);
				const { cloud, readyIps, clock, manager } = setup(app.storage);
				manager.placeWorkspace(alice!.id);
				const dropletId = await cloud.finishCreate();
				const worker = workerOf(app.storage, alice!.id)!;
				readyIps.add(worker.private_ip);
				await manager.checkProvisioningWorkers();

				expect(await manager.sweepIdleWorkers(0)).toEqual([]);

				manager.unplaceWorkspace(alice!.id);
				expect(await manager.sweepIdleWorkers(1_000)).toEqual([]);
				expect(await manager.sweepIdleWorkers(1_000 + 20 * 60_000 - 1)).toEqual(
					[],
				);
				expect(await manager.sweepIdleWorkers(1_000 + 20 * 60_000)).toEqual([
					worker.id,
				]);
				expect(cloud.destroyed).toEqual([dropletId]);
				void clock;
			},
			{ containerAutoStart: false },
		);
	});

	test("re-placing a workspace resets the empty-worker clock", async () => {
		await withApp(
			async (app) => {
				const [alice] = await logins(app, ["alice"]);
				const { cloud, readyIps, manager } = setup(app.storage);
				manager.placeWorkspace(alice!.id);
				await cloud.finishCreate();
				const worker = workerOf(app.storage, alice!.id)!;
				readyIps.add(worker.private_ip);
				await manager.checkProvisioningWorkers();

				manager.unplaceWorkspace(alice!.id);
				await manager.sweepIdleWorkers(0);
				manager.placeWorkspace(alice!.id);
				await manager.sweepIdleWorkers(10 * 60_000);
				manager.unplaceWorkspace(alice!.id);
				await manager.sweepIdleWorkers(15 * 60_000);
				// 20 min after the original empty time, but only 5 since the new one.
				expect(await manager.sweepIdleWorkers(20 * 60_000)).toEqual([]);
			},
			{ containerAutoStart: false },
		);
	});

	test("finishes a destroy that failed partway on the next sweep", async () => {
		await withApp(
			async (app) => {
				const [alice] = await logins(app, ["alice"]);
				const { cloud, readyIps, manager } = setup(app.storage, {
					idleGracePeriodMs: 0,
				});
				manager.placeWorkspace(alice!.id);
				const dropletId = await cloud.finishCreate();
				const worker = workerOf(app.storage, alice!.id)!;
				readyIps.add(worker.private_ip);
				await manager.checkProvisioningWorkers();
				manager.unplaceWorkspace(alice!.id);

				cloud.setFailDestroy(true);
				await manager.sweepIdleWorkers(0).catch(() => undefined);
				expect(app.storage.getWorker(worker.id)?.status).toBe("destroying");
				// A destroying worker never takes new placements.
				expect(manager.placeWorkspace(alice!.id)).toEqual({ kind: "pending" });
				manager.unplaceWorkspace(alice!.id);

				cloud.setFailDestroy(false);
				await manager.sweepIdleWorkers(1);
				expect(app.storage.getWorker(worker.id)).toBeNull();
				expect(cloud.destroyed).toEqual([dropletId]);
			},
			{ containerAutoStart: false },
		);
	});

	test("destroys old unknown worker droplets but leaves young ones alone", async () => {
		await withApp(
			async (app) => {
				const { cloud, manager } = setup(app.storage, {
					orphanGraceMs: 15 * 60_000,
				});
				cloud.droplets.set("do-old", {
					doDropletId: "do-old",
					createdAtMs: 0,
				});
				cloud.droplets.set("do-young", {
					doDropletId: "do-young",
					createdAtMs: 10 * 60_000,
				});

				await manager.reconcileDroplets(15 * 60_000);
				expect(cloud.destroyed).toEqual(["do-old"]);
			},
			{ containerAutoStart: false },
		);
	});

	test("drops a worker whose droplet was deleted outside the head", async () => {
		await withApp(
			async (app) => {
				const [alice] = await logins(app, ["alice"]);
				const { cloud, removed, manager } = setup(app.storage);
				manager.placeWorkspace(alice!.id);
				const dropletId = await cloud.finishCreate();
				const worker = workerOf(app.storage, alice!.id)!;

				cloud.droplets.delete(dropletId);
				await manager.reconcileDroplets(0);

				expect(app.storage.getWorker(worker.id)).toBeNull();
				expect(manager.lookup(alice!.id)).toEqual({ kind: "unplaced" });
				expect(removed).toEqual([worker.id]);
				expect(cloud.destroyed).toEqual([]);
			},
			{ containerAutoStart: false },
		);
	});
});
