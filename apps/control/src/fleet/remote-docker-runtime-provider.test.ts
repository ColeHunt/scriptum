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
 * worker droplets - see docs/decisions/048. sshDockerRunnerFactory itself
 * (the real SSH/DOCKER_HOST wiring) is covered separately in
 * containers/docker-client.test.ts; here the DockerRunner injected per worker
 * is a fake, since the point is to check *which* worker a call lands on, not
 * real SSH transport.
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
				app.storage.setWorkspaceWorker(alice.id, "worker-1");
				app.storage.setWorkspaceWorker(bob.id, "worker-2");

				const fakeDocker1 = createFakeDocker();
				const fakeDocker2 = createFakeDocker();
				const provider = new RemoteDockerRuntimeProvider(
					app.storage,
					(worker) =>
						worker.id === "worker-1" ? fakeDocker1.runner : fakeDocker2.runner,
				);

				await provider.ensureWorkspaceRunning(alice.id);
				expect(fakeDocker1.containers.size).toBe(1);
				expect(fakeDocker2.containers.size).toBe(0);

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
				const provider = new RemoteDockerRuntimeProvider(
					app.storage,
					() => fakeDocker.runner,
				);

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
				app.storage.setWorkspaceWorker(alice.id, "worker-1");
				app.storage.setWorkspaceWorker(bob.id, "worker-2");

				const fakeDocker1 = createFakeDocker();
				const fakeDocker2 = createFakeDocker();
				const provider = new RemoteDockerRuntimeProvider(
					app.storage,
					(worker) =>
						worker.id === "worker-1" ? fakeDocker1.runner : fakeDocker2.runner,
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
});
