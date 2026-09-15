import { randomBytes } from "node:crypto";
import type { WorkspaceId } from "@frc-coderunner/contracts";
import type { AppStorage } from "../storage";
import {
	deriveWorkerCapacity,
	isWorkerDestroyEligible,
	selectWorkerForPlacement,
	type WorkerCandidate,
} from "./scheduler";
import type { FleetProvisioner } from "./types";

export type FleetManagerOptions = {
	/** RAM (MB) of one worker droplet - used with codeMemoryLimitMb to derive
	 * the per-worker capacity cap (decision 048, design point #2). */
	workerMemoryMb: number;
	/** Per-student memory cap (CODE_MEMORY_LIMIT, MB). */
	codeMemoryLimitMb: number;
	/** How long a worker must stay continuously empty before it's destroyed
	 * (decision 048, design point #9). */
	idleGracePeriodMs: number;
	/** Overridable for deterministic test ids; defaults to a random one. */
	workerIdFactory?: () => string;
};

function randomWorkerId(): string {
	return `worker_${randomBytes(16).toString("hex")}`;
}

/**
 * Ties the pure scheduler (scheduler.ts) to real storage and a
 * FleetProvisioner: decides when an unplaced workspace needs a new worker
 * droplet, and when an idle one should be destroyed. See docs/decisions/048.
 *
 * Not wired into createApp() yet - Phase 3, once real worker droplets exist
 * to cut traffic over to. A real FleetProvisioner (DigitalOcean's REST API)
 * is Phase 2; this class works against any FleetProvisioner, tested here
 * with a fake one.
 */
export class FleetManager {
	private readonly capacity: number;
	/** When each worker was first observed with zero placed workspaces -
	 * the grace-period clock scheduler.ts's isWorkerDestroyEligible needs.
	 * Deliberately in-memory, not persisted: losing this on a head restart
	 * just means idle workers get one extra grace period before eligibility
	 * is reconsidered, never an incorrect destroy. */
	private readonly emptySince = new Map<string, number>();

	constructor(
		private readonly storage: AppStorage,
		private readonly provisioner: FleetProvisioner,
		private readonly options: FleetManagerOptions,
	) {
		this.capacity = deriveWorkerCapacity(
			options.workerMemoryMb,
			options.codeMemoryLimitMb,
		);
	}

	/**
	 * Ensure `workspaceId` has a worker assigned, provisioning a new one via
	 * the FleetProvisioner if every existing `ready` worker is full.
	 * Idempotent - a workspace that already has a worker keeps it, this never
	 * re-places a currently-placed workspace (see decision 048, design point
	 * #10: only an *unplaced* - never started, or idle-stopped - workspace is
	 * eligible for a fresh placement decision).
	 *
	 * A newly created worker starts `provisioning`, not `ready`, so a burst of
	 * other unplaced workspaces arriving before markWorkerReady() is called
	 * for it will each provision their own new worker rather than queue up
	 * for one still booting - a deliberate conservative choice (over-
	 * provisioning briefly during a cold start is preferable to blocking a
	 * student's first login on it).
	 */
	async placeWorkspace(workspaceId: WorkspaceId): Promise<string> {
		const workspace = this.storage.findWorkspaceById(workspaceId);
		if (workspace?.worker_id) {
			return workspace.worker_id;
		}

		let workerId = selectWorkerForPlacement(this.candidates());
		if (!workerId) {
			workerId = await this.createWorker();
		}
		this.storage.setWorkspaceWorker(workspaceId, workerId);
		this.emptySince.delete(workerId);
		return workerId;
	}

	/** Call once a newly created worker has actually finished booting (NFS
	 * mounted, Docker reachable, registered with the head) - see decision
	 * 048's cold-start notes. Only `ready` workers are eligible for new
	 * placement decisions (selectWorkerForPlacement) or destruction
	 * (isWorkerDestroyEligible). */
	markWorkerReady(workerId: string): void {
		this.storage.setWorkerStatus(workerId, "ready");
	}

	/**
	 * Run periodically (a timer in the real head process) to destroy workers
	 * that have been continuously empty for at least the configured grace
	 * period. Returns the ids of workers destroyed this sweep.
	 */
	async sweepIdleWorkers(nowMs: number = Date.now()): Promise<string[]> {
		const destroyed: string[] = [];
		for (const worker of this.storage.listWorkers()) {
			const currentCount = this.storage.countWorkspacesOnWorker(worker.id);
			if (currentCount > 0) {
				// No longer empty (or never was) - clear any running timer so a
				// later empty spell starts its own fresh grace period rather than
				// inheriting one from before this worker was last in use.
				this.emptySince.delete(worker.id);
				continue;
			}
			if (!this.emptySince.has(worker.id)) {
				this.emptySince.set(worker.id, nowMs);
			}
			const eligible = isWorkerDestroyEligible(
				{ status: worker.status, currentCount },
				this.emptySince.get(worker.id) ?? null,
				nowMs,
				this.options.idleGracePeriodMs,
			);
			if (!eligible) {
				continue;
			}
			await this.provisioner.destroyWorker(worker.do_droplet_id);
			this.storage.deleteWorker(worker.id);
			this.emptySince.delete(worker.id);
			destroyed.push(worker.id);
		}
		return destroyed;
	}

	private candidates(): WorkerCandidate[] {
		return this.storage.listWorkers().map((worker) => ({
			id: worker.id,
			status: worker.status,
			capacity: worker.capacity,
			currentCount: this.storage.countWorkspacesOnWorker(worker.id),
		}));
	}

	private async createWorker(): Promise<string> {
		const provisioned = await this.provisioner.createWorker({
			capacity: this.capacity,
		});
		const id = this.options.workerIdFactory?.() ?? randomWorkerId();
		this.storage.createWorker({
			id,
			doDropletId: provisioned.doDropletId,
			privateIp: provisioned.privateIp,
			capacity: this.capacity,
		});
		return id;
	}
}
