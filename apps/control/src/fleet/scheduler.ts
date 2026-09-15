import type { WorkerStatus } from "../storage";

/**
 * Pure placement/lifecycle decisions for the worker fleet - see
 * docs/decisions/048. Deliberately free of Docker, DB, and DO-API calls so
 * these can be unit-tested without any real infrastructure; the fleet-manager
 * service that wires this to storage.ts and a real FleetProvisioner is later
 * work (Phase 2+, once there's a DO account to build it against).
 */

export type WorkerCandidate = {
	id: string;
	status: WorkerStatus;
	capacity: number;
	/** Count of workspaces currently placed on this worker (running or not -
	 * see storage.ts's countWorkspacesOnWorker). */
	currentCount: number;
};

/**
 * Pack-tightest placement (decision 048, design point #10): among `ready`
 * workers with spare capacity, pick the *fullest* one, never the emptiest.
 * Spreading load evenly creates more thinly-loaded workers, which is worse
 * fragmentation, not better - packing tight keeps stragglers rare and lets
 * empty workers actually reach zero and become destroy-eligible.
 *
 * Returns null when no existing worker has room, meaning the caller should
 * provision a new one.
 */
export function selectWorkerForPlacement(
	candidates: readonly WorkerCandidate[],
): string | null {
	let best: WorkerCandidate | null = null;
	for (const candidate of candidates) {
		if (candidate.status !== "ready") {
			continue;
		}
		if (candidate.currentCount >= candidate.capacity) {
			continue;
		}
		if (!best || candidate.currentCount > best.currentCount) {
			best = candidate;
		}
	}
	return best?.id ?? null;
}

/**
 * Idle/scale-down debounce (decision 048, design point #9): a worker is only
 * eligible for destruction once it has held zero placed workspaces
 * continuously for at least `gracePeriodMs`. `emptySinceMs` is supplied by the
 * caller (whichever process is tracking when each worker's count first hit
 * zero) rather than owned here, keeping this function pure and independent of
 * how that timer is persisted.
 */
export function isWorkerDestroyEligible(
	worker: Pick<WorkerCandidate, "status" | "currentCount">,
	emptySinceMs: number | null,
	nowMs: number,
	gracePeriodMs: number,
): boolean {
	if (worker.status !== "ready") {
		return false;
	}
	if (worker.currentCount !== 0) {
		return false;
	}
	if (emptySinceMs === null) {
		return false;
	}
	return nowMs - emptySinceMs >= gracePeriodMs;
}

/**
 * How many concurrent student containers a worker of `workerMemoryMb` should
 * accept, given the per-student memory cap (`CODE_MEMORY_LIMIT`, in MB) -
 * decision 048, design point #2. Always at least 1: a worker too small for
 * even one student shouldn't silently vanish from placement, it should fail
 * loudly at provisioning time instead.
 */
export function deriveWorkerCapacity(
	workerMemoryMb: number,
	codeMemoryLimitMb: number,
): number {
	return Math.max(1, Math.floor(workerMemoryMb / codeMemoryLimitMb));
}
