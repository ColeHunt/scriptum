import { describe, expect, test } from "bun:test";
import { withNt4AppName } from "../app/proxy";
import { cookieFrom, login, withApp } from "./helpers";

describe("Elastic Dashboard routing", () => {
	test("serves the Elastic web dist under /elastic", async () => {
		await withApp(async (app) => {
			const index = await app.fetch(new Request("http://localhost/elastic/"));
			expect(index.status).toBe(200);
			expect(index.headers.get("content-type")).toContain("text/html");
			expect(await index.text()).toContain("Elastic test dist");

			const main = await app.fetch(
				new Request("http://localhost/elastic/main.js"),
			);
			expect(main.status).toBe(200);
			expect(main.headers.get("content-type")).toContain("text/javascript");
		});
	});

	test("serves a 503 with a helpful message when the dist is missing", async () => {
		await withApp(
			async (app) => {
				const index = await app.fetch(new Request("http://localhost/elastic/"));
				expect(index.status).toBe(503);
				expect(await index.text()).toContain("build:elastic");
			},
			{ elasticDistDir: "/nonexistent-elastic-dist" },
		);
	});

	test("round-trips a layout through /api/elastic-layout, scoped to the owning workspace", async () => {
		await withApp(async (app) => {
			const aliceLogin = await login(app, "alice");
			const aliceCookie = cookieFrom(aliceLogin);
			const bobLogin = await login(app, "bob");
			const bobCookie = cookieFrom(bobLogin);

			const missing = await app.fetch(
				new Request("http://localhost/u/alice/api/elastic-layout", {
					headers: { cookie: aliceCookie },
				}),
			);
			expect(missing.status).toBe(404);

			const layout = JSON.stringify({ version: 1.0, tabs: [] });
			const put = await app.fetch(
				new Request("http://localhost/u/alice/api/elastic-layout", {
					method: "PUT",
					headers: { cookie: aliceCookie, "content-type": "application/json" },
					body: layout,
				}),
			);
			expect(put.status).toBe(200);

			const get = await app.fetch(
				new Request("http://localhost/u/alice/api/elastic-layout", {
					headers: { cookie: aliceCookie },
				}),
			);
			expect(get.status).toBe(200);
			expect(await get.text()).toBe(layout);

			const bobReadsAlice = await app.fetch(
				new Request("http://localhost/u/alice/api/elastic-layout", {
					headers: { cookie: bobCookie },
				}),
			);
			expect(bobReadsAlice.status).toBe(403);

			const bobWritesAlice = await app.fetch(
				new Request("http://localhost/u/alice/api/elastic-layout", {
					method: "PUT",
					headers: { cookie: bobCookie, "content-type": "application/json" },
					body: layout,
				}),
			);
			expect(bobWritesAlice.status).toBe(403);
		});
	});

	test("rejects a layout PUT that isn't a JSON object", async () => {
		await withApp(async (app) => {
			const aliceLogin = await login(app, "alice");
			const aliceCookie = cookieFrom(aliceLogin);

			const notJson = await app.fetch(
				new Request("http://localhost/u/alice/api/elastic-layout", {
					method: "PUT",
					headers: { cookie: aliceCookie },
					body: "not json",
				}),
			);
			expect(notJson.status).toBe(400);

			const jsonArray = await app.fetch(
				new Request("http://localhost/u/alice/api/elastic-layout", {
					method: "PUT",
					headers: { cookie: aliceCookie, "content-type": "application/json" },
					body: "[]",
				}),
			);
			expect(jsonArray.status).toBe(400);
		});
	});
});

describe("withNt4AppName", () => {
	test("substitutes the trailing /nt/<name> segment with the requested app name", () => {
		expect(
			withNt4AppName("ws://127.0.0.1:25810/nt/AdvantageScopeLite", "Elastic"),
		).toBe("ws://127.0.0.1:25810/nt/Elastic");
	});

	test("falls back to AdvantageScopeLite for a missing or invalid app name", () => {
		expect(
			withNt4AppName("ws://127.0.0.1:25810/nt/AdvantageScopeLite", null),
		).toBe("ws://127.0.0.1:25810/nt/AdvantageScopeLite");
		expect(
			withNt4AppName(
				"ws://127.0.0.1:25810/nt/AdvantageScopeLite",
				"has spaces",
			),
		).toBe("ws://127.0.0.1:25810/nt/AdvantageScopeLite");
		expect(
			withNt4AppName("ws://127.0.0.1:25810/nt/AdvantageScopeLite", "../escape"),
		).toBe("ws://127.0.0.1:25810/nt/AdvantageScopeLite");
	});
});
