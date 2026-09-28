import { describe, expect, test } from "bun:test";
import { isFleetMode, loadFleetConfig, parseMemoryMb } from "./fleet-config";

const COMPLETE = {
	SCRIPTUM_FLEET: "1",
	SCRIPTUM_DO_TOKEN: "dop_v1_test",
	SCRIPTUM_WORKER_IMAGE: "123456",
	SCRIPTUM_WORKER_VPC_UUID: "vpc-uuid",
	SCRIPTUM_WORKER_SSH_KEYS: "111, aa:bb:cc",
	SCRIPTUM_NFS_SERVER_IP: "10.116.0.3",
	FRC_CONTAINER_USER: "1000:1000",
};

describe("loadFleetConfig", () => {
	test("is off unless SCRIPTUM_FLEET is set", () => {
		expect(isFleetMode({})).toBe(false);
		expect(isFleetMode({ SCRIPTUM_FLEET: "0" })).toBe(false);
		expect(loadFleetConfig({}, null)).toBeNull();
	});

	test("reads a complete config with defaults filled in", () => {
		const config = loadFleetConfig(COMPLETE, "/mnt/scriptum-data");
		expect(config).toMatchObject({
			region: "nyc1",
			sizeSlug: "s-4vcpu-8gb",
			workerMemoryMb: 8192,
			sshKeyIds: ["111", "aa:bb:cc"],
			sshUser: "root",
			maxWorkers: 3,
			idleGraceMs: 20 * 60_000,
			sharedPath: "/mnt/scriptum-data/users",
			blockDevices: ["/dev/vda"],
		});
	});

	test("lists every missing setting at once", () => {
		expect(() => loadFleetConfig({ SCRIPTUM_FLEET: "1" }, null)).toThrow(
			/SCRIPTUM_DO_TOKEN.*SCRIPTUM_WORKER_IMAGE.*SCRIPTUM_WORKER_VPC_UUID.*SCRIPTUM_NFS_SERVER_IP.*SCRIPTUM_WORKER_SSH_KEYS.*FRC_HOST_DATA_DIR.*FRC_CONTAINER_USER/,
		);
	});

	test("rejects a non-numeric worker cap", () => {
		expect(() =>
			loadFleetConfig(
				{ ...COMPLETE, SCRIPTUM_MAX_WORKERS: "lots" },
				"/mnt/scriptum-data",
			),
		).toThrow(/SCRIPTUM_MAX_WORKERS/);
	});
});

describe("parseMemoryMb", () => {
	test("understands Docker memory sizes", () => {
		expect(parseMemoryMb("3072m")).toBe(3072);
		expect(parseMemoryMb("4g")).toBe(4096);
		expect(parseMemoryMb("4096M")).toBe(4096);
		expect(parseMemoryMb(String(2 * 1024 * 1024 * 1024))).toBe(2048);
		expect(() => parseMemoryMb("lots")).toThrow();
	});
});
