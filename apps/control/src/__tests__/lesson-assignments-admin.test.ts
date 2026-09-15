import { describe, expect, test } from "bun:test";
import type { AuditLogEntry } from "../audit";
import type { LessonAssignmentRow } from "../storage";
import { cookieFrom, login, withApp } from "./helpers";

describe("admin lesson assignment CRUD", () => {
	test("list starts empty, add persists, duplicate add is rejected, remove works", async () => {
		await withApp(async (app) => {
			const admin = await login(app, "coach", { role: "admin" });
			const adminCookie = cookieFrom(admin);

			const empty = await app.fetch(
				new Request("http://localhost/admin/lessons/assignments", {
					headers: { cookie: adminCookie },
				}),
			);
			expect(empty.status).toBe(200);
			const emptyBody = (await empty.json()) as {
				ok: boolean;
				assignments: LessonAssignmentRow[];
			};
			expect(emptyBody.assignments).toEqual([]);

			const add = await app.fetch(
				new Request("http://localhost/admin/lessons/assignments", {
					method: "POST",
					headers: { cookie: adminCookie, "content-type": "application/json" },
					body: JSON.stringify({
						targetType: "module",
						targetId: "robot-starter",
						assigneeType: "group",
						assigneeId: "team-4143",
					}),
				}),
			);
			expect(add.status).toBe(200);
			const addBody = (await add.json()) as {
				ok: boolean;
				assignment: LessonAssignmentRow;
			};
			expect(addBody.assignment).toMatchObject({
				target_type: "module",
				target_id: "robot-starter",
				assignee_type: "group",
				assignee_id: "team-4143",
			});

			// Duplicate (same target + assignee) is rejected.
			const dup = await app.fetch(
				new Request("http://localhost/admin/lessons/assignments", {
					method: "POST",
					headers: { cookie: adminCookie, "content-type": "application/json" },
					body: JSON.stringify({
						targetType: "module",
						targetId: "robot-starter",
						assigneeType: "group",
						assigneeId: "team-4143",
					}),
				}),
			);
			expect(dup.status).toBe(409);

			const list = await app.fetch(
				new Request("http://localhost/admin/lessons/assignments", {
					headers: { cookie: adminCookie },
				}),
			);
			const listBody = (await list.json()) as {
				assignments: LessonAssignmentRow[];
			};
			expect(listBody.assignments.length).toBe(1);

			const auditRows = app.storage.db
				.query("SELECT * FROM audit_log WHERE action = 'lesson-assignment.add'")
				.all() as AuditLogEntry[];
			expect(auditRows.length).toBe(1);

			const remove = await app.fetch(
				new Request(
					`http://localhost/admin/lessons/assignments/${addBody.assignment.id}`,
					{ method: "DELETE", headers: { cookie: adminCookie } },
				),
			);
			expect(remove.status).toBe(200);

			const afterRemove = await app.fetch(
				new Request("http://localhost/admin/lessons/assignments", {
					headers: { cookie: adminCookie },
				}),
			);
			const afterRemoveBody = (await afterRemove.json()) as {
				assignments: LessonAssignmentRow[];
			};
			expect(afterRemoveBody.assignments).toEqual([]);

			const removeAuditRows = app.storage.db
				.query(
					"SELECT * FROM audit_log WHERE action = 'lesson-assignment.remove'",
				)
				.all() as AuditLogEntry[];
			expect(removeAuditRows.length).toBe(1);
		});
	});

	test("removing an unknown assignment id is a 404", async () => {
		await withApp(async (app) => {
			const admin = await login(app, "coach", { role: "admin" });
			const adminCookie = cookieFrom(admin);
			const response = await app.fetch(
				new Request("http://localhost/admin/lessons/assignments/999", {
					method: "DELETE",
					headers: { cookie: adminCookie },
				}),
			);
			expect(response.status).toBe(404);
		});
	});

	test("student cannot reach lesson-assignment admin routes", async () => {
		await withApp(async (app) => {
			const student = await login(app, "alice");
			const studentCookie = cookieFrom(student);
			const response = await app.fetch(
				new Request("http://localhost/admin/lessons/assignments", {
					headers: { cookie: studentCookie },
				}),
			);
			expect(response.status).toBe(403);
		});
	});

	test("GET /admin/lessons/catalog wraps the manifest", async () => {
		await withApp(async (app) => {
			const admin = await login(app, "coach", { role: "admin" });
			const adminCookie = cookieFrom(admin);
			const response = await app.fetch(
				new Request("http://localhost/admin/lessons/catalog", {
					headers: { cookie: adminCookie },
				}),
			);
			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				ok: boolean;
				modules: Array<{ id: string }>;
			};
			const ids = body.modules.map((m) => m.id).sort();
			expect(ids).toContain("hello-world");
			expect(ids).toContain("robot-starter");
		});
	});
});

describe("GET /api/lessons respects assignments", () => {
	test("unassigned modules stay visible to everyone", async () => {
		await withApp(async (app) => {
			const student = await login(app, "alice");
			const cookie = cookieFrom(student);
			const response = await app.fetch(
				new Request("http://localhost/u/alice/api/lessons", {
					headers: { cookie },
				}),
			);
			const body = (await response.json()) as {
				modules: Array<{ id: string }>;
			};
			expect(body.modules.map((m) => m.id)).toContain("hello-world");
		});
	});

	test("a module assigned to one group is hidden from a student outside it, visible to a member", async () => {
		await withApp(async (app) => {
			const admin = await login(app, "coach", { role: "admin" });
			const adminCookie = cookieFrom(admin);
			await app.fetch(
				new Request("http://localhost/admin/lessons/assignments", {
					method: "POST",
					headers: { cookie: adminCookie, "content-type": "application/json" },
					body: JSON.stringify({
						targetType: "module",
						targetId: "robot-starter",
						assigneeType: "group",
						assigneeId: "team-4143",
					}),
				}),
			);

			const member = await login(app, "bob", { groups: ["team-4143"] });
			const memberResponse = await app.fetch(
				new Request("http://localhost/u/bob/api/lessons", {
					headers: { cookie: cookieFrom(member) },
				}),
			);
			const memberBody = (await memberResponse.json()) as {
				modules: Array<{ id: string }>;
			};
			expect(memberBody.modules.map((m) => m.id)).toContain("robot-starter");

			const outsider = await login(app, "carol");
			const outsiderResponse = await app.fetch(
				new Request("http://localhost/u/carol/api/lessons", {
					headers: { cookie: cookieFrom(outsider) },
				}),
			);
			const outsiderBody = (await outsiderResponse.json()) as {
				modules: Array<{ id: string }>;
			};
			expect(outsiderBody.modules.map((m) => m.id)).not.toContain(
				"robot-starter",
			);
			// hello-world has no assignment of its own, so it stays visible.
			expect(outsiderBody.modules.map((m) => m.id)).toContain("hello-world");
		});
	});
});
