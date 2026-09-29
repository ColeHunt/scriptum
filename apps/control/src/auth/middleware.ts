/**
 * Auth middleware helpers — default-deny session gating.
 *
 * These replace the old per-route `authFromRequest` + `resolveWorkspaceRequest`
 * with centralized helpers backed by Legion's `mw_sso` cookie (see `../legion/`).
 */

import type { WorkspaceSlug } from "@frc-scriptum/contracts";
import {
	getLegionSessionFromRequest,
	legionAccessProblem,
	SCRIPTUM_USER_GROUP,
} from "../legion/session";
import { getLogger } from "../logging";
import type { AppStorage, AuthContext } from "../storage";
import { getDemoSession } from "./demo";

const log = getLogger("auth");

export type ResolvedSession = {
	user: {
		id: string;
		email: string;
		name: string;
		image: string | null;
		role: string;
		slug: string;
		groups: string[];
	};
	session: { token: string };
};

/** Resolve the current session from the incoming request (demo mode, or Legion's
 * `mw_sso` cookie). Returns null if no valid session. */
export async function getSessionFromRequest(
	storage: AppStorage,
	request: Request,
): Promise<ResolvedSession | null> {
	if (storage.config.demo) {
		return getDemoSession();
	}
	try {
		const session = await getLegionSessionFromRequest(
			storage,
			storage.config,
			request,
		);
		if (!session) {
			log.trace("getSession: no session");
			return null;
		}
		log.trace("getSession: ok", {
			userId: session.user.id,
			role: session.user.role,
		});
		return session;
	} catch (err) {
		log.warn("getSession threw", {
			err: err instanceof Error ? err : new Error(String(err)),
		});
		return null;
	}
}

/** Require a valid session. Returns the session or a 401 Response. */
export async function requireSession(
	storage: AppStorage,
	request: Request,
): Promise<ResolvedSession | Response> {
	const session = await getSessionFromRequest(storage, request);
	if (!session) {
		return new Response("Unauthorized", { status: 401 });
	}
	return session;
}

/** Require session + workspace ownership. Returns AuthContext or error Response. */
export async function requireWorkspaceOwnership(
	storage: AppStorage,
	request: Request,
	slug: string,
): Promise<AuthContext | Response> {
	const session = await getSessionFromRequest(storage, request);
	if (!session) {
		return new Response("Unauthorized", { status: 401 });
	}

	// Workspaces are invitation-only (an admin isn't automatically a user).
	// Checked on every request, so removing someone from the group in Legion
	// cuts them off at their next one.
	if (
		!storage.config.demo &&
		!session.user.groups.includes(SCRIPTUM_USER_GROUP)
	) {
		log.warn("workspace rejected: not in scriptum-user", {
			userId: session.user.id,
		});
		return new Response("You don't have access to a Scriptum workspace.", {
			status: 403,
		});
	}

	const workspace = storage.findWorkspaceBySlug(slug as WorkspaceSlug);
	if (!workspace || workspace.user_id !== session.user.id) {
		log.warn("workspace ownership rejected", {
			slug,
			userId: session.user.id,
			reason: !workspace ? "not-found" : "mismatch",
		});
		return new Response("Workspace is not available for this session.", {
			status: 403,
		});
	}

	storage.touchWorkspace(workspace.id);

	return {
		user: session.user,
		workspace,
	};
}

/** Require admin role. Returns session or error Response. Honors ADMIN_TOKEN as break-glass. */
export async function requireAdmin(
	storage: AppStorage,
	request: Request,
): Promise<{ user: ResolvedSession["user"] } | Response> {
	// Break-glass: ADMIN_TOKEN header
	const adminToken = storage.config.adminToken;
	if (adminToken) {
		const authHeader = request.headers.get("authorization");
		if (authHeader === `Bearer ${adminToken}`) {
			log.info("admin auth via break-glass token");
			return {
				user: {
					id: "<admin-token>",
					email: "<admin-token>",
					name: "Admin Token",
					image: null,
					role: "admin",
					slug: "",
					groups: [],
				},
			};
		}
	}

	const session = await getSessionFromRequest(storage, request);
	if (session && session.user.role === "admin") {
		log.debug("admin auth via session", { userId: session.user.id });
		return session;
	}

	if (
		!session &&
		storage.config.legionBaseUrl &&
		legionAccessProblem(storage.config, request) === "quick-link"
	) {
		// Scriptum never accepts a Slack quick-link session; send them to a
		// real sign-in instead of a flat 401.
		log.info("admin route: stepping up a quick-link session");
		return legionStepUpRedirect(
			storage.config.legionBaseUrl,
			new URL(request.url).pathname,
		);
	}

	if (!session) {
		log.warn("admin route rejected: unauthorized");
		return new Response("Unauthorized", { status: 401 });
	}

	log.warn("admin route rejected: forbidden", {
		userId: session.user.id,
		role: session.user.role,
	});
	return new Response("Forbidden", { status: 403 });
}

function normalizeHost(host: string): string {
	return host
		.trim()
		.toLowerCase()
		.replace(/^\[(.*)\]$/u, "$1");
}

function isLoopbackHost(host: string): boolean {
	const normalized = normalizeHost(host);
	return (
		normalized === "localhost" ||
		normalized === "127.0.0.1" ||
		normalized === "::1"
	);
}

export function isAllowedWebSocketOrigin(
	request: Request,
	baseUrl: string,
): boolean {
	const origin = request.headers.get("origin");
	if (!origin) {
		// Non-browser clients often omit Origin. Browser WebSocket requests include it,
		// so cross-site hijacking is still blocked by the checks below.
		return true;
	}

	try {
		const originUrl = new URL(origin);
		const expectedUrl = new URL(baseUrl);
		if (normalizeHost(originUrl.host) === normalizeHost(expectedUrl.host)) {
			return true;
		}

		// Local development commonly mixes localhost and 127.0.0.1 while keeping
		// the same control plane; allow those loopback aliases only in loopback dev.
		return (
			isLoopbackHost(originUrl.hostname) && isLoopbackHost(expectedUrl.hostname)
		);
	} catch {
		return false;
	}
}

export function requireWebSocketOrigin(
	request: Request,
	baseUrl: string,
): Response | null {
	if (isAllowedWebSocketOrigin(request, baseUrl)) {
		return null;
	}
	log.warn("ws origin rejected", {
		origin: request.headers.get("origin"),
		baseUrl,
	});
	return new Response("WebSocket origin is not allowed.", { status: 403 });
}

/** Legion's full sign-in (Approve/Deny push), for a quick-link session. A
 * plain /sso/authorize would hand back another quick link and loop. */
export function legionStepUpRedirect(
	legionBaseUrl: string,
	returnTo: string,
): Response {
	return new Response(null, {
		status: 303,
		headers: {
			location: `${legionBaseUrl}/sso/stepup?app=scriptum&return_to=${encodeURIComponent(returnTo)}`,
		},
	});
}

/** Shown to someone signed in to Legion but not invited to Scriptum. */
export function noAccessResponse(): Response {
	return new Response(
		`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Scriptum</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1115;color:#e6e8eb}main{max-width:32rem;padding:2rem}h1{font-size:1.4rem;margin:0 0 .75rem}p{color:#aab0b8}a{color:#8ab4ff}</style></head>
<body><main><h1>You don't have access to Scriptum yet</h1>
<p>Scriptum workspaces are set up by invitation. Ask a mentor to add you to the <strong>scriptum-user</strong> group in Legion, then come back to this page.</p>
<p><a href="/logout">Sign out</a></p></main></body></html>`,
		{
			status: 403,
			headers: { "content-type": "text/html; charset=utf-8" },
		},
	);
}
