import type { WorkspaceId } from "@frc-fabrica/contracts";
import { getLogger } from "../logging";
import type { AppStorage } from "../storage";
import { parseDockerStatsLine } from "./converters";
import {
	inspectContainer,
	inspectContainers,
	runDocker,
} from "./docker-client";
import {
	codeContainerName,
	codeVolumeName,
	containerRuntimeState,
} from "./metadata";
import type { DockerRunner, ManagedContainerStats } from "./types";

const log = getLogger("containers");

export async function stopCodeContainer(
	storage: AppStorage,
	dockerRunner: DockerRunner,
	workspaceId: WorkspaceId,
): Promise<void> {
	const name = codeContainerName(workspaceId);
	const existing = await inspectContainer(dockerRunner, name);
	if (existing?.State?.Running) {
		log.info("stopping container", { workspaceId, name });
		await runDocker(dockerRunner, ["stop", name], true);
	} else {
		log.debug("stopCodeContainer: not running", { workspaceId, name });
	}
	const lease = storage.getContainerLease(workspaceId);
	if (lease) {
		storage.upsertCodeContainerLease({
			workspaceId,
			containerName: name,
			simPort: lease.nt4_port,
			vscodePort: lease.vscode_port,
			halsimPort: lease.halsim_port,
			state: "stopped",
		});
	}
}

export async function stopWorkspaceSim(
	dockerRunner: DockerRunner,
	workspaceId: WorkspaceId,
): Promise<boolean> {
	const name = codeContainerName(workspaceId);
	const existing = await inspectContainer(dockerRunner, name);
	if (!existing?.State?.Running) {
		return false;
	}

	const result = await runDocker(
		dockerRunner,
		["exec", name, "/usr/local/bin/stop-sim.sh"],
		true,
	);
	return result.exitCode === 0;
}

export async function removeCodeContainer(
	storage: AppStorage,
	dockerRunner: DockerRunner,
	workspaceId: WorkspaceId,
): Promise<void> {
	const name = codeContainerName(workspaceId);
	log.info("removing container", { workspaceId, name });
	await runDocker(dockerRunner, ["rm", "-f", name], true);
	const lease = storage.getContainerLease(workspaceId);
	if (lease) {
		storage.upsertCodeContainerLease({
			workspaceId,
			containerName: name,
			simPort: null,
			vscodePort: null,
			halsimPort: null,
			state: "missing",
		});
	}
}

/**
 * Delete the demo-mode `/config` volume for a workspace. For workspace DELETION
 * only — container recycling (restart, rebuild, cleanup) must keep the volume so
 * the next start reuses the seeded caches. A no-op when the volume is absent.
 */
export async function removeCodeVolume(
	dockerRunner: DockerRunner,
	workspaceId: WorkspaceId,
): Promise<void> {
	const volume = codeVolumeName(workspaceId);
	const result = await runDocker(dockerRunner, ["volume", "rm", volume], true);
	if (result.exitCode === 0) {
		log.info("removed config volume", { workspaceId, volume });
		return;
	}
	// "no such volume" is the documented no-op. Anything else (usually the
	// container not having fully released it) leaves an orphan no other path
	// reaps, so it must not be silent.
	const stderr = result.stderr.trim();
	if (!/no such volume/i.test(stderr)) {
		log.warn("failed to remove config volume", { workspaceId, volume, stderr });
	}
}

export async function stopWorkspaceContainers(
	storage: AppStorage,
	dockerRunner: DockerRunner,
	workspaceId: WorkspaceId,
): Promise<void> {
	await stopCodeContainer(storage, dockerRunner, workspaceId);
}

export async function countRunningContainers(
	dockerRunner: DockerRunner,
): Promise<number> {
	const result = await runDocker(
		dockerRunner,
		[
			"container",
			"ls",
			"--filter",
			"label=frc-sim.managed=true",
			"--filter",
			"label=frc-sim.version=v2",
			"--filter",
			"status=running",
			"--format",
			"{{.Names}}",
		],
		true,
	);
	if (result.exitCode !== 0 || !result.stdout.trim()) {
		return 0;
	}
	return result.stdout
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean).length;
}

export async function cleanupStoppedContainers(
	dockerRunner: DockerRunner,
): Promise<string[]> {
	const result = await runDocker(
		dockerRunner,
		[
			"container",
			"ls",
			"-a",
			"--filter",
			"label=frc-sim.managed=true",
			"--filter",
			"status=exited",
			"--format",
			"{{.Names}}",
		],
		true,
	);
	if (result.exitCode !== 0) {
		return [];
	}

	const names = result.stdout
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);

	const removed: string[] = [];
	for (const name of names) {
		const removeResult = await runDocker(dockerRunner, ["rm", name], true);
		if (removeResult.exitCode === 0) {
			removed.push(name);
		} else {
			log.warn("failed to remove stopped container", {
				name,
				exitCode: removeResult.exitCode,
			});
		}
	}
	if (removed.length > 0) {
		log.info("cleaned up stopped containers", { count: removed.length });
	}
	return removed;
}

export async function managedContainerStats(
	dockerRunner: DockerRunner,
): Promise<ManagedContainerStats[]> {
	const list = await runDocker(
		dockerRunner,
		[
			"container",
			"ls",
			"-a",
			"--filter",
			"label=frc-sim.managed=true",
			"--format",
			"{{.Names}}",
		],
		true,
	);
	if (list.exitCode !== 0 || !list.stdout.trim()) {
		return [];
	}

	const names = list.stdout
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
	if (names.length === 0) {
		return [];
	}

	const statsByName = new Map<string, Partial<ManagedContainerStats>>();
	const stats = await runDocker(
		dockerRunner,
		["stats", "--no-stream", "--format", "{{json .}}", ...names],
		true,
	);
	if (stats.exitCode === 0) {
		for (const line of stats.stdout.split(/\r?\n/u)) {
			const parsed = parseDockerStatsLine(line.trim());
			if (parsed?.name) {
				statsByName.set(parsed.name, parsed);
			}
		}
	}

	const inspectedByName = await inspectContainers(dockerRunner, names);

	const output: ManagedContainerStats[] = [];
	for (const name of names) {
		const inspected = inspectedByName.get(name) ?? null;
		const labels = inspected?.Config?.Labels ?? {};
		const runtime = inspected ? containerRuntimeState(inspected) : null;
		const stat = statsByName.get(name);
		output.push({
			name,
			id: stat?.id ?? null,
			workspaceId: labels["frc-sim.workspace"] ?? null,
			role: labels["frc-sim.role"] ?? null,
			state: runtime,
			cpuPercent: stat?.cpuPercent ?? null,
			memoryUsage: stat?.memoryUsage ?? null,
			memoryLimit: stat?.memoryLimit ?? null,
			memoryPercent: stat?.memoryPercent ?? null,
		});
	}
	return output;
}
