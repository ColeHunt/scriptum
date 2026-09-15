/**
 * Property tests for `slugFromUsername` and the storage workspace-slug collision suffix.
 *
 * P4 — output always matches /^[a-z0-9][a-z0-9_-]{0,39}$/ (or is the "student" fallback).
 * P5 — output is never empty.
 * P6 — for any set of N usernames sharing a slug prefix, all generated workspace slugs are
 *      unique and ≤40 chars. (Drives the slug-collision suffix path in storage.)
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import type { ControlApp } from "../../app";
import { slugFromUsername } from "../../legion/session";
import { withApp } from "../helpers";

const NUM_RUNS = Number(process.env.FAST_CHECK_NUM_RUNS ?? 100);

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

const usernameArb: fc.Arbitrary<string> = fc.stringMatching(
	/^[A-Za-z0-9._+-]{1,30}$/u,
);

describe("slugFromUsername — properties", () => {
	test("P4 output is either valid-slug or the literal 'student' fallback", () => {
		fc.assert(
			fc.property(fc.string(), (raw) => {
				const slug = slugFromUsername(raw);
				expect(SLUG_RE.test(slug) || slug === "student").toBe(true);
			}),
			{ numRuns: NUM_RUNS },
		);
	});

	test("P5 output is never empty", () => {
		fc.assert(
			fc.property(fc.string(), (raw) => {
				const slug = slugFromUsername(raw);
				expect(slug.length).toBeGreaterThan(0);
			}),
			{ numRuns: NUM_RUNS },
		);
	});

	test("normalizes diacritics and unicode", () => {
		expect(slugFromUsername("Élise")).toBe("elise");
		expect(slugFromUsername("José")).toBe("jose");
	});

	test("strips leading/trailing dashes and collapses repeats", () => {
		expect(slugFromUsername("--alice--")).toBe("alice");
		expect(slugFromUsername("a..b..c")).toBe("a-b-c");
	});

	test("falls back to 'student' for all-non-alphanumeric input", () => {
		expect(slugFromUsername("...")).toBe("student");
		expect(slugFromUsername("___")).toBe("student");
	});

	test("output is ≤40 chars even for long usernames", () => {
		fc.assert(
			fc.property(usernameArb, (username) => {
				expect(slugFromUsername(username).length).toBeLessThanOrEqual(40);
			}),
			{ numRuns: NUM_RUNS },
		);
	});
});

describe("workspace slug collision suffix — property", () => {
	test("P6 N users with colliding slug get N unique workspace slugs", async () => {
		await withApp(async (app: ControlApp) => {
			const slugs: string[] = [];
			for (let i = 0; i < 5; i += 1) {
				const userId = `user_${i.toString().padStart(20, "0")}`;
				app.storage.upsertLegionUser({
					id: userId,
					name: "Alice",
					email: `alice${i}@example.com`,
					role: "student",
				});
				const ws = await app.storage.ensureWorkspaceForUser(userId, "alice");
				slugs.push(ws.slug);
			}
			// All slugs unique
			expect(new Set(slugs).size).toBe(slugs.length);
			// First should be "alice"; later ones a unique numeric suffix
			expect(slugs[0]).toBe("alice");
			for (const slug of slugs) {
				expect(slug.length).toBeLessThanOrEqual(40);
				expect(SLUG_RE.test(slug)).toBe(true);
			}
		});
	});
});
