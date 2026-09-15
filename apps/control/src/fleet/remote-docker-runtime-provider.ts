import type { WorkspaceId } from "@frc-coderunner/contracts";
import { runDockerCli } from "../containers/docker-client";
import { LocalDockerRuntimeProvider } from "../containers/local-docker-runtime-provider";
import type { DockerRunner } from "../containers/types";
import type {
	ExecOptions,
	ExecResult,
	ManagedWorkspaceRuntime,
	WorkspaceRuntime,
	WorkspaceRuntimeCommand,
	WorkspaceRuntimeProvider,
} from "../runtime";
import type { AppStorage, WorkerRow } from "../storage";

export type WorkerDockerRunnerFactory = (worker: WorkerRow) => DockerRunner;

/**
 * Default worker DockerRunner factory: routes `docker` CLI calls to a
 * worker's own daemon over SSH (`DOCKER_HOST=ssh://user@worker-private-ip`),
 * reusing the exact subprocess-spawning path (`runDockerCli`) every other
 * Docker call in this app already goes through. No TLS/cert infrastructure
 * needed - decision 048, design point #2. SSH host-key trust for freshly
 * created workers is a deploy-time concern (decision 048's "SSH host-key
 * churn" note), not something this factory handles.
 */
export function sshDockerRunnerFactory(
	dockerPath: string,
	sshUser: string,
): WorkerDockerRunnerFactory {
	return (worker: WorkerRow): DockerRunner =>
		(args: string[]) =>
			runDockerCli(
				dockerPath,
				args,
				{},
				{
					DOCKER_HOST: `ssh://${sshUser}@${worker.private_ip}`,
				},
			);
}

/**
 * Fleet-aware WorkspaceRuntimeProvider for the "centralized head" deployment
 * model (docs/decisions/048): routes each call to whichever worker droplet
 * currently owns the workspace, by constructing one LocalDockerRuntimeProvider
 * per worker (each with that worker's own DockerRunner) and delegating to it,
 * rather than reimplementing Docker CLI command construction for a remote
 * daemon.
 *
 * Two invariants this relies on (decision 048, design point #3):
 *  1. Every worker is provisioned identically from the same golden image, so
 *     `storage.config`'s network/host-data-dir/disk-limit settings are valid
 *     fleet-wide constants shared by every per-worker provider instance -
 *     only the DOCKER_HOST target varies per worker.
 *  2. The head process itself mounts the same shared network filesystem at
 *     the same path workers do, so a LocalDockerRuntimeProvider instance's
 *     own host-filesystem calls (mkdir/chmod for workspace homes, block
 *     device detection) - which always run on *this* process, never on the
 *     worker - land on the storage every worker also sees.
 *
 * This class does not decide *which* worker an unplaced workspace should
 * land on - that's scheduler.ts's selectWorkerForPlacement, run by the
 * fleet-manager service before a workspace's first ensureWorkspaceRunning
 * call. This class only executes against whichever worker is already
 * recorded in storage (via setWorkspaceWorker).
 */
export class RemoteDockerRuntimeProvider implements WorkspaceRuntimeProvider {
	private readonly perWorker = new Map<string, LocalDockerRuntimeProvider>();

	constructor(
		private readonly storage: AppStorage,
		private readonly dockerRunnerFor: WorkerDockerRunnerFactory,
	) {}

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
		const provider = new LocalDockerRuntimeProvider(this.storage, {
			dockerRunner: this.dockerRunnerFor(worker),
		});
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
		for (const worker of this.storage.listWorkers()) {
			results.push(...(await this.providerFor(worker.id).listRuntimes()));
		}
		return results;
	}

	async cleanupStoppedRuntimes(): Promise<string[]> {
		const removed: string[] = [];
		for (const worker of this.storage.listWorkers()) {
			removed.push(
				...(await this.providerFor(worker.id).cleanupStoppedRuntimes()),
			);
		}
		return removed;
	}

	async countRunningWorkspaces(): Promise<number> {
		let total = 0;
		for (const worker of this.storage.listWorkers()) {
			total += await this.providerFor(worker.id).countRunningWorkspaces();
		}
		return total;
	}
}
