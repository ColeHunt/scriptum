import { describe, expect, test } from "bun:test";
import type { CheckpointsStateResponse } from "@frc-coderunner/contracts";
import {
	cookieFrom,
	createFakeDocker,
	login,
	withApp,
	workspaceBySlug,
} from "./helpers";

describe("GET /u/:slug/api/checkpoints", () => {
	test("reports unavailable before any lesson is loaded", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const resp = await login(app, "alice");
				const cookie = cookieFrom(resp);

				const res = await app.fetch(
					new Request("http://localhost/u/alice/api/checkpoints", {
						headers: { cookie },
					}),
				);
				expect(res.status).toBe(200);
				const body = (await res.json()) as CheckpointsStateResponse;
				expect(body).toEqual({
					ok: true,
					state: { moduleId: null, available: false, checkpoints: [] },
				});
			},
			{ dockerRunner: docker.runner },
		);
	});

	test("reports unavailable for a loaded module with no checkpoints", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const resp = await login(app, "alice");
				const cookie = cookieFrom(resp);
				const workspace = workspaceBySlug(app, "alice");
				app.storage.setCurrentModule(workspace.id, "hello-world", "plain-java");

				const res = await app.fetch(
					new Request("http://localhost/u/alice/api/checkpoints", {
						headers: { cookie },
					}),
				);
				expect(res.status).toBe(200);
				const body = (await res.json()) as CheckpointsStateResponse;
				expect(body.state).toEqual({
					moduleId: "hello-world",
					available: false,
					checkpoints: [],
				});
			},
			{ dockerRunner: docker.runner },
		);
	});

	test("requires workspace ownership", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				await login(app, "alice");
				const bob = await login(app, "bob");
				const bobCookie = cookieFrom(bob);
				const res = await app.fetch(
					new Request("http://localhost/u/alice/api/checkpoints", {
						headers: { cookie: bobCookie },
					}),
				);
				expect(res.status).toBe(403);
			},
			{ dockerRunner: docker.runner },
		);
	});
});

describe("POST /u/:slug/api/checkpoints/verify", () => {
	test("400s when no lesson is loaded", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const resp = await login(app, "alice");
				const cookie = cookieFrom(resp);

				const res = await app.fetch(
					new Request("http://localhost/u/alice/api/checkpoints/verify", {
						method: "POST",
						headers: { cookie },
					}),
				);
				expect(res.status).toBe(400);
				const body = (await res.json()) as { error: string };
				expect(body.error).toContain("No lesson is loaded");
			},
			{ dockerRunner: docker.runner },
		);
	});

	test("requires workspace ownership", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				await login(app, "alice");
				const bob = await login(app, "bob");
				const bobCookie = cookieFrom(bob);
				const res = await app.fetch(
					new Request("http://localhost/u/alice/api/checkpoints/verify", {
						method: "POST",
						headers: { cookie: bobCookie },
					}),
				);
				expect(res.status).toBe(403);
			},
			{ dockerRunner: docker.runner },
		);
	});
});
