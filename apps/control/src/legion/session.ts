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

export type LegionSession = {
	user: {
		id: string;
		email: string;
		name: string;
		image: string | null;
		role: string;
		slug: string;
		/** Raw Legion group slugs (always [] on a via:link session) — lesson/track
		 * assignment (admin-routes.ts) targets these directly, since role only
		 * distinguishes admin/student. */
		groups: string[];
	};
	session: { token: string };
	/** True on a weak, magic-link-issued session — admin gates should offer a
	 * step-up to Legion's /sso/stepup rather than a flat 403. */
	viaLink: boolean;
};

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

	const claims = result.claims;
	const viaLink = claims.via === "link";
	const role =
		!viaLink && claims.groups.includes(SCRIPTUM_ADMIN_GROUP)
			? "admin"
			: "student";
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
		await storage.ensureWorkspaceForUser(claims.member_code, slug);
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
			groups: viaLink ? [] : claims.groups,
		},
		session: { token },
		viaLink,
	};
}
