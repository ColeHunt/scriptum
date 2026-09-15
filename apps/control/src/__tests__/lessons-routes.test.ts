import { describe, expect, test } from "bun:test";
import type { LessonModuleWithLockState } from "@frc-scriptum/contracts";
import {
	cookieFrom,
	createFakeDocker,
	login,
	withApp,
	workspaceBySlug,
} from "./helpers";

describe("GET /u/:slug/api/lessons", () => {
	test("returns the bundled manifest sorted by order", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const resp = await login(app, "alice");
				const cookie = cookieFrom(resp);

				const lessons = await app.fetch(
					new Request("http://localhost/u/alice/api/lessons", {
						headers: { cookie },
					}),
				);
				expect(lessons.status).toBe(200);
				const body = (await lessons.json()) as {
					ok: boolean;
					modules: LessonModuleWithLockState[];
					error: string | null;
				};
				expect(body.ok).toBe(true);
				expect(body.error).toBeNull();
				expect(body.modules.map((m) => m.id)).toEqual([
					"hello-world",
					"robot-starter",
					"checkpoint-demo",
					"locked-followup",
				]);
				expect(body.modules[0]?.kind).toBe("plain-java");
			},
			{ dockerRunner: docker.runner },
		);
	});

	test("locks a module behind an incomplete prerequisite, and unlocks it once completed", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const resp = await login(app, "alice");
				const cookie = cookieFrom(resp);
				const workspace = workspaceBySlug(app, "alice");

				const before = (await (
					await app.fetch(
						new Request("http://localhost/u/alice/api/lessons", {
							headers: { cookie },
						}),
					)
				).json()) as { modules: LessonModuleWithLockState[] };
				const lockedBefore = before.modules.find(
					(m) => m.id === "locked-followup",
				);
				expect(lockedBefore).toMatchObject({
					locked: true,
					missingPrerequisites: ["Checkpoint Demo"],
				});

				// Complete every required checkpoint of checkpoint-demo directly
				// against storage - equivalent to the student passing Verify.
				const now = new Date().toISOString();
				for (const checkpointId of ["first-commit", "rebase"]) {
					app.storage.setCheckpointResult(workspace.id, "checkpoint-demo", {
						checkpointId,
						status: "passed",
						message: null,
						verifiedAt: now,
					});
				}

				const after = (await (
					await app.fetch(
						new Request("http://localhost/u/alice/api/lessons", {
							headers: { cookie },
						}),
					)
				).json()) as { modules: LessonModuleWithLockState[] };
				expect(
					after.modules.find((m) => m.id === "locked-followup"),
				).toMatchObject({ locked: false, missingPrerequisites: [] });
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
				const resp = await app.fetch(
					new Request("http://localhost/u/alice/api/lessons", {
						headers: { cookie: bobCookie },
					}),
				);
				expect(resp.status).toBe(403);
			},
			{ dockerRunner: docker.runner },
		);
	});
});

describe("POST /u/:slug/api/lessons/load", () => {
	test("resolves a known module and 404s an unknown one", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const resp = await login(app, "alice");
				const cookie = cookieFrom(resp);

				const ok = await app.fetch(
					new Request("http://localhost/u/alice/api/lessons/load", {
						method: "POST",
						headers: { cookie, "content-type": "application/json" },
						body: JSON.stringify({ moduleId: "hello-world" }),
					}),
				);
				expect(ok.status).toBe(200);
				expect(await ok.json()).toEqual({ ok: true });

				const unknown = await app.fetch(
					new Request("http://localhost/u/alice/api/lessons/load", {
						method: "POST",
						headers: { cookie, "content-type": "application/json" },
						body: JSON.stringify({ moduleId: "does-not-exist" }),
					}),
				);
				expect(unknown.status).toBe(404);

				const bad = await app.fetch(
					new Request("http://localhost/u/alice/api/lessons/load", {
						method: "POST",
						headers: { cookie, "content-type": "application/json" },
						body: JSON.stringify({ moduleId: "" }),
					}),
				);
				expect(bad.status).toBe(400);
			},
			{ dockerRunner: docker.runner },
		);
	});

	test("423s a locked module with a message naming the missing prerequisite", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const resp = await login(app, "alice");
				const cookie = cookieFrom(resp);

				const locked = await app.fetch(
					new Request("http://localhost/u/alice/api/lessons/load", {
						method: "POST",
						headers: { cookie, "content-type": "application/json" },
						body: JSON.stringify({ moduleId: "locked-followup" }),
					}),
				);
				expect(locked.status).toBe(423);
				const body = (await locked.json()) as { error: string };
				expect(body.error).toContain("Checkpoint Demo");
			},
			{ dockerRunner: docker.runner },
		);
	});
});

describe("/api/session reflects the loaded module", () => {
	test("currentModule + projectEmpty update after a bundled lesson load", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const resp = await login(app, "alice");
				const cookie = cookieFrom(resp);

				// Fresh workspace: empty, no module.
				const before = (await (
					await app.fetch(
						new Request("http://localhost/u/alice/api/session", {
							headers: { cookie },
						}),
					)
				).json()) as {
					workspace: {
						currentModule: string | null;
						currentModuleKind: string | null;
						projectEmpty: boolean;
					};
				};
				expect(before.workspace.currentModule).toBeNull();
				expect(before.workspace.projectEmpty).toBe(true);

				// Simulate a completed lesson load by recording the module + writing a
				// file into the host project dir (the real load streams over WS).
				const workspace = app.storage.db
					.query("SELECT * FROM workspaces WHERE slug = ?")
					.get("alice") as { id: string; project_path: string };
				app.storage.setCurrentModule(
					workspace.id as never,
					"hello-world",
					"plain-java",
				);
				const { writeFile } = await import("node:fs/promises");
				await writeFile(
					`${workspace.project_path}/README.md`,
					"# hi\n",
					"utf8",
				);

				const after = (await (
					await app.fetch(
						new Request("http://localhost/u/alice/api/session", {
							headers: { cookie },
						}),
					)
				).json()) as {
					workspace: {
						currentModule: string | null;
						currentModuleKind: string | null;
						projectEmpty: boolean;
					};
				};
				expect(after.workspace.currentModule).toBe("hello-world");
				expect(after.workspace.currentModuleKind).toBe("plain-java");
				expect(after.workspace.projectEmpty).toBe(false);
			},
			{ dockerRunner: docker.runner },
		);
	});
});
