/**
 * Legion `mw_sso` cookie — sign/verify.
 *
 * A from-scratch TypeScript port of Python's `itsdangerous.URLSafeTimedSerializer`
 * (as used by Legion's `app/services/sso.py`), verified byte-for-byte against the
 * installed itsdangerous 2.2.0 source at /prj/frc/apps/legion/venv. Per Legion's own
 * CLAUDE.md ("nothing is imported across the three projects"), every sibling app
 * hand-writes its own small integration rather than sharing a package — this is
 * CodeRunner's.
 *
 * Wire format: `payload_b64.timestamp_b64.sig_b64`.
 *  - payload_b64: compact JSON, optionally zlib-deflated (RFC1950) with a leading
 *    "." marker when that's smaller, base64url-encoded without padding.
 *  - timestamp_b64: Unix seconds as big-endian bytes with leading zero bytes
 *    stripped, base64url-encoded.
 *  - sig_b64: HMAC-SHA1(derive_key(secret, salt), `${payload_b64}.${timestamp_b64}`),
 *    base64url-encoded. Key derivation is itsdangerous's default "django-concat":
 *    SHA1(salt_bytes + "signer" + secret_bytes).
 *
 * Sign here is only used to mint test/E2E fixture cookies — it never compresses
 * the payload (compression is a pure size optimization on Legion's side; an
 * uncompressed payload is an equally valid itsdangerous token). Verify handles
 * both forms, since a real cookie minted by Legion may be compressed.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { inflateSync } from "node:zlib";

/** Legion's fixed signer salt for the `mw_sso` cookie (services/sso.py). Distinct
 * from the "mw-sso-link" salt used for magic-link URLs, which CodeRunner never
 * sees directly — Legion's own /sso/link redemption turns those into an
 * "mw-sso"-salted cookie before the browser presents anything to us. */
export const LEGION_SSO_SALT = "mw-sso";

const SEP = ".";

export type LegionRole = "student" | "mentor";

export type LegionSsoClaims = {
	member_code: string;
	username: string;
	name: string;
	role: LegionRole;
	team_number: number | null;
	groups: string[];
	slack_user_id: string | null;
	/** Present and "link" only on a weak, magic-link-issued session (groups always empty). */
	via?: "link";
};

export type LegionVerifyResult =
	| { ok: true; claims: LegionSsoClaims }
	| {
			ok: false;
			reason: "malformed" | "bad-signature" | "bad-payload" | "expired";
	  };

function base64UrlEncode(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64url");
}

function base64UrlDecode(text: string): Buffer {
	return Buffer.from(text, "base64url");
}

/** itsdangerous's default "django-concat" key derivation. */
function deriveKey(secret: string, salt: string): Buffer {
	return createHash("sha1")
		.update(
			Buffer.concat([
				Buffer.from(salt, "utf8"),
				Buffer.from("signer", "utf8"),
				Buffer.from(secret, "utf8"),
			]),
		)
		.digest();
}

function hmacSha1(key: Buffer, value: string): Buffer {
	return createHmac("sha1", key).update(value, "utf8").digest();
}

/** Mirrors itsdangerous.encoding.int_to_bytes: big-endian uint64, leading zero
 * bytes stripped. A real Unix timestamp always fits well within 64 bits. */
function intToBytes(num: number): Buffer {
	const buf = Buffer.alloc(8);
	buf.writeBigUInt64BE(BigInt(num));
	let start = 0;
	while (start < buf.length - 1 && buf[start] === 0) start += 1;
	return buf.subarray(start);
}

/** Mirrors itsdangerous.encoding.bytes_to_int: right-pad to 8 bytes, read big-endian uint64. */
function bytesToInt(bytes: Buffer): number {
	const padded = Buffer.concat([
		Buffer.alloc(Math.max(0, 8 - bytes.length)),
		bytes,
	]);
	return Number(padded.readBigUInt64BE());
}

/** Splits on the LAST occurrence of `sep`, like Python's `str.rsplit(sep, 1)`. */
function rsplitOnce(value: string, sep: string): [string, string] | null {
	const idx = value.lastIndexOf(sep);
	if (idx < 0) return null;
	return [value.slice(0, idx), value.slice(idx + 1)];
}

function dumpPayload(claims: LegionSsoClaims): string {
	const jsonBytes = Buffer.from(JSON.stringify(claims), "utf8");
	return base64UrlEncode(jsonBytes);
}

function loadPayload(payloadB64: string): unknown {
	let text = payloadB64;
	let compressed = false;
	if (text.startsWith(".")) {
		text = text.slice(1);
		compressed = true;
	}
	let jsonBytes = base64UrlDecode(text);
	if (compressed) {
		jsonBytes = inflateSync(jsonBytes);
	}
	return JSON.parse(jsonBytes.toString("utf8"));
}

/** Sign a claims object into an `mw_sso`-shaped token. Test/E2E fixture use only —
 * production CodeRunner never mints this cookie; Legion does. */
export function signLegionToken(
	claims: LegionSsoClaims,
	secret: string,
	nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
	const payloadB64 = dumpPayload(claims);
	const timestampB64 = base64UrlEncode(intToBytes(nowSeconds));
	const valueToSign = `${payloadB64}${SEP}${timestampB64}`;
	const sigB64 = base64UrlEncode(
		hmacSha1(deriveKey(secret, LEGION_SSO_SALT), valueToSign),
	);
	return `${valueToSign}${SEP}${sigB64}`;
}

/** Verify an `mw_sso` token: signature, age (`maxAgeSeconds`, matching
 * SSO_SESSION_TTL), and payload shape. Never throws. */
export function verifyLegionToken(
	token: string,
	secret: string,
	maxAgeSeconds: number,
	nowSeconds: number = Math.floor(Date.now() / 1000),
): LegionVerifyResult {
	const firstSplit = rsplitOnce(token, SEP);
	if (!firstSplit) return { ok: false, reason: "malformed" };
	const [valueWithTimestamp, sigB64] = firstSplit;
	const secondSplit = rsplitOnce(valueWithTimestamp, SEP);
	if (!secondSplit) return { ok: false, reason: "malformed" };
	const [payloadB64, timestampB64] = secondSplit;

	const expectedSig = hmacSha1(
		deriveKey(secret, LEGION_SSO_SALT),
		valueWithTimestamp,
	);
	const actualSig = base64UrlDecode(sigB64);
	if (
		actualSig.length !== expectedSig.length ||
		!timingSafeEqual(actualSig, expectedSig)
	) {
		return { ok: false, reason: "bad-signature" };
	}

	let timestamp: number;
	try {
		timestamp = bytesToInt(base64UrlDecode(timestampB64));
	} catch {
		return { ok: false, reason: "malformed" };
	}
	const age = nowSeconds - timestamp;
	if (age > maxAgeSeconds || age < 0) {
		return { ok: false, reason: "expired" };
	}

	try {
		const claims = loadPayload(payloadB64) as LegionSsoClaims;
		return { ok: true, claims };
	} catch {
		return { ok: false, reason: "bad-payload" };
	}
}
