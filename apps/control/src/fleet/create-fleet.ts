import type { AppStorage } from "../storage";
import { DigitalOceanFleetProvisioner } from "./digitalocean-fleet-provisioner";
import { type FleetConfig, parseMemoryMb } from "./fleet-config";
import { FleetManager } from "./fleet-manager";
import { FleetRuntimeProvider } from "./fleet-runtime-provider";
import {
	RemoteDockerRuntimeProvider,
	sshWorkerProviderOptions,
} from "./remote-docker-runtime-provider";
import { SshWorkerProbe } from "./ssh-worker-probe";
import { renderWorkerUserData } from "./worker-user-data";

/** Assemble the head's fleet-mode runtime from its settings. Not started. */
export function createFleetRuntime(
	storage: AppStorage,
	config: FleetConfig,
): FleetRuntimeProvider {
	const remote = new RemoteDockerRuntimeProvider(
		storage,
		sshWorkerProviderOptions(config.sshUser, config.blockDevices),
	);
	const provisioner = new DigitalOceanFleetProvisioner({
		apiToken: config.doApiToken,
		region: config.region,
		sizeSlug: config.sizeSlug,
		imageId: config.imageId,
		vpcUuid: config.vpcUuid,
		sshKeyIds: config.sshKeyIds,
		userData: renderWorkerUserData({
			nfsServerIp: config.nfsServerIp,
			sharedPath: config.sharedPath,
		}),
	});
	const manager = new FleetManager(
		storage,
		provisioner,
		new SshWorkerProbe({
			sshUser: config.sshUser,
			mountPoint: config.sharedPath,
		}),
		{
			workerMemoryMb: config.workerMemoryMb,
			codeMemoryLimitMb: parseMemoryMb(storage.config.codeMemoryLimit),
			maxWorkers: config.maxWorkers,
			idleGracePeriodMs: config.idleGraceMs,
			onWorkerRemoved: (workerId) => remote.forgetWorker(workerId),
		},
	);
	return new FleetRuntimeProvider(storage, manager, remote);
}
