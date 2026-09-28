import type { WorkerRow } from "../storage";

/**
 * Head/worker fleet abstractions - see docs/decisions/048.
 */

export type WorkerSpec = {
	/** How many concurrent student containers this worker should accept,
	 * derived from its droplet RAM ÷ CODE_MEMORY_LIMIT. */
	capacity: number;
};

export type ProvisionedWorker = {
	doDropletId: string;
	privateIp: string;
};

/**
 * Abstracts DigitalOcean droplet lifecycle so the scheduler and its tests
 * never need a real DO account or network access. `createWorker` provisions
 * from the pre-baked golden snapshot (decision 048, design point #8);
 * `destroyWorker` is a hard destroy, not a stop - see decision 048's "Data
 * persistence" answer for why that's safe (nothing worth keeping lives on a
 * worker's own disk).
 */
export type WorkerDroplet = {
	doDropletId: string;
	createdAtMs: number;
};

export interface FleetProvisioner {
	createWorker(spec: WorkerSpec): Promise<ProvisionedWorker>;
	/** Idempotent: destroying a droplet that is already gone succeeds. */
	destroyWorker(doDropletId: string): Promise<void>;
	/** Every droplet carrying the worker tag, known to the head or not. */
	listWorkerDroplets(): Promise<WorkerDroplet[]>;
}

/** Answers whether a booting worker can take workspaces yet: SSH answers,
 * the shared filesystem is mounted, and its Docker daemon responds. */
export interface WorkerProbe {
	isReady(worker: WorkerRow): Promise<boolean>;
}
