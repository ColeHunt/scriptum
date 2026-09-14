import { dirname, resolve } from "node:path";
import type { ContainerState, WorkspaceId } from "@frc-coderunner/contracts";
import type { WorkspaceRow } from "../storage";
import {
	CODE_NAME_PREFIX,
	type DockerInspectContainer,
	type PublishedPort,
} from "./types";

export function codeContainerName(workspaceId: WorkspaceId): string {
	return `${CODE_NAME_PREFIX}${workspaceId.replace(/^ws_/, "")}`;
}

/** Named volume backing `/config` in demo mode. */
export function codeVolumeName(workspaceId: WorkspaceId): string {
	return `${codeContainerName(workspaceId)}-config`;
}

export function workspaceHomePath(workspace: WorkspaceRow): string {
	return resolve(dirname(workspace.project_path), "home");
}

/** Host dir bind-mounted at `/workspace/.scope-state` - a sibling of
 * `project`, not inside it, so it survives a module-swap wipe. Holds only a
 * captured snapshot of the AdvantageScope Lite iframe's UI state, written
 * directly by the control plane's own host-fs access (see
 * `CheckpointManager.verify`) for layout checkpoint scripts to read. */
export function workspaceScopeStatePath(workspace: WorkspaceRow): string {
	return resolve(dirname(workspace.project_path), "scope-state");
}

export function isLoopbackHost(hostIp: string): boolean {
	return (
		hostIp === "127.0.0.1" ||
		hostIp === "::1" ||
		hostIp.toLowerCase() === "localhost"
	);
}

export function publishedPortFor(
	container: DockerInspectContainer,
	port: number,
): PublishedPort | null {
	const bindings = container.NetworkSettings?.Ports?.[`${port}/tcp`];
	const binding = Array.isArray(bindings) ? bindings[0] : null;
	const hostPort = Number(binding?.HostPort);
	if (
		!binding ||
		!Number.isInteger(hostPort) ||
		hostPort < 1 ||
		hostPort > 65535
	) {
		return null;
	}

	const hostIp = binding.HostIp ?? "";
	return {
		port: hostPort,
		hostIp,
		loopback: isLoopbackHost(hostIp),
	};
}

export function containerAttachedToNetwork(
	container: DockerInspectContainer,
	networkName: string,
): boolean {
	return Boolean(container.NetworkSettings?.Networks?.[networkName]);
}

export function containerHasPublishedPorts(
	container: DockerInspectContainer,
): boolean {
	const ports = container.NetworkSettings?.Ports ?? {};
	return Object.values(ports).some(
		(bindings) => Array.isArray(bindings) && bindings.length > 0,
	);
}

/**
 * Type of the container's `/config` mount (`"bind"` or `"volume"`), or null when
 * the inspect output carries no mount for it.
 */
export function configMountType(
	container: DockerInspectContainer,
): string | null {
	const mount = container.Mounts?.find(
		(entry) => entry.Destination === "/config",
	);
	return mount?.Type ?? null;
}

export function containerRuntimeState(
	container: DockerInspectContainer,
): ContainerState {
	if (container.State?.Running) {
		return "running";
	}
	return "stopped";
}

export function v2LabelsMatch(
	container: DockerInspectContainer,
	workspaceId: WorkspaceId,
): boolean {
	const labels = container.Config?.Labels ?? {};
	return (
		labels["frc-sim.managed"] === "true" &&
		labels["frc-sim.version"] === "v2" &&
		labels["frc-sim.role"] === "code" &&
		labels["frc-sim.workspace"] === workspaceId
	);
}
