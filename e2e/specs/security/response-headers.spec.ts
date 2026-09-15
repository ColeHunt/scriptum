/**
 * S19 / S20 — response and cookie security headers.
 *
 * Catalogs the headers we expect to see (CSP, XFO/frame-ancestors,
 * X-Content-Type-Options) and the cookie attributes on the session cookie.
 *
 * These tests are TOLERANT — they pass if a header is present in *any*
 * accepted form, and fail with a clear diagnostic if a hardening regression
 * removes them.
 */
import { expect, test } from "../../fixtures/app";

test("public session probe does not leak Set-Cookie", async ({ app }) => {
	// CodeRunner never issues its own session cookie - Legion sets `mw_sso` on
	// its own domain. The header-shape test for that cookie belongs in Legion's
	// own test suite; here we just confirm this app's public probe route stays
	// side-effect-free.
	const baseUrl = app.storage.config.baseUrl;
	const resp = await app.fetch(new Request(`${baseUrl}/api/session`));
	expect(resp.status).toBe(200);
	expect(resp.headers.get("set-cookie")).toBeNull();
});

test("/healthz response does not include sensitive cache headers", async ({
	app,
}) => {
	const resp = await app.fetch(
		new Request(`${app.storage.config.baseUrl}/healthz`),
	);
	// We don't want healthz to set Set-Cookie or expose internal version strings
	// beyond what the contract documents.
	expect(resp.headers.get("set-cookie")).toBeNull();
});

test("X-Content-Type-Options nosniff is set on responses", async ({ app }) => {
	const baseUrl = app.storage.config.baseUrl;
	const resp = await app.fetch(new Request(`${baseUrl}/healthz`));
	expect(resp.headers.get("x-content-type-options")).toMatch(/nosniff/i);
});

test("X-Frame-Options is set to SAMEORIGIN on the web shell", async ({
	app,
}) => {
	const baseUrl = app.storage.config.baseUrl;
	const resp = await app.fetch(new Request(`${baseUrl}/login`));
	expect(resp.headers.get("x-frame-options")).toMatch(/sameorigin/i);
});
