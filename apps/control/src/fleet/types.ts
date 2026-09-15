/**
 * Head/worker fleet abstractions - see docs/decisions/048. Phase 1 (current)
 * defines these interfaces and a scheduler/runtime-provider that work against
 * a fake FleetProvisioner in tests; a real DigitalOceanFleetProvisioner
 * (Phase 2) needs an actual DO account to build and verify against.
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
export interface FleetProvisioner {
	createWorker(spec: WorkerSpec): Promise<ProvisionedWorker>;
	destroyWorker(doDropletId: string): Promise<void>;
}
