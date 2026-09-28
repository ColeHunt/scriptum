import type { WorkerRow } from "../storage";
import type { WorkerProbe } from "./types";

/** Written by worker-user-data.yaml.tmpl after the NFS mount succeeds. */
export const WORKER_READY_MARKER = "/var/log/scriptum-worker-ready";

export type SshWorkerProbeOptions = {
	sshUser: string;
	/** Where the worker mounts the head's student-data export. */
	mountPoint: string;
	sshPath?: string | undefined;
	timeoutMs?: number | undefined;
	/** Override for tests. */
	spawn?:
		| ((argv: string[], timeoutMs: number) => Promise<number | null>)
		| undefined;
};

/**
 * Readiness check for a booting worker: SSH answers, first-boot finished
 * (marker file), student data is mounted, and Docker responds. Uses the same
 * SSH identity and client config the Docker CLI uses for DOCKER_HOST=ssh://.
 */
export class SshWorkerProbe implements WorkerProbe {
	constructor(private readonly options: SshWorkerProbeOptions) {}

	async isReady(worker: WorkerRow): Promise<boolean> {
		const timeoutMs = this.options.timeoutMs ?? 15_000;
		const argv = [
			this.options.sshPath ?? "ssh",
			"-o",
			"BatchMode=yes",
			"-o",
			"ConnectTimeout=5",
			`${this.options.sshUser}@${worker.private_ip}`,
			[
				`test -f ${WORKER_READY_MARKER}`,
				`mountpoint -q ${this.options.mountPoint}`,
				"docker info >/dev/null 2>&1",
			].join(" && "),
		];
		const exitCode = await (this.options.spawn ?? spawnWithTimeout)(
			argv,
			timeoutMs,
		);
		return exitCode === 0;
	}
}

async function spawnWithTimeout(
	argv: string[],
	timeoutMs: number,
): Promise<number | null> {
	const subprocess = Bun.spawn(argv, {
		stdout: "ignore",
		stderr: "ignore",
		stdin: "ignore",
	});
	const timeout = setTimeout(() => {
		try {
			subprocess.kill("SIGKILL");
		} catch {
			// best effort
		}
	}, timeoutMs);
	try {
		return await subprocess.exited;
	} finally {
		clearTimeout(timeout);
	}
}
