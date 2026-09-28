import { randomBytes } from "node:crypto";
import type { WorkspaceId } from "@frc-scriptum/contracts";
import { CapacityExceededError } from "../containers/errors";
import { getLogger } from "../logging";
import type { AppStorage, WorkerRow } from "../storage";
import { deriveWorkerCapacity, isWorkerDestroyEligible } from "./scheduler";
import type { FleetProvisioner, WorkerProbe } from "./types";

const log = getLogger("fleet");

export type FleetManagerOptions = {
	/** RAM (MB) of one worker droplet - with codeMemoryLimitMb, derives the
	 * per-worker capacity (decision 048, design point #2). */
	workerMemoryMb: number;
	/** Per-student memory cap (CODE_MEMORY_LIMIT, MB). */
	codeMemoryLimitMb: number;
	/** Hard ceiling on worker droplets, booting ones included. The runaway-
	 * billing guard: placement past it is refused, never provisioned. */
	maxWorkers: number;
	/** How long a worker must stay continuously empty before it's destroyed
	 * (decision 048, design point #9). */
	idleGracePeriodMs: number;
	/** A booting worker that isn't ready by then is destroyed. */
	readyTimeoutMs?: number | undefined;
	/** After a failed droplet create, don't try again for this long - a
	 * persistent failure (bad image id, quota) must not loop creates. */
	createFailureBackoffMs?: number | undefined;
	/** A tagged droplet the head has no record of is destroyed once it's
	 * older than this. Longer than the provisioner's own create timeout, so an
	 * in-flight create is never mistaken for an orphan. */
	orphanGraceMs?: number | undefined;
	/** Called after a worker row is deleted (destroyed or vanished). */
	onWorkerRemoved?: ((workerId: string) => void) | undefined;
	workerIdFactory?: (() => string) | undefined;
	now?: (() => number) | undefined;
};

export type Placement =
	/** Assigned to a worker; `ready` says whether its daemon is reachable. */
	| { kind: "placed"; workerId: string; ready: boolean }
	/** Waiting on a worker droplet that is still being created. */
	| { kind: "pending" }
	/** The last droplet create failed; placement is backing off. */
	| { kind: "failed"; message: string }
	| { kind: "unplaced" };

type PendingCreate = { reserved: Set<WorkspaceId> };

const DEFAULT_READY_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_CREATE_FAILURE_BACKOFF_MS = 2 * 60_000;
const DEFAULT_ORPHAN_GRACE_MS = 15 * 60_000;

function randomWorkerId(): string {
	return `worker_${randomBytes(16).toString("hex")}`;
}

/**
 * Decides where each workspace runs and keeps the worker fleet sized to
 * demand (decision 048): places workspaces pack-tightest onto existing
 * workers, creates a droplet when none has room, marks booting workers ready
 * once they answer, destroys workers that have sat empty past the grace
 * period, and destroys tagged droplets it has no record of.
 *
 * Placement never blocks on a droplet boot: a workspace waiting on a new
 * worker reports `pending`, and the caller shows "starting" until a later
 * poll finds its worker ready.
 */
export class FleetManager {
	private readonly capacity: number;
	private readonly readyTimeoutMs: number;
	private readonly createFailureBackoffMs: number;
	private readonly orphanGraceMs: number;
	private readonly now: () => number;
	/** When each worker was first seen empty. In-memory on purpose: losing it
	 * on a head restart only delays a destroy by one grace period. */
	private readonly emptySince = new Map<string, number>();
	/** Droplet creates in flight. Not yet in the workers table (the row needs
	 * the droplet's private IP), so tracked here to count toward capacity and
	 * maxWorkers. Lost on restart; the orphan sweep reclaims their droplets. */
	private readonly pending = new Set<PendingCreate>();
	private lastCreateFailure: { atMs: number; message: string } | null = null;
	private timer: ReturnType<typeof setInterval> | null = null;
	private tickRunning = false;
	private lastSlowSweepMs = 0;

	constructor(
		private readonly storage: AppStorage,
		private readonly provisioner: FleetProvisioner,
		private readonly probe: WorkerProbe,
		private readonly options: FleetManagerOptions,
	) {
		this.capacity = deriveWorkerCapacity(
			options.workerMemoryMb,
			options.codeMemoryLimitMb,
		);
		this.readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
		this.createFailureBackoffMs =
			options.createFailureBackoffMs ?? DEFAULT_CREATE_FAILURE_BACKOFF_MS;
		this.orphanGraceMs = options.orphanGraceMs ?? DEFAULT_ORPHAN_GRACE_MS;
		this.now = options.now ?? Date.now;
	}

	get workerCapacity(): number {
		return this.capacity;
	}

	/** Where a workspace stands right now, without placing or creating. */
	lookup(workspaceId: WorkspaceId): Placement {
		const workerId = this.storage.findWorkspaceById(workspaceId)?.worker_id;
		if (workerId) {
			const worker = this.storage.getWorker(workerId);
			if (worker) {
				return {
					kind: "placed",
					workerId,
					ready: worker.status === "ready",
				};
			}
		}
		for (const create of this.pending) {
			if (create.reserved.has(workspaceId)) {
				return { kind: "pending" };
			}
		}
		return { kind: "unplaced" };
	}

	/**
	 * Ensure the workspace has (or is waiting on) a worker. Returns
	 * immediately; a needed droplet create runs in the background. Throws
	 * CapacityExceededError when the fleet is at maxWorkers and full.
	 */
	placeWorkspace(workspaceId: WorkspaceId): Placement {
		const current = this.lookup(workspaceId);
		if (current.kind !== "unplaced") {
			return current;
		}

		const worker = this.selectWorker();
		if (worker) {
			this.storage.setWorkspaceWorker(workspaceId, worker.id);
			this.emptySince.delete(worker.id);
			return {
				kind: "placed",
				workerId: worker.id,
				ready: worker.status === "ready",
			};
		}

		for (const create of this.pending) {
			if (create.reserved.size < this.capacity) {
				create.reserved.add(workspaceId);
				return { kind: "pending" };
			}
		}

		const failure = this.lastCreateFailure;
		if (failure && this.now() - failure.atMs < this.createFailureBackoffMs) {
			return { kind: "failed", message: failure.message };
		}

		const workerCount = this.storage.listWorkers().length + this.pending.size;
		if (workerCount >= this.options.maxWorkers) {
			const limit = this.options.maxWorkers * this.capacity;
			throw new CapacityExceededError(limit, this.placedCount());
		}

		this.startCreate(workspaceId);
		return { kind: "pending" };
	}

	/** Release a workspace's worker slot (its container has stopped). */
	unplaceWorkspace(workspaceId: WorkspaceId): void {
		for (const create of this.pending) {
			create.reserved.delete(workspaceId);
		}
		this.storage.setWorkspaceWorker(workspaceId, null);
	}

	start(intervalMs = 10_000): void {
		if (this.timer) return;
		this.timer = setInterval(() => void this.tick(), intervalMs);
		this.timer.unref?.();
		void this.tick();
	}

	stop(): void {
		if (!this.timer) return;
		clearInterval(this.timer);
		this.timer = null;
	}

	/** One maintenance pass: readiness every tick, the slower destroy/orphan
	 * sweeps about once a minute. Never overlaps itself. */
	async tick(): Promise<void> {
		if (this.tickRunning) return;
		this.tickRunning = true;
		try {
			await this.checkProvisioningWorkers();
			const nowMs = this.now();
			if (nowMs - this.lastSlowSweepMs >= 60_000) {
				this.lastSlowSweepMs = nowMs;
				await this.sweepIdleWorkers(nowMs);
				await this.reconcileDroplets(nowMs);
			}
		} catch (err) {
			log.error("fleet maintenance failed", {
				err: err instanceof Error ? err : new Error(String(err)),
			});
		} finally {
			this.tickRunning = false;
		}
	}

	/** Promote booting workers that now answer; destroy ones that never do. */
	async checkProvisioningWorkers(): Promise<void> {
		for (const worker of this.storage.listWorkers()) {
			if (worker.status !== "provisioning") continue;
			let ready = false;
			try {
				ready = await this.probe.isReady(worker);
			} catch {
				ready = false;
			}
			if (ready) {
				this.storage.setWorkerStatus(worker.id, "ready");
				log.info("worker ready", {
					workerId: worker.id,
					bootSeconds: Math.round(
						(this.now() - Date.parse(worker.created_at)) / 1000,
					),
				});
				continue;
			}
			if (this.now() - Date.parse(worker.created_at) >= this.readyTimeoutMs) {
				log.error("worker never became ready; destroying", {
					workerId: worker.id,
					dropletId: worker.do_droplet_id,
				});
				await this.destroy(worker);
			}
		}
	}

	/** Destroy ready workers that have held no workspace for the grace
	 * period. Returns the ids destroyed. */
	async sweepIdleWorkers(nowMs: number = this.now()): Promise<string[]> {
		const destroyed: string[] = [];
		for (const worker of this.storage.listWorkers()) {
			if (worker.status === "destroying") {
				// A previous destroy call failed partway; finish it.
				await this.destroy(worker);
				destroyed.push(worker.id);
				continue;
			}
			const currentCount = this.storage.countWorkspacesOnWorker(worker.id);
			if (currentCount > 0) {
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
			if (!eligible) continue;
			await this.destroy(worker);
			destroyed.push(worker.id);
		}
		return destroyed;
	}

	/**
	 * Keep DigitalOcean and the workers table in agreement: destroy tagged
	 * droplets the head has no row for (a create whose row was never written,
	 * e.g. the head restarted mid-create), and drop rows whose droplet no
	 * longer exists (destroyed from the DO console).
	 */
	async reconcileDroplets(nowMs: number = this.now()): Promise<void> {
		const droplets = await this.provisioner.listWorkerDroplets();
		const live = new Set(droplets.map((droplet) => droplet.doDropletId));
		const known = new Set<string>();
		for (const worker of this.storage.listWorkers()) {
			known.add(worker.do_droplet_id);
			if (!live.has(worker.do_droplet_id)) {
				log.warn("worker droplet vanished; dropping it", {
					workerId: worker.id,
					dropletId: worker.do_droplet_id,
				});
				this.removeRow(worker.id);
			}
		}
		for (const droplet of droplets) {
			if (known.has(droplet.doDropletId)) continue;
			if (nowMs - droplet.createdAtMs < this.orphanGraceMs) continue;
			log.warn("destroying orphaned worker droplet", {
				dropletId: droplet.doDropletId,
			});
			await this.provisioner.destroyWorker(droplet.doDropletId);
		}
	}

	private selectWorker(): WorkerRow | null {
		let best: { worker: WorkerRow; count: number } | null = null;
		for (const worker of this.storage.listWorkers()) {
			if (worker.status !== "ready" && worker.status !== "provisioning") {
				continue;
			}
			const count = this.storage.countWorkspacesOnWorker(worker.id);
			if (count >= worker.capacity) continue;
			// Ready beats booting; then pack-tightest (decision 048, point #10).
			const better =
				!best ||
				(worker.status === "ready" && best.worker.status !== "ready") ||
				(worker.status === best.worker.status && count > best.count);
			if (better) best = { worker, count };
		}
		return best?.worker ?? null;
	}

	private placedCount(): number {
		let total = 0;
		for (const worker of this.storage.listWorkers()) {
			total += this.storage.countWorkspacesOnWorker(worker.id);
		}
		for (const create of this.pending) {
			total += create.reserved.size;
		}
		return total;
	}

	private startCreate(firstWorkspace: WorkspaceId): void {
		const create: PendingCreate = { reserved: new Set([firstWorkspace]) };
		this.pending.add(create);
		log.info("creating worker droplet", {
			workers: this.storage.listWorkers().length,
			pending: this.pending.size,
		});
		void this.provisioner
			.createWorker({ capacity: this.capacity })
			.then((provisioned) => {
				const id = this.options.workerIdFactory?.() ?? randomWorkerId();
				this.storage.createWorker({
					id,
					doDropletId: provisioned.doDropletId,
					privateIp: provisioned.privateIp,
					capacity: this.capacity,
				});
				for (const workspaceId of create.reserved) {
					this.storage.setWorkspaceWorker(workspaceId, id);
				}
				this.lastCreateFailure = null;
				log.info("worker droplet created", {
					workerId: id,
					dropletId: provisioned.doDropletId,
				});
			})
			.catch((err: unknown) => {
				const message = err instanceof Error ? err.message : String(err);
				this.lastCreateFailure = { atMs: this.now(), message };
				log.error("worker droplet create failed", {
					err: err instanceof Error ? err : new Error(message),
				});
			})
			.finally(() => {
				this.pending.delete(create);
			});
	}

	private async destroy(worker: WorkerRow): Promise<void> {
		this.storage.setWorkerStatus(worker.id, "destroying");
		await this.provisioner.destroyWorker(worker.do_droplet_id);
		this.removeRow(worker.id);
		log.info("worker destroyed", {
			workerId: worker.id,
			dropletId: worker.do_droplet_id,
		});
	}

	private removeRow(workerId: string): void {
		this.storage.deleteWorker(workerId);
		this.emptySince.delete(workerId);
		this.options.onWorkerRemoved?.(workerId);
	}
}
