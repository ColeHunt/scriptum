import { describe, expect, test } from "bun:test";
import {
	createFakeDocker,
	login,
	withApp,
	workspaceBySlug,
} from "../__tests__/helpers";
import { RemoteDockerRuntimeProvider } from "./remote-docker-runtime-provider";

/**
 * Verifies RemoteDockerRuntimeProvider's routing/dispatch/aggregation
 * behavior against two independent fake Docker daemons standing in for two
 * worker droplets - see docs/decisions/048. The DOCKER_HOST env plumbing
 * itself is covered in containers/docker-client.test.ts; here the
 * DockerRunner injected per worker is a fake, since the point is to check
 * *which* worker a call lands on and where it publishes, not real SSH.
 */
describe("RemoteDockerRuntimeProvider", () => {
	test("routes each workspace's calls to its assigned worker only", async () => {
		await withApp(
			async (app) => {
				await login(app, "alice");
				await login(app, "bob");
				const alice = workspaceBySlug(app, "alice");
				const bob = workspaceBySlug(app, "bob");

				app.storage.createWorker({
					id: "worker-1",
					doDropletId: "do-1",
					privateIp: "10.0.0.1",
					capacity: 4,
				});
				app.storage.createWorker({
					id: "worker-2",
					doDropletId: "do-2",
					privateIp: "10.0.0.2",
					capacity: 4,
				});
				app.storage.setWorkerStatus("worker-1", "ready");
				app.storage.setWorkerStatus("worker-2", "ready");
				app.storage.setWorkspaceWorker(alice.id, "worker-1");
				app.storage.setWorkspaceWorker(bob.id, "worker-2");

				const fakeDocker1 = createFakeDocker();
				const fakeDocker2 = createFakeDocker();
				const provider = new RemoteDockerRuntimeProvider(
					app.storage,
					(worker) => ({
						dockerRunner:
							worker.id === "worker-1"
								? fakeDocker1.runner
								: fakeDocker2.runner,
						publishHost: worker.private_ip,
						containerNetwork: null,
						portAvailable: async () => true,
					}),
				);

				const aliceRuntime = await provider.ensureWorkspaceRunning(alice.id);
				expect(fakeDocker1.containers.size).toBe(1);
				expect(fakeDocker2.containers.size).toBe(0);

				// Ports publish on the worker's private IP, and the head proxies there.
				const run = fakeDocker1.calls.find((args) => args[0] === "run") ?? [];
				const published = run.filter((_, i) => run[i - 1] === "-p");
				expect(published.length).toBe(3);
				for (const mapping of published) {
					expect(mapping.startsWith("10.0.0.1:")).toBe(true);
				}
				expect(aliceRuntime.endpoints.vscode?.httpBaseUrl).toMatch(
					/^http:\/\/10\.0\.0\.1:\d+$/,
				);
				expect(aliceRuntime.endpoints.halsim?.wsUrl).toMatch(
					/^ws:\/\/10\.0\.0\.1:\d+\/wpilibws$/,
				);

				// Re-ensuring adopts the container published on the worker IP rather
				// than recreating it.
				await provider.ensureWorkspaceRunning(alice.id);
				expect(
					fakeDocker1.calls.filter((args) => args[0] === "run").length,
				).toBe(1);

				await provider.ensureWorkspaceRunning(bob.id);
				expect(fakeDocker1.containers.size).toBe(1);
				expect(fakeDocker2.containers.size).toBe(1);
			},
			{ containerAutoStart: false },
		);
	});

	test("throws for a workspace with no worker assigned yet", async () => {
		await withApp(
			async (app) => {
				await login(app, "alice");
				const alice = workspaceBySlug(app, "alice");

				const fakeDocker = createFakeDocker();
				const provider = new RemoteDockerRuntimeProvider(app.storage, () => ({
					dockerRunner: fakeDocker.runner,
				}));

				await expect(provider.ensureWorkspaceRunning(alice.id)).rejects.toThrow(
					/no worker assigned/i,
				);
			},
			{ containerAutoStart: false },
		);
	});

	test("listRuntimes/countRunningWorkspaces fan out and aggregate across every known worker", async () => {
		await withApp(
			async (app) => {
				await login(app, "alice");
				await login(app, "bob");
				const alice = workspaceBySlug(app, "alice");
				const bob = workspaceBySlug(app, "bob");

				app.storage.createWorker({
					id: "worker-1",
					doDropletId: "do-1",
					privateIp: "10.0.0.1",
					capacity: 4,
				});
				app.storage.createWorker({
					id: "worker-2",
					doDropletId: "do-2",
					privateIp: "10.0.0.2",
					capacity: 4,
				});
				app.storage.setWorkerStatus("worker-1", "ready");
				app.storage.setWorkerStatus("worker-2", "ready");
				app.storage.setWorkspaceWorker(alice.id, "worker-1");
				app.storage.setWorkspaceWorker(bob.id, "worker-2");

				const fakeDocker1 = createFakeDocker();
				const fakeDocker2 = createFakeDocker();
				const provider = new RemoteDockerRuntimeProvider(
					app.storage,
					(worker) => ({
						dockerRunner:
							worker.id === "worker-1"
								? fakeDocker1.runner
								: fakeDocker2.runner,
						publishHost: worker.private_ip,
						containerNetwork: null,
						portAvailable: async () => true,
					}),
				);

				await provider.ensureWorkspaceRunning(alice.id);
				await provider.ensureWorkspaceRunning(bob.id);

				expect(await provider.countRunningWorkspaces()).toBe(2);
				const runtimes = await provider.listRuntimes();
				expect(runtimes.length).toBe(2);
			},
			{ containerAutoStart: false },
		);
	});

	test("fan-out skips booting workers and tolerates an unreachable one", async () => {
		await withApp(
			async (app) => {
				await login(app, "alice");
				const alice = workspaceBySlug(app, "alice");
				for (const id of ["worker-1", "worker-2", "worker-3"]) {
					app.storage.createWorker({
						id,
						doDropletId: `do-${id}`,
						privateIp: `10.0.0.${id.at(-1)}`,
						capacity: 2,
					});
				}
				app.storage.setWorkerStatus("worker-1", "ready");
				app.storage.setWorkerStatus("worker-2", "ready");
				// worker-3 stays provisioning.
				app.storage.setWorkspaceWorker(alice.id, "worker-1");

				const healthy = createFakeDocker();
				const touched: string[] = [];
				const provider = new RemoteDockerRuntimeProvider(
					app.storage,
					(worker) => ({
						dockerRunner: async (args) => {
							touched.push(worker.id);
							if (worker.id === "worker-2") {
								throw new Error("ssh: connect to host 10.0.0.2: timed out");
							}
							return healthy.runner(args);
						},
						publishHost: worker.private_ip,
						containerNetwork: null,
						portAvailable: async () => true,
					}),
				);

				await provider.ensureWorkspaceRunning(alice.id);
				expect(await provider.countRunningWorkspaces()).toBe(1);
				expect(touched).not.toContain("worker-3");
			},
			{ containerAutoStart: false },
		);
	});
});
