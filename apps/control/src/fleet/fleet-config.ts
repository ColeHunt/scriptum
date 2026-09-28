import { posix } from "node:path";

type Env = Record<string, string | undefined>;

/** Settings for fleet mode (decision 048). See docs/deploying/fleet.md. */
export type FleetConfig = {
	doApiToken: string;
	region: string;
	sizeSlug: string;
	/** RAM of one worker; with CODE_MEMORY_LIMIT, sets students per worker. */
	workerMemoryMb: number;
	/** Golden snapshot id (bake-golden-image.sh). */
	imageId: string;
	vpcUuid: string;
	/** DO SSH key ids/fingerprints installed on every worker. */
	sshKeyIds: string[];
	sshUser: string;
	maxWorkers: number;
	idleGraceMs: number;
	/** The head's private IP, which serves the NFS export. */
	nfsServerIp: string;
	/** `<host data dir>/users`: exported by the head, mounted by workers at
	 * the same path so host paths computed on the head hold on the worker. */
	sharedPath: string;
	/** Worker disks for `--device-read-bps`; the head's own /sys/block
	 * describes the head, not the worker. */
	blockDevices: string[];
};

export function isFleetMode(env: Env): boolean {
	const value = env.SCRIPTUM_FLEET?.trim().toLowerCase();
	return value === "1" || value === "true" || value === "yes";
}

/**
 * Read fleet mode's settings, or null when SCRIPTUM_FLEET is off. Throws
 * listing every missing or invalid setting at once, so a half-configured
 * head fails at startup instead of when the first student arrives.
 */
export function loadFleetConfig(
	env: Env,
	hostDataDir: string | null,
): FleetConfig | null {
	if (!isFleetMode(env)) {
		return null;
	}
	const problems: string[] = [];
	const required = (name: string): string => {
		const value = env[name]?.trim();
		if (!value) problems.push(`${name} is required`);
		return value ?? "";
	};
	const positive = (name: string, fallback: number): number => {
		const raw = env[name]?.trim();
		if (!raw) return fallback;
		const value = Number(raw);
		if (!Number.isInteger(value) || value < 1) {
			problems.push(`${name} must be a positive integer`);
			return fallback;
		}
		return value;
	};

	const doApiToken = required("SCRIPTUM_DO_TOKEN");
	const imageId = required("SCRIPTUM_WORKER_IMAGE");
	const vpcUuid = required("SCRIPTUM_WORKER_VPC_UUID");
	const nfsServerIp = required("SCRIPTUM_NFS_SERVER_IP");
	const sshKeyIds = required("SCRIPTUM_WORKER_SSH_KEYS")
		.split(",")
		.map((key) => key.trim())
		.filter(Boolean);
	if (!hostDataDir) {
		problems.push(
			"FRC_HOST_DATA_DIR is required (the head's student-data mount, e.g. /mnt/scriptum-data)",
		);
	}
	if (!env.FRC_CONTAINER_USER?.trim()) {
		problems.push(
			"FRC_CONTAINER_USER is required (uid:gid owning the student-data mount, e.g. 1000:1000)",
		);
	}
	const workerMemoryMb = positive("SCRIPTUM_WORKER_MEMORY_MB", 8192);
	const maxWorkers = positive("SCRIPTUM_MAX_WORKERS", 3);
	const idleMinutes = positive("SCRIPTUM_WORKER_IDLE_MINUTES", 20);

	if (problems.length > 0) {
		throw new Error(`Fleet mode is misconfigured: ${problems.join("; ")}.`);
	}
	return {
		doApiToken,
		region: env.SCRIPTUM_WORKER_REGION?.trim() || "nyc1",
		sizeSlug: env.SCRIPTUM_WORKER_SIZE?.trim() || "s-4vcpu-8gb",
		workerMemoryMb,
		imageId,
		vpcUuid,
		sshKeyIds,
		sshUser: env.SCRIPTUM_WORKER_SSH_USER?.trim() || "root",
		maxWorkers,
		idleGraceMs: idleMinutes * 60_000,
		nfsServerIp,
		sharedPath: posix.join(hostDataDir as string, "users"),
		blockDevices: (env.SCRIPTUM_WORKER_BLOCK_DEVICES ?? "/dev/vda")
			.split(",")
			.map((device) => device.trim())
			.filter(Boolean),
	};
}

/** CODE_MEMORY_LIMIT ("3072m", "4g", "4096") in MB. */
export function parseMemoryMb(value: string): number {
	const match = /^(\d+(?:\.\d+)?)\s*([kmg]?)b?$/i.exec(value.trim());
	if (!match) {
		throw new Error(`Unrecognised memory size: ${value}`);
	}
	const amount = Number(match[1]);
	const unit = (match[2] ?? "").toLowerCase();
	const mb =
		unit === "g"
			? amount * 1024
			: unit === "k"
				? amount / 1024
				: unit === "m"
					? amount
					: amount / (1024 * 1024);
	return Math.floor(mb);
}
