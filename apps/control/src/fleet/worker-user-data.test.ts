import { describe, expect, test } from "bun:test";
import { WORKER_READY_MARKER } from "./ssh-worker-probe";
import { renderWorkerUserData } from "./worker-user-data";

describe("renderWorkerUserData", () => {
	test("mounts the head's export at the identical path, then marks ready", () => {
		const rendered = renderWorkerUserData({
			nfsServerIp: "10.116.0.3",
			sharedPath: "/mnt/scriptum-data/users",
		});

		expect(rendered.startsWith("#cloud-config\n")).toBe(true);
		expect(rendered).toContain(
			"10.116.0.3:/mnt/scriptum-data/users /mnt/scriptum-data/users nfs4",
		);
		// The ready marker only appears if the mount succeeded.
		expect(rendered).toContain(
			`mount /mnt/scriptum-data/users && touch ${WORKER_READY_MARKER}`,
		);
	});

	test("rejects values that would break out of the cloud-init script", () => {
		expect(() =>
			renderWorkerUserData({
				nfsServerIp: "10.116.0.3; rm -rf /",
				sharedPath: "/mnt/scriptum-data/users",
			}),
		).toThrow(/Invalid NFS server IP/);
		expect(() =>
			renderWorkerUserData({
				nfsServerIp: "10.116.0.3",
				sharedPath: '/mnt/x" >> /etc/passwd',
			}),
		).toThrow(/Invalid shared path/);
	});
});
