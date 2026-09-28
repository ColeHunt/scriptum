import { describe, expect, test } from "bun:test";
import { withApp } from "../__tests__/helpers";
import type { ControlApp } from "../app";
import { signLegionToken } from "./sso";

const LEGION = "https://legion.example.test";

function cookieFor(
	app: ControlApp,
	options: { groups: string[]; via?: "link"; username?: string },
): string {
	const secret = app.storage.config.ssoSecret;
	if (!secret) throw new Error("test app has no ssoSecret");
	const token = signLegionToken(
		{
			member_code: `mc-${options.username ?? "alice"}`,
			username: options.username ?? "alice",
			name: "Alice",
			role: "student",
			team_number: null,
			groups: options.groups,
			slack_user_id: null,
			...(options.via ? { via: options.via } : {}),
		},
		secret,
	);
	return `mw_sso=${token}`;
}

async function get(app: ControlApp, path: string, cookie: string) {
	return app.fetch(
		new Request(`http://localhost${path}`, {
			headers: { cookie },
			redirect: "manual",
		}),
	);
}

describe("Scriptum access is invitation-only (scriptum-user)", () => {
	test("a member of scriptum-user lands in their workspace", async () => {
		await withApp(async (app) => {
			const response = await get(
				app,
				"/",
				cookieFor(app, { groups: ["scriptum-user"] }),
			);
			expect(response.status).toBe(303);
			expect(response.headers.get("location")).toBe("/u/alice/");
		});
	});

	test("a signed-in member outside the group gets the no-access page and no workspace", async () => {
		await withApp(async (app) => {
			const cookie = cookieFor(app, { groups: ["tempus-admin"] });
			for (const path of ["/", "/login", "/login/legion"]) {
				const response = await get(app, path, cookie);
				expect(response.status).toBe(403);
				expect(await response.text()).toContain("scriptum-user");
			}
			expect(app.storage.findWorkspaceByUserId("mc-alice")).toBeNull();
			const api = await get(app, "/api/session", cookie);
			expect(((await api.json()) as { user: unknown }).user ?? null).toBeNull();
		});
	});

	test("scriptum-admin alone reaches the admin portal but gets no workspace", async () => {
		await withApp(async (app) => {
			const cookie = cookieFor(app, { groups: ["scriptum-admin"] });
			const root = await get(app, "/", cookie);
			expect(root.status).toBe(303);
			expect(root.headers.get("location")).toBe("/admin/");
			expect((await get(app, "/admin/status", cookie)).status).toBe(200);
			expect(app.storage.findWorkspaceByUserId("mc-alice")).toBeNull();
		});
	});

	test("removing someone from scriptum-user cuts off their existing workspace", async () => {
		await withApp(async (app) => {
			const invited = cookieFor(app, { groups: ["scriptum-user"] });
			expect((await get(app, "/", invited)).status).toBe(303);

			// Same member, group since removed in Legion; admin kept.
			const removed = cookieFor(app, { groups: ["scriptum-admin"] });
			const workspace = await get(
				app,
				"/u/alice/api/containers/status",
				removed,
			);
			expect(workspace.status).toBe(403);
		});
	});
});

describe("Slack quick-link sessions are never accepted", () => {
	test("opening Scriptum with a quick link goes to Legion's full sign-in", async () => {
		await withApp(
			async (app) => {
				// Even carrying scriptum-user, a quick link doesn't count.
				const cookie = cookieFor(app, {
					groups: ["scriptum-user"],
					via: "link",
				});
				for (const path of ["/", "/login", "/login/legion"]) {
					const response = await get(app, path, cookie);
					expect(response.status).toBe(303);
					const location = response.headers.get("location") ?? "";
					expect(location).toStartWith(`${LEGION}/sso/stepup`);
					expect(location).toContain("app=scriptum");
				}
				expect(app.storage.findWorkspaceByUserId("mc-alice")).toBeNull();
			},
			{ legionBaseUrl: LEGION },
		);
	});

	test("a quick link can't reach a workspace or the admin API", async () => {
		await withApp(
			async (app) => {
				// First a real sign-in creates the workspace...
				await get(app, "/", cookieFor(app, { groups: ["scriptum-user"] }));
				// ...then the same member arrives with a quick link.
				const link = cookieFor(app, {
					groups: ["scriptum-user", "scriptum-admin"],
					via: "link",
				});
				expect(
					(await get(app, "/u/alice/api/containers/status", link)).status,
				).toBe(401);
				const admin = await get(app, "/admin/status", link);
				expect(admin.status).toBe(303);
				expect(admin.headers.get("location") ?? "").toStartWith(
					`${LEGION}/sso/stepup`,
				);
			},
			{ legionBaseUrl: LEGION },
		);
	});
});
