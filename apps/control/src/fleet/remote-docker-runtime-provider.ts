import type { WorkspaceId } from "@frc-scriptum/contracts";
import { LocalDockerRuntimeProvider } from "../containers/local-docker-runtime-provider";
import type { ContainerOrchestratorOptions } from "../containers/types";
import { getLogger } from "../logging";
import type {
	ExecOptions,
	ExecResult,
	ManagedWorkspaceRuntime,
	WorkspaceRuntime,
	WorkspaceRuntimeCommand,
	WorkspaceRuntimeProvider,
} from "../runtime";
import type { AppStorage, WorkerRow } from "../storage";

const log = getLogger("fleet");

/** Per-worker options for the LocalDockerRuntimeProvider that drives it. */
export type WorkerProviderOptionsFactory = (
	worker: WorkerRow,
) => ContainerOrchestratorOptions;

/**
 * Default per-worker options: drive the worker's own daemon over SSH
 * (`DOCKER_HOST=ssh://user@private-ip`, decision 048 design point #2) and
 * publish each container's ports on the worker's private IP, which is what
 * the head proxies to. Workers are always port mode - the head's compose
 * network doesn't exist on them. The head can't probe a worker's ports
 * locally, so port conflicts are left to the lease table plus Docker's own
 * bind-error retry. Block devices come from config because the head's
 * /sys/block describes the head, not the worker.
 */
export function sshWorkerProviderOptions(
	sshUser: string,
	blockDevices: string[],
): WorkerProviderOptionsFactory {
	return (worker) => ({
		dockerEnv: { DOCKER_HOST: `ssh://${sshUser}@${worker.private_ip}` },
		publishHost: worker.private_ip,
		containerNetwork: null,
		portAvailable: async () => true,
		blockDevices,
	});
}

/**
 * Fleet-aware WorkspaceRuntimeProvider for the "centralized head" deployment
 * model (docs/decisions/048): routes each call to whichever worker droplet
 * currently owns the workspace, by constructing one LocalDockerRuntimeProvider
 * per worker (each with that worker's own Docker transport and publish host)
 * and delegating to it, rather than reimplementing Docker CLI command
 * construction for a remote daemon.
 *
 * Two invariants this relies on (decision 048, design point #3):
 *  1. Every worker is provisioned identically from the same golden image, so
 *     `storage.config`'s host-data-dir/disk-limit settings are valid
 *     fleet-wide constants shared by every per-worker provider instance.
 *  2. The head mounts the shared filesystem at the same host path workers do,
 *     so a per-worker provider's own host-filesystem calls (mkdir/chmod for
 *     workspace homes) - which always run on *this* process, never on the
 *     worker - land on storage every worker also sees.
 *
 * This class does not decide *which* worker an unplaced workspace should
 * land on - that's FleetRuntimeProvider's job, before a workspace's first
 * ensureWorkspaceRunning call. This class only executes against whichever
 * worker is already recorded in storage (via setWorkspaceWorker).
 */
export class RemoteDockerRuntimeProvider implements WorkspaceRuntimeProvider {
	private readonly perWorker = new Map<string, LocalDockerRuntimeProvider>();

	constructor(
		private readonly storage: AppStorage,
		private readonly optionsFor: WorkerProviderOptionsFactory,
	) {}

	/** Drop a destroyed worker's cached provider. */
	forgetWorker(workerId: string): void {
		this.perWorker.delete(workerId);
	}

	private providerFor(workerId: string): LocalDockerRuntimeProvider {
		const cached = this.perWorker.get(workerId);
		if (cached) {
			return cached;
		}
		const worker = this.storage.getWorker(workerId);
		if (!worker) {
			// The workers table's ON DELETE SET NULL means a workspace row can
			// never durably point at a deleted worker - but a worker can still be
			// deleted between this method's caller reading workspace.worker_id and
			// this lookup, so this guards a real (if narrow) race, not dead code.
			throw new Error(`No such worker: ${workerId}`);
		}
		const provider = new LocalDockerRuntimeProvider(
			this.storage,
			this.optionsFor(worker),
		);
		this.perWorker.set(workerId, provider);
		return provider;
	}

	private providerForWorkspace(
		workspaceId: WorkspaceId,
	): LocalDockerRuntimeProvider {
		const workspace = this.storage.findWorkspaceById(workspaceId);
		const workerId = workspace?.worker_id ?? null;
		if (!workerId) {
			throw new Error(
				`Workspace ${workspaceId} has no worker assigned - placement must run before this call (see scheduler.ts).`,
			);
		}
		return this.providerFor(workerId);
	}

	// These six wrappers are deliberately `async`, not a direct `return
	// this.providerForWorkspace(...).method(...)`: providerForWorkspace can
	// throw synchronously (unplaced workspace, or the race noted above), and
	// every WorkspaceRuntimeProvider caller in this app treats these methods
	// as Promise-returning and handles failure via .catch()/await+try. A bare
	// synchronous throw from a non-async method bypasses that - `async` makes
	// TypeScript wrap any synchronous throw into a rejected Promise instead.

	async ensureWorkspaceRunning(
		workspaceId: WorkspaceId,
	): Promise<WorkspaceRuntime> {
		return this.providerForWorkspace(workspaceId).ensureWorkspaceRunning(
			workspaceId,
		);
	}

	async stopWorkspace(workspaceId: WorkspaceId): Promise<void> {
		return this.providerForWorkspace(workspaceId).stopWorkspace(workspaceId);
	}

	async restartWorkspace(workspaceId: WorkspaceId): Promise<WorkspaceRuntime> {
		return this.providerForWorkspace(workspaceId).restartWorkspace(workspaceId);
	}

	async removeWorkspace(workspaceId: WorkspaceId): Promise<void> {
		return this.providerForWorkspace(workspaceId).removeWorkspace(workspaceId);
	}

	async getWorkspaceStatus(
		workspaceId: WorkspaceId,
	): Promise<WorkspaceRuntime> {
		return this.providerForWorkspace(workspaceId).getWorkspaceStatus(
			workspaceId,
		);
	}

	async exec(
		workspaceId: WorkspaceId,
		command: string[],
		options?: ExecOptions,
	): Promise<ExecResult> {
		return this.providerForWorkspace(workspaceId).exec(
			workspaceId,
			command,
			options,
		);
	}

	// Not async: the interface itself is synchronous here (it returns the
	// command handle directly, not a Promise of one), so a synchronous throw
	// from an unplaced/unknown workspace is consistent with that contract -
	// same as LocalDockerRuntimeProvider's own execStream.
	execStream(
		workspaceId: WorkspaceId,
		command: string[],
		options?: ExecOptions,
	): WorkspaceRuntimeCommand {
		return this.providerForWorkspace(workspaceId).execStream(
			workspaceId,
			command,
			options,
		);
	}

	async listRuntimes(): Promise<ManagedWorkspaceRuntime[]> {
		const results: ManagedWorkspaceRuntime[] = [];
		for (const worker of this.readyWorkers()) {
			results.push(
				...(await this.perReadyWorker(worker, [], (provider) =>
					provider.listRuntimes(),
				)),
			);
		}
		return results;
	}

	async cleanupStoppedRuntimes(): Promise<string[]> {
		const removed: string[] = [];
		for (const worker of this.readyWorkers()) {
			removed.push(
				...(await this.perReadyWorker(worker, [], (provider) =>
					provider.cleanupStoppedRuntimes(),
				)),
			);
		}
		return removed;
	}

	async countRunningWorkspaces(): Promise<number> {
		let total = 0;
		for (const worker of this.readyWorkers()) {
			total += await this.perReadyWorker(worker, 0, (provider) =>
				provider.countRunningWorkspaces(),
			);
		}
		return total;
	}

	/** Fan-out targets: a still-booting worker has no reachable daemon yet. */
	private readyWorkers(): WorkerRow[] {
		return this.storage
			.listWorkers()
			.filter((worker) => worker.status === "ready");
	}

	/** One unreachable worker must not break fleet-wide stats or cleanup. */
	private async perReadyWorker<T>(
		worker: WorkerRow,
		fallback: T,
		action: (provider: LocalDockerRuntimeProvider) => Promise<T>,
	): Promise<T> {
		try {
			return await action(this.providerFor(worker.id));
		} catch (err) {
			log.warn("worker unreachable", {
				workerId: worker.id,
				err: err instanceof Error ? err : new Error(String(err)),
			});
			return fallback;
		}
	}
}
