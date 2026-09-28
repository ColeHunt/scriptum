import type { ContainerState, WorkspaceId } from "@frc-scriptum/contracts";
import { getLogger } from "../logging";
import type {
	ExecOptions,
	ExecResult,
	ManagedWorkspaceRuntime,
	WorkspaceRuntime,
	WorkspaceRuntimeCommand,
	WorkspaceRuntimeProvider,
} from "../runtime";
import type { AppStorage } from "../storage";
import type { FleetManager } from "./fleet-manager";
import type { RemoteDockerRuntimeProvider } from "./remote-docker-runtime-provider";

const log = getLogger("fleet");

/** Shown to the student; the operator-facing cause is in the logs. */
const CREATE_FAILED_MESSAGE =
	"Couldn't start a workspace server. Retrying shortly.";

/**
 * The head's WorkspaceRuntimeProvider in fleet mode (decision 048). Places a
 * workspace on a worker the first time it's needed, reports "starting" -
 * without blocking - while that worker boots, and routes everything to the
 * worker once it's ready. Stopping a workspace releases its worker slot, so
 * an unused worker empties out and FleetManager destroys it.
 */
export class FleetRuntimeProvider implements WorkspaceRuntimeProvider {
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(
		private readonly storage: AppStorage,
		private readonly fleet: FleetManager,
		private readonly remote: RemoteDockerRuntimeProvider,
	) {}

	start(intervalMs = 10_000): void {
		if (this.timer) return;
		this.timer = setInterval(() => void this.maintain(), intervalMs);
		this.timer.unref?.();
		void this.maintain();
	}

	stop(): void {
		if (!this.timer) return;
		clearInterval(this.timer);
		this.timer = null;
	}

	async maintain(): Promise<void> {
		await this.releaseStalePlacements();
		await this.fleet.tick();
	}

	/**
	 * Release worker slots held by workspaces idle past IDLE_STOP_MINUTES.
	 * IdleManager only stops workspaces with a running container; this also
	 * catches ones that never got one (the student left while their worker
	 * booted) or whose container died, which would otherwise pin a worker
	 * - and its bill - forever.
	 */
	async releaseStalePlacements(nowMs: number = Date.now()): Promise<void> {
		const idleMinutes = this.storage.config.idleStopMinutes;
		const cutoff = new Date(nowMs - idleMinutes * 60_000).toISOString();
		for (const workspaceId of this.storage.listPlacedWorkspacesIdleSince(
			cutoff,
		)) {
			try {
				await this.stopWorkspace(workspaceId);
				log.info("released idle worker slot", { workspaceId });
			} catch (err) {
				log.warn("failed to release idle worker slot", {
					workspaceId,
					err: err instanceof Error ? err : new Error(String(err)),
				});
			}
		}
	}

	async ensureWorkspaceRunning(
		workspaceId: WorkspaceId,
	): Promise<WorkspaceRuntime> {
		const placement = this.fleet.placeWorkspace(workspaceId);
		if (placement.kind === "placed" && placement.ready) {
			return this.remote.ensureWorkspaceRunning(workspaceId);
		}
		if (placement.kind === "failed") {
			return this.idleRuntime(workspaceId, "starting", CREATE_FAILED_MESSAGE);
		}
		return this.idleRuntime(workspaceId, "starting");
	}

	async getWorkspaceStatus(
		workspaceId: WorkspaceId,
	): Promise<WorkspaceRuntime> {
		const placement = this.fleet.lookup(workspaceId);
		if (placement.kind === "placed" && placement.ready) {
			return this.remote.getWorkspaceStatus(workspaceId);
		}
		if (placement.kind === "unplaced") {
			return this.idleRuntime(workspaceId, "stopped");
		}
		return this.idleRuntime(workspaceId, "starting");
	}

	async stopWorkspace(workspaceId: WorkspaceId): Promise<void> {
		const placement = this.fleet.lookup(workspaceId);
		if (placement.kind === "placed" && placement.ready) {
			await this.remote.stopWorkspace(workspaceId);
		}
		this.fleet.unplaceWorkspace(workspaceId);
	}

	async restartWorkspace(workspaceId: WorkspaceId): Promise<WorkspaceRuntime> {
		const placement = this.fleet.lookup(workspaceId);
		if (placement.kind === "placed" && placement.ready) {
			return this.remote.restartWorkspace(workspaceId);
		}
		return this.ensureWorkspaceRunning(workspaceId);
	}

	async removeWorkspace(workspaceId: WorkspaceId): Promise<void> {
		const placement = this.fleet.lookup(workspaceId);
		if (placement.kind === "placed" && placement.ready) {
			await this.remote.removeWorkspace(workspaceId);
		}
		this.fleet.unplaceWorkspace(workspaceId);
	}

	async exec(
		workspaceId: WorkspaceId,
		command: string[],
		options?: ExecOptions,
	): Promise<ExecResult> {
		this.requireReady(workspaceId);
		return this.remote.exec(workspaceId, command, options);
	}

	execStream(
		workspaceId: WorkspaceId,
		command: string[],
		options?: ExecOptions,
	): WorkspaceRuntimeCommand {
		this.requireReady(workspaceId);
		return this.remote.execStream(workspaceId, command, options);
	}

	listRuntimes(): Promise<ManagedWorkspaceRuntime[]> {
		return this.remote.listRuntimes();
	}

	cleanupStoppedRuntimes(): Promise<string[]> {
		return this.remote.cleanupStoppedRuntimes();
	}

	countRunningWorkspaces(): Promise<number> {
		return this.remote.countRunningWorkspaces();
	}

	private requireReady(workspaceId: WorkspaceId): void {
		const placement = this.fleet.lookup(workspaceId);
		if (placement.kind !== "placed" || !placement.ready) {
			throw new Error("Workspace is not running.");
		}
	}

	/** A runtime with no reachable endpoints: still booting, or not placed.
	 * Callers read "not running, no error" as "starting". */
	private idleRuntime(
		workspaceId: WorkspaceId,
		state: ContainerState,
		error: string | null = null,
	): WorkspaceRuntime {
		const lease = this.storage.getContainerLease(workspaceId);
		return {
			workspaceId,
			state,
			image: this.storage.config.codeImage,
			runtimeName: null,
			ports: { nt4: null, vscode: null, halsim: null, choreo: null },
			endpoints: { vscode: null, nt4: null, halsim: null, choreo: null },
			lastUsedAt: lease?.last_used_at ?? null,
			error,
		};
	}
}
