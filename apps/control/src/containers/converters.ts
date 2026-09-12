import type { ContainerState } from "@frc-coderunner/contracts";
import type { WorkspaceRuntime } from "../runtime";
import type { ContainerLeaseRow, WorkspaceRow } from "../storage";
import {
	CHOREO_CONTAINER_PORT,
	type CodeContainerStatus,
	HALSIM_CONTAINER_PORT,
	type ManagedContainerStats,
	SIM_CONTAINER_PORT,
	VSCODE_CONTAINER_PORT,
} from "./types";

export function statusFromLease(
	image: string,
	containerNetwork: string | null,
	lease: ContainerLeaseRow | null,
	state: ContainerState,
	error: string | null = null,
): CodeContainerStatus {
	// In network mode there are no published host ports; "allocated" means the
	// container endpoint is resolvable (the container exists on the network).
	const networkReachable =
		containerNetwork !== null && (lease?.vscode_container ?? null) !== null;
	return {
		role: "code",
		state,
		image,
		containerName: lease?.vscode_container ?? null,
		simPortAllocated: networkReachable || (lease?.nt4_port ?? null) !== null,
		vscodePortAllocated:
			networkReachable || (lease?.vscode_port ?? null) !== null,
		halsimPortAllocated:
			networkReachable || (lease?.halsim_port ?? null) !== null,
		lastUsedAt: lease?.last_used_at ?? null,
		error,
	};
}

/**
 * Build upstream endpoints for a workspace container. Port mode (dev/host
 * deployments) targets the loopback ports published by `docker run -p`;
 * network mode (containerized control plane) targets the container by name on
 * the shared Docker network using the fixed internal ports.
 */
export function upstreamEndpoints(
	containerNetwork: string | null,
	workspace: WorkspaceRow,
	lease: ContainerLeaseRow | null,
): Pick<WorkspaceRuntime, "ports" | "endpoints"> {
	const basePath = `/u/${workspace.slug}/vscode/`;

	if (containerNetwork !== null) {
		const containerName = lease?.vscode_container ?? null;
		return {
			ports: { nt4: null, vscode: null, halsim: null, choreo: null },
			endpoints: {
				vscode:
					containerName === null
						? null
						: {
								httpBaseUrl: `http://${containerName}:${VSCODE_CONTAINER_PORT}`,
								wsBaseUrl: `ws://${containerName}:${VSCODE_CONTAINER_PORT}`,
								basePath,
							},
				nt4:
					containerName === null
						? null
						: {
								httpUrl: `http://${containerName}:${SIM_CONTAINER_PORT}/`,
								wsUrl: `ws://${containerName}:${SIM_CONTAINER_PORT}/nt/AdvantageScopeLite`,
							},
				halsim:
					containerName === null
						? null
						: {
								wsUrl: `ws://${containerName}:${HALSIM_CONTAINER_PORT}/wpilibws`,
							},
				choreo:
					containerName === null
						? null
						: {
								httpBaseUrl: `http://${containerName}:${CHOREO_CONTAINER_PORT}`,
								wsBaseUrl: `ws://${containerName}:${CHOREO_CONTAINER_PORT}`,
							},
			},
		};
	}

	const vscodePort = lease?.vscode_port ?? null;
	const nt4Port = lease?.nt4_port ?? null;
	const halsimPort = lease?.halsim_port ?? null;
	return {
		ports: {
			nt4: nt4Port,
			vscode: vscodePort,
			halsim: halsimPort,
			// Not leased in port mode yet - see docs/decisions/040-choreo-integration.md.
			choreo: null,
		},
		endpoints: {
			vscode:
				vscodePort === null
					? null
					: {
							httpBaseUrl: `http://127.0.0.1:${vscodePort}`,
							wsBaseUrl: `ws://127.0.0.1:${vscodePort}`,
							basePath,
						},
			nt4:
				nt4Port === null
					? null
					: {
							httpUrl: `http://127.0.0.1:${nt4Port}/`,
							wsUrl: `ws://127.0.0.1:${nt4Port}/nt/AdvantageScopeLite`,
						},
			halsim:
				halsimPort === null
					? null
					: {
							wsUrl: `ws://127.0.0.1:${halsimPort}/wpilibws`,
						},
			// Port mode has no choreo-server endpoint yet.
			choreo: null,
		},
	};
}

export function runtimeFromLease(
	image: string,
	containerNetwork: string | null,
	workspace: WorkspaceRow,
	lease: ContainerLeaseRow | null,
	state: ContainerState,
	error: string | null = null,
): WorkspaceRuntime {
	return {
		workspaceId: workspace.id,
		state,
		image,
		runtimeName: lease?.vscode_container ?? null,
		...upstreamEndpoints(containerNetwork, workspace, lease),
		lastUsedAt: lease?.last_used_at ?? null,
		error,
	};
}

export function parsePercent(value: string | undefined): number | null {
	if (!value) {
		return null;
	}
	const parsed = Number(value.replace("%", "").trim());
	return Number.isFinite(parsed) ? parsed : null;
}

export function parseDockerStatsLine(
	line: string,
): Partial<ManagedContainerStats> | null {
	try {
		const parsed = JSON.parse(line) as {
			Container?: string;
			ID?: string;
			Name?: string;
			CPUPerc?: string;
			MemUsage?: string;
			MemPerc?: string;
		};
		const [memoryUsage = null, memoryLimit = null] = (parsed.MemUsage ?? "")
			.split("/")
			.map((part) => part.trim());
		return {
			id: parsed.Container ?? parsed.ID ?? null,
			name: parsed.Name ?? "",
			cpuPercent: parsePercent(parsed.CPUPerc),
			memoryUsage,
			memoryLimit,
			memoryPercent: parsePercent(parsed.MemPerc),
		};
	} catch {
		return null;
	}
}
