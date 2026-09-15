import { describe, expect, test } from "bun:test";
import { signLegionToken, verifyLegionToken } from "./sso";

// Minted once with the real Python `itsdangerous` package (the one Legion itself
// uses, v2.2.0) against a throwaway test secret — never used anywhere else:
//
//   from itsdangerous import URLSafeTimedSerializer
//   signer = URLSafeTimedSerializer(SECRET, salt="mw-sso")
//   signer.dumps({...CLAIMS})
//
// This is the single highest-value test in the Legion integration: if our TS port
// of itsdangerous's signing scheme is subtly wrong, this is what catches it —
// everything else in this file only proves our own sign() and verify() agree with
// each other, which a shared bug could pass trivially.
const SECRET = "test-legion-sso-secret-do-not-use-in-prod";
const CLAIMS = {
	member_code: "a1b2c3d4",
	username: "jane.doe",
	name: "Jane Doe",
	role: "student" as const,
	team_number: 4143,
	groups: ["coderunner-admin"], // literally what's encoded in PYTHON_TOKEN below - not renamed with the rest of the app, see the comment above
	slack_user_id: "U01ABC123",
};
// Real itsdangerous compressed this payload (it starts with "."), so this fixture
// also exercises the zlib-inflate decode path, not just the plain one.
const PYTHON_TOKEN =
	".eJwtzbsOAiEQQNFfMVOjkYVqOx_V9lbGkFmYmNVlMANUxn8XjO0p7n1DpDiTOJ8CwQio58GbYEFBzSSMsesDmXYhUdO_TE02559IWrvkUgNxaVAIo-PaszBabY2Cu6T6yjBeoX-kMpNsMcSF4aYgr-ifrv_cElrqsteH40kPBj5fVsIzzQ.aqjWfg.vMifbdcwnT-E_OFayq9pYc8SeAY";

// The fixture token was minted at real wall-clock signing time, not a fixed
// timestamp, so age-sensitive assertions below pass a wide max_age and let
// verifyLegionToken default to the real current time rather than pinning a
// "now" that would drift out of range as this file ages.
const WIDE_MAX_AGE = 10 * 365 * 24 * 60 * 60; // 10 years

describe("verifyLegionToken", () => {
	test("accepts a real Python itsdangerous token and decodes its compressed payload", () => {
		const result = verifyLegionToken(PYTHON_TOKEN, SECRET, WIDE_MAX_AGE);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.claims).toEqual(CLAIMS);
		}
	});

	test("rejects the same token under the wrong secret", () => {
		const result = verifyLegionToken(
			PYTHON_TOKEN,
			"wrong-secret",
			WIDE_MAX_AGE,
		);
		expect(result).toEqual({ ok: false, reason: "bad-signature" });
	});

	test("rejects a tampered payload", () => {
		const tampered = `X${PYTHON_TOKEN.slice(1)}`;
		const result = verifyLegionToken(tampered, SECRET, WIDE_MAX_AGE);
		expect(result.ok).toBe(false);
	});

	test("rejects a token older than max_age", () => {
		// The Python token above was signed at some real past wall-clock time; at
		// max_age=0 relative to "now" it is always expired.
		const result = verifyLegionToken(PYTHON_TOKEN, SECRET, 0);
		expect(result).toEqual({ ok: false, reason: "expired" });
	});

	test("rejects malformed tokens", () => {
		expect(verifyLegionToken("not-a-token", SECRET, 3600)).toEqual({
			ok: false,
			reason: "malformed",
		});
		expect(verifyLegionToken("only.two", SECRET, 3600)).toEqual({
			ok: false,
			reason: "malformed",
		});
	});
});

describe("signLegionToken / verifyLegionToken round trip", () => {
	test("our own signer produces a token our own verifier accepts", () => {
		const now = 1_900_000_000;
		const token = signLegionToken(CLAIMS, SECRET, now);
		const result = verifyLegionToken(token, SECRET, 3600, now + 100);
		expect(result).toEqual({ ok: true, claims: CLAIMS });
	});

	test("a via:link session round-trips with empty groups", () => {
		const now = 1_900_000_000;
		const linkClaims = { ...CLAIMS, groups: [], via: "link" as const };
		const token = signLegionToken(linkClaims, SECRET, now);
		const result = verifyLegionToken(token, SECRET, 3600, now + 100);
		expect(result).toEqual({ ok: true, claims: linkClaims });
	});

	test("expires strictly after max_age seconds", () => {
		const now = 1_900_000_000;
		const token = signLegionToken(CLAIMS, SECRET, now);
		expect(verifyLegionToken(token, SECRET, 100, now + 100).ok).toBe(true);
		expect(verifyLegionToken(token, SECRET, 100, now + 101)).toEqual({
			ok: false,
			reason: "expired",
		});
	});

	test("rejects a token from the future (negative age)", () => {
		const now = 1_900_000_000;
		const token = signLegionToken(CLAIMS, SECRET, now);
		expect(verifyLegionToken(token, SECRET, 3600, now - 1)).toEqual({
			ok: false,
			reason: "expired",
		});
	});
});
