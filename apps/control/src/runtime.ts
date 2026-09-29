import type { ContainerState, WorkspaceId } from "@frc-scriptum/contracts";

export type ExecResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

export type ExecOptions = {
	timeoutMs?: number | undefined;
	/** Run as this container user instead of the default (root). */
	user?: string | undefined;
	/** Run with this working directory instead of the container's default. */
	workdir?: string | undefined;
	env?: Record<string, string> | undefined;
};

export type WorkspaceRuntimeExit = {
	code: number | null;
	signal: string | null;
};

export type WorkspaceRuntimeCommand = {
	stdout: ReadableStream<Uint8Array> | null;
	stderr: ReadableStream<Uint8Array> | null;
	exited: Promise<WorkspaceRuntimeExit>;
	kill(signal?: string): void;
};

export type WorkspaceRuntime = {
	workspaceId: WorkspaceId;
	state: ContainerState;
	image: string;
	runtimeName: string | null;
	ports: {
		nt4: number | null;
		vscode: number | null;
		halsim: number | null;
		choreo: number | null;
	};
	endpoints: {
		vscode: {
			httpBaseUrl: string;
			wsBaseUrl: string;
			basePath: string;
		} | null;
		nt4: {
			httpUrl: string;
			wsUrl: string;
		} | null;
		halsim: {
			wsUrl: string;
		} | null;
		choreo: {
			httpBaseUrl: string;
			wsBaseUrl: string;
		} | null;
	};
	lastUsedAt: string | null;
	error: string | null;
};

export type ManagedWorkspaceRuntime = {
	name: string;
	id: string | null;
	workspaceId: string | null;
	role: string | null;
	state: string | null;
	cpuPercent: number | null;
	memoryUsage: string | null;
	memoryLimit: string | null;
	memoryPercent: number | null;
};

export interface WorkspaceRuntimeProvider {
	ensureWorkspaceRunning(workspaceId: WorkspaceId): Promise<WorkspaceRuntime>;
	stopWorkspace(workspaceId: WorkspaceId): Promise<void>;
	restartWorkspace(workspaceId: WorkspaceId): Promise<WorkspaceRuntime>;
	removeWorkspace(workspaceId: WorkspaceId): Promise<void>;
	getWorkspaceStatus(workspaceId: WorkspaceId): Promise<WorkspaceRuntime>;
	exec(
		workspaceId: WorkspaceId,
		command: string[],
		options?: ExecOptions,
	): Promise<ExecResult>;
	execStream(
		workspaceId: WorkspaceId,
		command: string[],
		options?: ExecOptions,
	): WorkspaceRuntimeCommand;
	listRuntimes(): Promise<ManagedWorkspaceRuntime[]>;
	cleanupStoppedRuntimes(): Promise<string[]>;
	countRunningWorkspaces(): Promise<number>;
}

export type WaitForRunningOptions = {
	timeoutMs?: number | undefined;
	pollMs?: number | undefined;
	/** Called once, the first time the workspace is found still starting. */
	onStarting?: (() => void) | undefined;
	sleep?: ((ms: number) => Promise<void>) | undefined;
};

/**
 * ensureWorkspaceRunning, but waits while the workspace is starting. A local
 * Docker daemon starts the container inside the first call; a fleet head
 * (decision 048) answers "starting" at once while a worker droplet boots,
 * which can take a couple of minutes. Returns the first running or failed
 * runtime, or the last one seen at the timeout; callers check `state`.
 */
export async function waitForWorkspaceRunning(
	provider: WorkspaceRuntimeProvider,
	workspaceId: WorkspaceId,
	options: WaitForRunningOptions = {},
): Promise<WorkspaceRuntime> {
	const deadline = Date.now() + (options.timeoutMs ?? 6 * 60_000);
	const pollMs = options.pollMs ?? 3_000;
	const sleep =
		options.sleep ??
		((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
	let notified = false;
	for (;;) {
		const runtime = await provider.ensureWorkspaceRunning(workspaceId);
		if (runtime.state === "running" || runtime.error !== null) {
			return runtime;
		}
		if (Date.now() >= deadline) {
			return runtime;
		}
		if (!notified) {
			notified = true;
			options.onStarting?.();
		}
		await sleep(pollMs);
	}
}
