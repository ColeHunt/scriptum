import { describe, expect, test } from "bun:test";
import { withApp } from "../__tests__/helpers";
import { signLegionToken } from "./sso";

describe("magic-link (via:link) sessions", () => {
	test("a via:link session can reach the student portal", async () => {
		await withApp(async (app) => {
			const secret = app.storage.config.ssoSecret;
			if (!secret) throw new Error("test app has no ssoSecret");
			const token = signLegionToken(
				{
					member_code: "deadbeef",
					username: "alice",
					name: "Alice",
					role: "student",
					team_number: null,
					// A magic link never carries groups, even for an otherwise-admin member.
					groups: [],
					slack_user_id: null,
					via: "link",
				},
				secret,
			);
			const cookie = `mw_sso=${token}`;

			const response = await app.fetch(
				new Request("http://localhost/", { headers: { cookie } }),
			);
			expect(response.status).toBe(303);
			expect(response.headers.get("location")).toBe("/u/alice/");
		});
	});

	test("a via:link session hitting an admin route is stepped up to Legion, not 403'd", async () => {
		await withApp(
			async (app) => {
				const secret = app.storage.config.ssoSecret;
				if (!secret) throw new Error("test app has no ssoSecret");
				// Groups carries coderunner-admin, but via:"link" must still win -
				// a leaked magic link can never reach /admin, per every sibling app's
				// convention.
				const token = signLegionToken(
					{
						member_code: "deadbeef",
						username: "coach",
						name: "Coach",
						role: "mentor",
						team_number: null,
						groups: ["coderunner-admin"],
						slack_user_id: null,
						via: "link",
					},
					secret,
				);
				const cookie = `mw_sso=${token}`;

				const response = await app.fetch(
					new Request("http://localhost/admin/status", {
						headers: { cookie },
						redirect: "manual",
					}),
				);
				expect(response.status).toBe(303);
				const location = response.headers.get("location") ?? "";
				expect(location).toContain("https://legion.example.test/sso/stepup");
				expect(location).toContain("app=coderunner");
			},
			{ legionBaseUrl: "https://legion.example.test" },
		);
	});

	test("without a configured legionBaseUrl, a via:link admin attempt is a flat 403", async () => {
		await withApp(async (app) => {
			const secret = app.storage.config.ssoSecret;
			if (!secret) throw new Error("test app has no ssoSecret");
			const token = signLegionToken(
				{
					member_code: "deadbeef",
					username: "coach",
					name: "Coach",
					role: "mentor",
					team_number: null,
					groups: ["coderunner-admin"],
					slack_user_id: null,
					via: "link",
				},
				secret,
			);
			const cookie = `mw_sso=${token}`;

			const response = await app.fetch(
				new Request("http://localhost/admin/status", { headers: { cookie } }),
			);
			expect(response.status).toBe(403);
		});
	});
});
