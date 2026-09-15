import { describe, expect, test } from "bun:test";
import { loadControlConfig } from "../config";

describe("parseBoolean (via loadControlConfig)", () => {
	test("empty string falls back to the default for demo (false)", () => {
		expect(loadControlConfig({ ssoSecret: "test-secret", demo: "" }).demo).toBe(
			false,
		);
	});

	test("whitespace-only string falls back to the default for demo (false)", () => {
		expect(
			loadControlConfig({ ssoSecret: "test-secret", demo: "  " }).demo,
		).toBe(false);
	});

	test("empty string falls back to the default for containerAutoStart (true)", () => {
		expect(
			loadControlConfig({ ssoSecret: "test-secret", containerAutoStart: "" })
				.containerAutoStart,
		).toBe(true);
	});

	test("whitespace-only string falls back to the default for containerAutoStart (true)", () => {
		expect(
			loadControlConfig({ ssoSecret: "test-secret", containerAutoStart: "  " })
				.containerAutoStart,
		).toBe(true);
	});

	test('"0" and "false" still parse as false, overriding a true fallback', () => {
		expect(
			loadControlConfig({ ssoSecret: "test-secret", containerAutoStart: "0" })
				.containerAutoStart,
		).toBe(false);
		expect(
			loadControlConfig({
				ssoSecret: "test-secret",
				containerAutoStart: "false",
			}).containerAutoStart,
		).toBe(false);
	});

	test('"1" still parses as true, overriding a false fallback', () => {
		expect(
			loadControlConfig({ ssoSecret: "test-secret", demo: "1" }).demo,
		).toBe(true);
	});
});

describe("containerNetwork (via loadControlConfig)", () => {
	test("empty string is treated as unset (port mode), not a network name", () => {
		expect(
			loadControlConfig({ ssoSecret: "test-secret", containerNetwork: "" })
				.containerNetwork,
		).toBe(null);
	});

	test("whitespace-only string is treated as unset", () => {
		expect(
			loadControlConfig({ ssoSecret: "test-secret", containerNetwork: "  " })
				.containerNetwork,
		).toBe(null);
	});

	test("a real network name is trimmed and kept", () => {
		expect(
			loadControlConfig({
				ssoSecret: "test-secret",
				containerNetwork: " coderunner ",
			}).containerNetwork,
		).toBe("coderunner");
	});
});

describe("ssoSecret requirement (via loadControlConfig)", () => {
	test("throws outside demo mode when SSO_SECRET is unset", () => {
		expect(() => loadControlConfig({ demo: false })).toThrow(/SSO_SECRET/);
	});

	test("demo mode does not require SSO_SECRET", () => {
		expect(loadControlConfig({ demo: true }).ssoSecret).toBe(null);
	});

	test("a configured ssoSecret is kept as-is outside demo mode", () => {
		expect(
			loadControlConfig({ demo: false, ssoSecret: "shared-with-legion" })
				.ssoSecret,
		).toBe("shared-with-legion");
	});
});

describe("ssoSessionTtlSeconds (via loadControlConfig)", () => {
	test("defaults to 12 hours, matching Legion's own SSO_SESSION_TTL default", () => {
		expect(
			loadControlConfig({ ssoSecret: "test-secret", demo: true })
				.ssoSessionTtlSeconds,
		).toBe(12 * 60 * 60);
	});

	test("accepts a numeric string override", () => {
		expect(
			loadControlConfig({
				ssoSecret: "test-secret",
				demo: true,
				ssoSessionTtlSeconds: "3600",
			}).ssoSessionTtlSeconds,
		).toBe(3600);
	});
});

describe("codeDiskReadLimit (via loadControlConfig)", () => {
	test("defaults to 64mb", () => {
		expect(
			loadControlConfig({ ssoSecret: "test-secret" }).codeDiskReadLimit,
		).toBe("64mb");
	});

	test("accepts a Docker byte rate and normalizes case", () => {
		expect(
			loadControlConfig({
				ssoSecret: "test-secret",
				codeDiskReadLimit: "100MB",
			}).codeDiskReadLimit,
		).toBe("100mb");
	});

	test('"0" and "off" disable the limit', () => {
		expect(
			loadControlConfig({ ssoSecret: "test-secret", codeDiskReadLimit: "0" })
				.codeDiskReadLimit,
		).toBe(null);
		expect(
			loadControlConfig({ ssoSecret: "test-secret", codeDiskReadLimit: "off" })
				.codeDiskReadLimit,
		).toBe(null);
	});

	test("empty string means unset and falls back to the default", () => {
		expect(
			loadControlConfig({ ssoSecret: "test-secret", codeDiskReadLimit: "" })
				.codeDiskReadLimit,
		).toBe("64mb");
	});

	test("explicit null disables the limit", () => {
		expect(
			loadControlConfig({ ssoSecret: "test-secret", codeDiskReadLimit: null })
				.codeDiskReadLimit,
		).toBe(null);
	});

	test("rejects values Docker would not accept", () => {
		expect(() =>
			loadControlConfig({
				ssoSecret: "test-secret",
				codeDiskReadLimit: "fast",
			}),
		).toThrow(/CODE_DISK_READ_LIMIT/);
		expect(() =>
			loadControlConfig({
				ssoSecret: "test-secret",
				codeDiskReadLimit: "64 mb",
			}),
		).toThrow(/CODE_DISK_READ_LIMIT/);
	});
});
