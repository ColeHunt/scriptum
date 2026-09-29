/**
 * Legion session resolution — turns a verified `mw_sso` cookie into the same
 * session shape `apps/control/src/auth/middleware.ts` has always returned, so
 * `requireSession`/`requireWorkspaceOwnership`/`requireAdmin` need no changes.
 *
 * Design (see docs/decisions/047-legion-auth-integration.md):
 *  - `role` is recomputed fresh on every request from the cookie's `groups`
 *    claim, not stored — there is no local session table, so there's nothing to
 *    go stale.
 *  - The wire field `email` is populated with Legion's `username` (Legion never
 *    exposes an email). Kept as `email` to avoid renaming it across ~15 call
 *    sites; UI copy is relabeled separately.
 *  - `id` is Legion's `member_code`.
 *  - The local `user` row is lazily upserted on first sight of a `member_code`,
 *    matching "checked at request time" rather than a periodic sync job.
 */
import type { ControlConfig } from "../config";
import { getLogger } from "../logging";
import type { AppStorage } from "../storage";
import { verifyLegionToken } from "./sso";

const log = getLogger("legion");

export const MW_SSO_COOKIE = "mw_sso";
export const SCRIPTUM_ADMIN_GROUP = "scriptum-admin";
/** Required for a workspace. Granted by hand in Legion; scriptum-admin doesn't
 * imply it. Each workspace runs on a paid worker droplet (decision 048). */
export const SCRIPTUM_USER_GROUP = "scriptum-user";

export type LegionSession = {
	user: {
		id: string;
		email: string;
		name: string;
		image: string | null;
		role: string;
		slug: string;
		/** Raw Legion group slugs — lesson/track assignment (admin-routes.ts)
		 * targets these directly, since role only distinguishes admin/student. */
		groups: string[];
	};
	session: { token: string };
};

/**
 * Why a valid Legion cookie still doesn't get a Scriptum session:
 * - "quick-link": a Slack magic-link session. Never accepted - an IDE with a
 *   paid workspace behind it wants a real sign-in - so the caller sends the
 *   member to Legion's /sso/stepup (a plain /sso/authorize would just mint
 *   another quick link and loop).
 * - "no-access": signed in properly, but in neither scriptum-user nor
 *   scriptum-admin.
 */
export type LegionAccessProblem = "quick-link" | "no-access";

function readCookie(request: Request, name: string): string | null {
	const header = request.headers.get("cookie");
	if (!header) return null;
	for (const part of header.split(";")) {
		const eq = part.indexOf("=");
		if (eq < 0) continue;
		const key = part.slice(0, eq).trim();
		if (key === name) {
			return decodeURIComponent(part.slice(eq + 1).trim());
		}
	}
	return null;
}

export function slugFromUsername(username: string): string {
	return (
		username
			.toLowerCase()
			.normalize("NFKD")
			.replace(/[̀-ͯ]/gu, "")
			.replace(/[^a-z0-9_-]+/gu, "-")
			.replace(/-+/gu, "-")
			.replace(/^[-_]+|[-_]+$/gu, "")
			.slice(0, 40) || "student"
	);
}

function readLegionClaims(config: ControlConfig, request: Request) {
	const token = readCookie(request, MW_SSO_COOKIE);
	if (!token) return null;
	if (!config.ssoSecret) {
		log.error("SSO_SECRET is not configured; cannot verify Legion sessions");
		return null;
	}
	const result = verifyLegionToken(
		token,
		config.ssoSecret,
		config.ssoSessionTtlSeconds,
	);
	if (!result.ok) {
		log.trace("mw_sso rejected", { reason: result.reason });
		return null;
	}
	return { token, claims: result.claims };
}

/** Why the request's valid Legion cookie gets no session, or null when it
 * does (or there's no valid cookie at all - that's plain "not signed in"). */
export function legionAccessProblem(
	config: ControlConfig,
	request: Request,
): LegionAccessProblem | null {
	const read = readLegionClaims(config, request);
	if (!read) return null;
	if (read.claims.via === "link") return "quick-link";
	const groups = read.claims.groups;
	if (
		!groups.includes(SCRIPTUM_USER_GROUP) &&
		!groups.includes(SCRIPTUM_ADMIN_GROUP)
	) {
		return "no-access";
	}
	return null;
}

/**
 * Resolve the `mw_sso` cookie on `request` into a session, lazily upserting the
 * local `user`/workspace rows on first sight of a `member_code`. Returns null
 * if the cookie is absent, invalid, or expired — the caller (getSessionFromRequest)
 * treats that identically to "not signed in".
 */
export async function getLegionSessionFromRequest(
	storage: AppStorage,
	config: ControlConfig,
	request: Request,
): Promise<LegionSession | null> {
	const read = readLegionClaims(config, request);
	if (!read || legionAccessProblem(config, request) !== null) return null;
	const { token, claims } = read;
	const role = claims.groups.includes(SCRIPTUM_ADMIN_GROUP)
		? "admin"
		: "student";
	const hasWorkspace = claims.groups.includes(SCRIPTUM_USER_GROUP);
	const slug = slugFromUsername(claims.username);

	// Upsert the `user` row first so ensureWorkspaceForUser's own
	// `UPDATE user SET slug = ... WHERE id = ?` (on first login) has a row to hit.
	storage.upsertLegionUser({
		id: claims.member_code,
		email: claims.username,
		name: claims.name,
		role,
	});
	try {
		// An admin without scriptum-user gets the admin portal, not a workspace.
		if (hasWorkspace) {
			await storage.ensureWorkspaceForUser(claims.member_code, slug);
		}
	} catch (err) {
		log.warn("ensureWorkspaceForUser failed for Legion session", {
			memberCode: claims.member_code,
			err: err instanceof Error ? err : new Error(String(err)),
		});
		return null;
	}

	return {
		user: {
			id: claims.member_code,
			email: claims.username,
			name: claims.name,
			image: null,
			role,
			slug,
			groups: claims.groups,
		},
		session: { token },
	};
}
