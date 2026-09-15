/**
 * Auth seeding helpers for E2E specs.
 *
 * `loginAs` is the FAST shortcut: it signs a real `mw_sso` cookie (the shared
 * itsdangerous-signed token Legion mints — see apps/control/src/legion/sso.ts)
 * and plants it directly in the page's browser context, rather than driving
 * Legion's real Slack-approval or magic-link flow. Tests that want to validate
 * the session-resolution path itself should exercise `legion/session.ts`
 * directly (see apps/control/src/legion/session.test.ts).
 *
 * The signing logic mirrors apps/control/src/legion/sso.ts's `signLegionToken`
 * and apps/control/src/__tests__/helpers.ts's `login()`.
 */
import type { Page } from "@playwright/test";
import type { ControlApp } from "../../apps/control/src/app";
import type { LegionSsoClaims } from "../../apps/control/src/legion/sso";
import { signLegionToken } from "../../apps/control/src/legion/sso";

const MW_SSO_COOKIE = "mw_sso";

function randomMemberCode(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(4));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type LoginOpts = {
	name: string;
	email?: string;
	role?: "student" | "admin";
};

export type LoginResult = {
	user: {
		id: string;
		email: string;
		name: string;
		slug: string;
		role: "student" | "admin";
	};
	cookieValue: string;
	cookieName: typeof MW_SSO_COOKIE;
};

export async function loginAs(
	page: Page,
	app: ControlApp,
	opts: LoginOpts,
): Promise<LoginResult> {
	const secret = app.storage.config.ssoSecret;
	if (!secret) {
		throw new Error(
			"Test ControlApp has no ssoSecret configured for loginAs().",
		);
	}
	const role = opts.role ?? "student";
	// Bare, no "@domain" - a real Legion username never contains one, and
	// slugFromUsername has no email-style "strip everything after @" step, so
	// a domain suffix here would leak into the derived workspace slug.
	const username = (opts.email ?? opts.name.toLowerCase()).toLowerCase();

	// Reuse the same member_code across repeated logins for the same identity,
	// matching how a returning student keeps the same workspace.
	const existing = app.storage.db
		.query("SELECT id FROM user WHERE email = ?")
		.get(username) as { id: string } | null;
	const memberCode = existing?.id ?? randomMemberCode();

	const claims: LegionSsoClaims = {
		member_code: memberCode,
		username,
		name: opts.name,
		role: "student",
		team_number: null,
		groups: role === "admin" ? ["fabrica-admin"] : [],
		slack_user_id: null,
	};
	const token = signLegionToken(claims, secret);

	// Resolve once server-side so the user/workspace rows exist (and this
	// helper's returned slug is accurate) before the browser's first request.
	const probeRequest = new Request(`${app.storage.config.baseUrl}/`, {
		headers: { cookie: `${MW_SSO_COOKIE}=${encodeURIComponent(token)}` },
	});
	const { getSessionFromRequest } = await import(
		"../../apps/control/src/auth/middleware"
	);
	const session = await getSessionFromRequest(app.storage, probeRequest);
	if (!session) {
		throw new Error(
			"loginAs(): failed to resolve the freshly-signed test session.",
		);
	}

	const url = new URL(app.storage.config.baseUrl);
	await page.context().addCookies([
		{
			name: MW_SSO_COOKIE,
			value: token,
			domain: url.hostname,
			path: "/",
			httpOnly: true,
			secure: url.protocol === "https:",
			sameSite: "Lax",
		},
	]);

	return {
		user: {
			id: memberCode,
			email: username,
			name: opts.name,
			slug: session.user.slug,
			role,
		},
		cookieValue: token,
		cookieName: MW_SSO_COOKIE,
	};
}

export function cookieHeader(result: LoginResult): string {
	return `${result.cookieName}=${result.cookieValue}`;
}
