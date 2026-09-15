import { describe, expect, test } from "bun:test";
import type { ControlAppOptions } from "../app";
import type { DockerRunner } from "../containers";
import {
	cookieFrom,
	createFakeDocker,
	login,
	missing,
	withApp,
} from "./helpers";

// choreo-server has no base-path awareness of its own (unlike codium-server,
// which is launched with --server-base-path): the control plane strips the
// /u/<slug>/api/choreo prefix before forwarding. Port mode does not lease a
// choreo port yet (docs/decisions/042-choreo-integration.md), so these run
// in network mode, same as network-mode.test.ts.

describe("choreo proxy", () => {
	test("unauthenticated GET /u/<slug>/api/choreo/healthz returns 401", async () => {
		await withApp(
			async (app) => {
				await login(app, "alice");

				// /api/ paths return a raw 401 rather than redirecting to /login
				// (that redirect is only for page-kind requests like /vscode/).
				const response = await app.fetch(
					new Request("http://localhost/u/alice/api/choreo/healthz", {
						method: "GET",
					}),
				);

				expect(response.status).toBe(401);
			},
			{ containerNetwork: "coderunner" },
		);
	});

	test("cross-workspace GET /u/<other>/api/choreo/healthz returns 403", async () => {
		await withApp(
			async (app) => {
				const aliceResponse = await login(app, "alice");
				const aliceCookie = cookieFrom(aliceResponse);
				await login(app, "bob");

				const response = await app.fetch(
					new Request("http://localhost/u/bob/api/choreo/healthz", {
						method: "GET",
						headers: { cookie: aliceCookie },
					}),
				);

				expect(response.status).toBe(403);
			},
			{ containerNetwork: "coderunner" },
		);
	});

	test("authenticated request proxies to choreo-server with the prefix stripped", async () => {
		const fakeDocker = createFakeDocker();
		let receivedPath = "";
		const upstreamFetch: ControlAppOptions["upstreamFetch"] = async (input) => {
			const url = new URL(String(input));
			receivedPath = url.pathname + url.search;
			return new Response(JSON.stringify({ ok: true }), {
				headers: { "content-type": "application/json" },
			});
		};

		await withApp(
			async (app) => {
				const aliceResponse = await login(app, "alice");
				const aliceCookie = cookieFrom(aliceResponse);

				const response = await app.fetch(
					new Request(
						"http://localhost/u/alice/api/choreo/project/default?x=1",
						{ method: "GET", headers: { cookie: aliceCookie } },
					),
				);

				expect(response.status).toBe(200);
				expect(await response.json()).toEqual({ ok: true });
				expect(receivedPath).toBe("/project/default?x=1");
			},
			{
				dockerRunner: fakeDocker.runner,
				upstreamFetch,
				codeImage: "coderunner-workspace:test",
				containerNetwork: "coderunner",
			},
		);
	});

	test("bare /api/choreo (no trailing path) proxies to upstream root", async () => {
		const fakeDocker = createFakeDocker();
		let receivedPath = "";
		const upstreamFetch: ControlAppOptions["upstreamFetch"] = async (input) => {
			const url = new URL(String(input));
			receivedPath = url.pathname;
			return new Response("ok");
		};

		await withApp(
			async (app) => {
				const aliceResponse = await login(app, "alice");
				const aliceCookie = cookieFrom(aliceResponse);

				await app.fetch(
					new Request("http://localhost/u/alice/api/choreo", {
						method: "GET",
						headers: { cookie: aliceCookie },
					}),
				);

				expect(receivedPath).toBe("/");
			},
			{
				dockerRunner: fakeDocker.runner,
				upstreamFetch,
				codeImage: "coderunner-workspace:test",
				containerNetwork: "coderunner",
			},
		);
	});

	test("returns 503 when the code image is unavailable", async () => {
		const dockerRunner: DockerRunner = async () => missing("No such image");

		await withApp(
			async (app) => {
				const aliceResponse = await login(app, "alice");
				const aliceCookie = cookieFrom(aliceResponse);

				const response = await app.fetch(
					new Request("http://localhost/u/alice/api/choreo/healthz", {
						method: "GET",
						headers: { cookie: aliceCookie },
					}),
				);

				expect(response.status).toBe(503);
			},
			{ dockerRunner, containerNetwork: "coderunner" },
		);
	});

	test("PUT request bodies are forwarded to the upstream", async () => {
		const fakeDocker = createFakeDocker();
		let receivedBody = "";
		const upstreamFetch: ControlAppOptions["upstreamFetch"] = async (
			_input,
			init,
		) => {
			receivedBody = await new Response(
				init?.body as BodyInit | null | undefined,
			).text();
			return new Response(null, { status: 204 });
		};

		await withApp(
			async (app) => {
				const aliceResponse = await login(app, "alice");
				const aliceCookie = cookieFrom(aliceResponse);

				const response = await app.fetch(
					new Request("http://localhost/u/alice/api/choreo/project", {
						method: "PUT",
						headers: {
							cookie: aliceCookie,
							"content-type": "application/json",
						},
						body: JSON.stringify({ name: "swerve" }),
					}),
				);

				expect(response.status).toBe(204);
				expect(receivedBody).toBe('{"name":"swerve"}');
			},
			{
				dockerRunner: fakeDocker.runner,
				upstreamFetch,
				codeImage: "coderunner-workspace:test",
				containerNetwork: "coderunner",
			},
		);
	});
});
