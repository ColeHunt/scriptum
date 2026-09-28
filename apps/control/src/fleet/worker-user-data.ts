import { WORKER_READY_MARKER } from "./ssh-worker-probe";

export type WorkerUserDataParams = {
	/** The head's private IP - it serves the NFS export (setup-head-nfs.sh). */
	nfsServerIp: string;
	/** Exported by the head and mounted by the worker at the same path, so
	 * every host path the head computes for a bind mount is valid on the
	 * worker too (decision 048, design point #3). */
	sharedPath: string;
};

const SAFE_PATH = /^\/[A-Za-z0-9._/-]+$/;
const SAFE_IP = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Cloud-init for every new worker droplet. Deliberately minimal: Docker, the
 * NFS client, and the workspace image are baked into the golden snapshot
 * (bake-golden-image.sh), so first boot only mounts the head's student-data
 * export and then drops the marker SshWorkerProbe waits for. Every extra
 * step here is a step that can flake on every scale-up.
 */
export function renderWorkerUserData(params: WorkerUserDataParams): string {
	if (!SAFE_IP.test(params.nfsServerIp)) {
		throw new Error(`Invalid NFS server IP: ${params.nfsServerIp}`);
	}
	if (!SAFE_PATH.test(params.sharedPath)) {
		throw new Error(`Invalid shared path: ${params.sharedPath}`);
	}
	const path = params.sharedPath;
	return `#cloud-config
runcmd:
  - mkdir -p ${path}
  - grep -q " ${path} " /etc/fstab || echo "${params.nfsServerIp}:${path} ${path} nfs4 _netdev,noatime,hard 0 0" >> /etc/fstab
  - mount ${path} && touch ${WORKER_READY_MARKER}
`;
}
