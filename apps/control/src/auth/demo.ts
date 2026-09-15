/**
 * Demo mode helpers — single seeded admin user + synthetic session.
 *
 * Used by `bun run start -- --demo` (or FABRICA_DEMO_MODE=1) to let
 * someone evaluate CodeRunner without configuring Legion.
 *
 * Not safe to expose publicly: every request resolves to the same user,
 * so there is no privacy boundary between concurrent visitors.
 */

import type { AppStorage } from "../storage";

export const DEMO_USER_ID = "demo_admin_local_user";
export const DEMO_SLUG = "demo";
export const DEMO_EMAIL = "demo@local";
export const DEMO_NAME = "Demo";

/** Synthetic session payload returned by getSessionFromRequest in demo mode. */
export function getDemoSession() {
	return {
		user: {
			id: DEMO_USER_ID,
			email: DEMO_EMAIL,
			name: DEMO_NAME,
			image: null as string | null,
			role: "admin",
			slug: DEMO_SLUG,
			groups: [] as string[],
		},
		session: { token: "demo-synthetic-session" },
	};
}

/**
 * Idempotently insert the demo user row and ensure its workspace exists.
 * Safe to call on every boot.
 */
export async function seedDemoUser(storage: AppStorage): Promise<void> {
	storage.upsertLegionUser({
		id: DEMO_USER_ID,
		email: DEMO_EMAIL,
		name: DEMO_NAME,
		role: "admin",
	});
	await storage.ensureWorkspaceForUser(DEMO_USER_ID, DEMO_SLUG);
}
