import type { ContainerState } from "@frc-scriptum/contracts";
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

/** Where port-mode containers publish their ports on a local daemon. */
export const LOOPBACK_PUBLISH_HOST = "127.0.0.1";

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
 * deployments) targets the ports published by `docker run -p` on
 * `publishHost` - loopback for a local daemon, a worker's private IP for a
 * fleet worker (decision 048); network mode (containerized control plane)
 * targets the container by name on the shared Docker network using the fixed
 * internal ports.
 */
export function upstreamEndpoints(
	containerNetwork: string | null,
	workspace: WorkspaceRow,
	lease: ContainerLeaseRow | null,
	publishHost: string = LOOPBACK_PUBLISH_HOST,
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
			// Not leased in port mode yet - see docs/decisions/042-choreo-integration.md.
			choreo: null,
		},
		endpoints: {
			vscode:
				vscodePort === null
					? null
					: {
							httpBaseUrl: `http://${publishHost}:${vscodePort}`,
							wsBaseUrl: `ws://${publishHost}:${vscodePort}`,
							basePath,
						},
			nt4:
				nt4Port === null
					? null
					: {
							httpUrl: `http://${publishHost}:${nt4Port}/`,
							wsUrl: `ws://${publishHost}:${nt4Port}/nt/AdvantageScopeLite`,
						},
			halsim:
				halsimPort === null
					? null
					: {
							wsUrl: `ws://${publishHost}:${halsimPort}/wpilibws`,
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
	publishHost: string = LOOPBACK_PUBLISH_HOST,
): WorkspaceRuntime {
	return {
		workspaceId: workspace.id,
		state,
		image,
		runtimeName: lease?.vscode_container ?? null,
		...upstreamEndpoints(containerNetwork, workspace, lease, publishHost),
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
