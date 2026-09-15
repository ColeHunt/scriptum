import { describe, expect, test } from "bun:test";
import { cookieFrom, exists, login, withApp } from "./helpers";

describe("session login and ownership", () => {
	test("new login creates a user, workspace, and an empty project dir", async () => {
		await withApp(async (app) => {
			const response = await login(app, "alice");
			expect(response.status).toBe(303);
			expect(response.headers.get("location")).toBe("/u/alice/");

			const userCount = app.storage.db
				.query("SELECT COUNT(*) AS count FROM user")
				.get() as { count: number };
			const workspaceCount = app.storage.db
				.query("SELECT COUNT(*) AS count FROM workspaces")
				.get() as {
				count: number;
			};
			const workspace = app.storage.db
				.query("SELECT * FROM workspaces WHERE slug = ?")
				.get("alice") as {
				project_path: string;
				current_module: string | null;
				current_module_kind: string | null;
			};

			expect(userCount.count).toBe(1);
			expect(workspaceCount.count).toBe(1);

			// The project dir exists but is EMPTY (no first-login template seed):
			// the student fills it from the lesson picker (Decision 029 / D7).
			expect(await exists(workspace.project_path)).toBe(true);
			const { readdir } = await import("node:fs/promises");
			expect((await readdir(workspace.project_path)).length).toBe(0);
			expect(workspace.current_module).toBeNull();
			expect(workspace.current_module_kind).toBeNull();
		});
	});

	test("mw_sso cookie redirects to the existing workspace", async () => {
		await withApp(async (app) => {
			const response = await login(app, "alice");
			const cookie = cookieFrom(response);

			const reload = await app.fetch(
				new Request("http://localhost/", {
					headers: { cookie },
				}),
			);
			expect(reload.status).toBe(303);
			expect(reload.headers.get("location")).toBe("/u/alice/");

			const workspace = await app.fetch(
				new Request("http://localhost/u/alice/", {
					headers: { cookie },
				}),
			);
			expect(workspace.status).toBe(200);
			expect(await workspace.text()).toContain("V2 test shell");
		});
	});

	test("rejects bad workspace slugs before serving a workspace page", async () => {
		await withApp(async (app) => {
			const response = await login(app, "alice");
			const cookie = cookieFrom(response);

			const badSlug = await app.fetch(
				new Request("http://localhost/u/alice.bob/", {
					headers: { cookie },
				}),
			);

			expect(badSlug.status).toBe(400);
		});
	});

	test("prevents another session from accessing a different user's workspace", async () => {
		await withApp(async (app) => {
			const alice = await login(app, "alice");
			const aliceCookie = cookieFrom(alice);

			await login(app, "bob");

			// Alice's cookie should not let her access Bob's workspace
			const bobAsAlice = await app.fetch(
				new Request("http://localhost/u/bob/", {
					headers: { cookie: aliceCookie },
				}),
			);
			expect(bobAsAlice.status).toBe(403);
		});
	});

	test("a returning user (same username) gets the same workspace, not a new one", async () => {
		await withApp(async (app) => {
			const first = await login(app, "alice");
			expect(first.status).toBe(303);
			expect(first.headers.get("location")).toBe("/u/alice/");

			const second = await login(app, "alice");
			expect(second.status).toBe(303);
			expect(second.headers.get("location")).toBe("/u/alice/");

			// No local session table under Legion - every request re-verifies the
			// mw_sso cookie fresh - so "returning" just means one user, one workspace.
			const userCount = app.storage.db
				.query("SELECT COUNT(*) AS count FROM user")
				.get() as { count: number };
			const workspaceCount = app.storage.db
				.query("SELECT COUNT(*) AS count FROM workspaces")
				.get() as {
				count: number;
			};
			expect(userCount.count).toBe(1);
			expect(workspaceCount.count).toBe(1);
		});
	});
});

describe("role from Legion groups", () => {
	test("coderunner-admin group grants admin; its absence does not", async () => {
		await withApp(async (app) => {
			const admin = await login(app, "coach", { role: "admin" });
			const student = await login(app, "alice", { role: "student" });

			const adminStatus = await app.fetch(
				new Request("http://localhost/admin/status", {
					headers: { cookie: cookieFrom(admin) },
				}),
			);
			expect(adminStatus.status).toBe(200);

			const studentStatus = await app.fetch(
				new Request("http://localhost/admin/status", {
					headers: { cookie: cookieFrom(student) },
				}),
			);
			expect(studentStatus.status).toBe(403);
		});
	});
});

describe("workspace creation concurrency", () => {
	test("concurrent first-logins with the same base slug get distinct slugs", async () => {
		await withApp(async (app) => {
			const ids = ["userAAAAAAAAAAAAAAAA", "userBBBBBBBBBBBBBBBB"];
			for (const [i, id] of ids.entries()) {
				app.storage.upsertLegionUser({
					id,
					name: `Alice${i}`,
					email: `alice${i}@example.com`,
					role: "student",
				});
			}

			const results = await Promise.all(
				ids.map((id) => app.storage.ensureWorkspaceForUser(id, "alice")),
			);
			const slugs = results.map((w) => w.slug);

			expect(slugs[0]).not.toBe(slugs[1]);
			expect(new Set(slugs)).toEqual(new Set(["alice", "alice-1"]));

			const workspaceCount = app.storage.db
				.query("SELECT COUNT(*) AS count FROM workspaces")
				.get() as {
				count: number;
			};
			expect(workspaceCount.count).toBe(2);
		});
	});
});
