import { describe, expect, test } from "bun:test";
import type { WorkerRow } from "../storage";
import { SshWorkerProbe, WORKER_READY_MARKER } from "./ssh-worker-probe";

const WORKER = { private_ip: "10.116.0.9" } as WorkerRow;

describe("SshWorkerProbe", () => {
	test("checks boot marker, mount, and Docker in one SSH call", async () => {
		const seen: string[][] = [];
		const probe = new SshWorkerProbe({
			sshUser: "root",
			mountPoint: "/mnt/scriptum-data/users",
			spawn: async (argv) => {
				seen.push(argv);
				return 0;
			},
		});

		expect(await probe.isReady(WORKER)).toBe(true);
		const argv = seen[0] ?? [];
		expect(argv).toContain("BatchMode=yes");
		expect(argv).toContain("root@10.116.0.9");
		const remote = argv.at(-1) ?? "";
		expect(remote).toContain(`test -f ${WORKER_READY_MARKER}`);
		expect(remote).toContain("mountpoint -q /mnt/scriptum-data/users");
		expect(remote).toContain("docker info");
	});

	test("is not ready on a non-zero exit or a killed SSH", async () => {
		for (const code of [1, 255, null]) {
			const probe = new SshWorkerProbe({
				sshUser: "root",
				mountPoint: "/mnt/scriptum-data/users",
				spawn: async () => code,
			});
			expect(await probe.isReady(WORKER)).toBe(false);
		}
	});
});
