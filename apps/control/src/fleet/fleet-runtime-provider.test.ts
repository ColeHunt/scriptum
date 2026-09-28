import { describe, expect, test } from "bun:test";
import {
	createFakeDocker,
	login,
	withApp,
	workspaceBySlug,
} from "../__tests__/helpers";
import { CapacityExceededError } from "../containers/errors";
import type { AppStorage } from "../storage";
import { FleetManager } from "./fleet-manager";
import { FleetRuntimeProvider } from "./fleet-runtime-provider";
import { RemoteDockerRuntimeProvider } from "./remote-docker-runtime-provider";
import type { FleetProvisioner, ProvisionedWorker } from "./types";

function setup(storage: AppStorage, maxWorkers = 3) {
	const creates: Array<(worker: ProvisionedWorker) => void> = [];
	const destroyed: string[] = [];
	const provisioner: FleetProvisioner = {
		createWorker: () =>
			new Promise<ProvisionedWorker>((resolve) => creates.push(resolve)),
		async destroyWorker(id) {
			destroyed.push(id);
		},
		async listWorkerDroplets() {
			return [];
		},
	};
	const readyIps = new Set<string>();
	const docker = createFakeDocker();
	const remote = new RemoteDockerRuntimeProvider(storage, (worker) => ({
		dockerRunner: docker.runner,
		publishHost: worker.private_ip,
		containerNetwork: null,
		portAvailable: async () => true,
	}));
	const manager = new FleetManager(
		storage,
		provisioner,
		{ isReady: async (worker) => readyIps.has(worker.private_ip) },
		{
			workerMemoryMb: 8192,
			codeMemoryLimitMb: 3072,
			maxWorkers,
			idleGracePeriodMs: 0,
			onWorkerRemoved: (id) => remote.forgetWorker(id),
		},
	);
	const provider = new FleetRuntimeProvider(storage, manager, remote);

	/** Finish the oldest droplet create and let the worker answer. */
	async function bootWorker(ip: string): Promise<void> {
		const resolve = creates.shift();
		if (!resolve) throw new Error("no pending create");
		resolve({ doDropletId: `do-${ip}`, privateIp: ip });
		await new Promise((r) => setTimeout(r, 0));
		readyIps.add(ip);
		await manager.checkProvisioningWorkers();
	}

	return { provider, manager, docker, creates, destroyed, bootWorker };
}

describe("FleetRuntimeProvider", () => {
	test("reports starting while a worker boots, then runs the workspace on it", async () => {
		await withApp(
			async (app) => {
				await login(app, "alice");
				const alice = workspaceBySlug(app, "alice");
				const { provider, docker, creates, bootWorker } = setup(app.storage);

				const starting = await provider.ensureWorkspaceRunning(alice.id);
				expect(starting.state).toBe("starting");
				expect(starting.error).toBeNull();
				expect(starting.endpoints.vscode).toBeNull();
				expect(creates.length).toBe(1);
				expect(docker.containers.size).toBe(0);

				await bootWorker("10.116.0.9");
				const running = await provider.ensureWorkspaceRunning(alice.id);
				expect(running.state).toBe("running");
				expect(running.endpoints.vscode?.httpBaseUrl).toMatch(
					/^http:\/\/10\.116\.0\.9:\d+$/,
				);
				expect(docker.containers.size).toBe(1);
			},
			{ containerAutoStart: false },
		);
	});

	test("stopping a workspace releases its worker slot, and the empty worker is destroyed", async () => {
		await withApp(
			async (app) => {
				await login(app, "alice");
				const alice = workspaceBySlug(app, "alice");
				const { provider, manager, destroyed, bootWorker } = setup(app.storage);
				await provider.ensureWorkspaceRunning(alice.id);
				await bootWorker("10.116.0.9");
				await provider.ensureWorkspaceRunning(alice.id);

				await provider.stopWorkspace(alice.id);
				expect(app.storage.findWorkspaceById(alice.id)?.worker_id).toBeNull();
				expect((await provider.getWorkspaceStatus(alice.id)).state).toBe(
					"stopped",
				);

				await manager.sweepIdleWorkers(0);
				await manager.sweepIdleWorkers(1);
				expect(destroyed).toEqual(["do-10.116.0.9"]);
			},
			{ containerAutoStart: false },
		);
	});

	test("releases a slot held by a workspace nobody has touched in a while", async () => {
		await withApp(
			async (app) => {
				await login(app, "alice");
				const alice = workspaceBySlug(app, "alice");
				const { provider, creates } = setup(app.storage);
				// The student leaves while their worker is still booting: the
				// droplet exists and holds their slot, but never ran a container.
				await provider.ensureWorkspaceRunning(alice.id);
				creates.shift()?.({ doDropletId: "do-1", privateIp: "10.116.0.9" });
				await new Promise((r) => setTimeout(r, 0));
				expect(
					app.storage.findWorkspaceById(alice.id)?.worker_id,
				).not.toBeNull();

				const idleMs = app.storage.config.idleStopMinutes * 60_000;
				await provider.releaseStalePlacements(Date.now() - 60_000);
				expect(
					app.storage.findWorkspaceById(alice.id)?.worker_id,
				).not.toBeNull();

				await provider.releaseStalePlacements(Date.now() + idleMs + 1_000);
				expect(app.storage.findWorkspaceById(alice.id)?.worker_id).toBeNull();
			},
			{ containerAutoStart: false },
		);
	});

	test("refuses exec before the workspace has a ready worker", async () => {
		await withApp(
			async (app) => {
				await login(app, "alice");
				const alice = workspaceBySlug(app, "alice");
				const { provider } = setup(app.storage);
				await provider.ensureWorkspaceRunning(alice.id);

				await expect(provider.exec(alice.id, ["true"])).rejects.toThrow(
					/not running/,
				);
				expect(() => provider.execStream(alice.id, ["true"])).toThrow(
					/not running/,
				);
			},
			{ containerAutoStart: false },
		);
	});

	test("surfaces fleet capacity as CapacityExceededError", async () => {
		await withApp(
			async (app) => {
				for (const slug of ["alice", "bob", "carol"]) await login(app, slug);
				const [alice, bob, carol] = ["alice", "bob", "carol"].map((slug) =>
					workspaceBySlug(app, slug),
				);
				const { provider } = setup(app.storage, 1);
				await provider.ensureWorkspaceRunning(alice!.id);
				await provider.ensureWorkspaceRunning(bob!.id);

				await expect(
					provider.ensureWorkspaceRunning(carol!.id),
				).rejects.toBeInstanceOf(CapacityExceededError);
			},
			{ containerAutoStart: false },
		);
	});
});
