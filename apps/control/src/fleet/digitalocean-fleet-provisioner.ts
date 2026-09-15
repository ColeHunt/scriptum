import type { FleetProvisioner, ProvisionedWorker, WorkerSpec } from "./types";

/**
 * Real DigitalOcean implementation of FleetProvisioner - see
 * docs/decisions/048. Untested against a live DigitalOcean account (no
 * account/token has been wired up yet); the tests in
 * digitalocean-fleet-provisioner.test.ts exercise it against a fake `fetch`
 * standing in for DO's API v2, covering request shape, response parsing, and
 * the create-then-poll-for-a-private-IP sequence.
 */

type DigitalOceanNetwork = {
	ip_address: string;
	type: "public" | "private";
};

type DigitalOceanDroplet = {
	id: number;
	status: "new" | "active" | "off" | "archive";
	networks: {
		v4?: DigitalOceanNetwork[];
	};
};

type DigitalOceanDropletResponse = { droplet: DigitalOceanDroplet };

export type DigitalOceanFleetProvisionerOptions = {
	apiToken: string;
	region: string;
	/** Droplet size slug (e.g. "s-4vcpu-8gb"). Every worker is provisioned at
	 * this one fixed size - see decision 048, design point #3: the fleet
	 * relies on every worker being identical. This must match the
	 * `workerMemoryMb` given to FleetManagerOptions, so the capacity derived
	 * there (RAM / CODE_MEMORY_LIMIT) matches what actually gets built; kept
	 * as two separately-configured values rather than one derived from the
	 * other so a deploy can sanity-check them against each other explicitly. */
	sizeSlug: string;
	/** The pre-baked golden snapshot id (decision 048, design point #8), or a
	 * stock image slug (e.g. "ubuntu-24-04-x64") before one exists yet. */
	imageId: string | number;
	/** The private VPC every worker joins - decision 048, design point #6. */
	vpcUuid: string;
	/** DO-assigned SSH key ids/fingerprints to install on every new droplet,
	 * so the head can reach it without a manual key-copy step. */
	sshKeyIds: Array<string | number>;
	/** Rendered cloud-init user-data every new worker boots with - see
	 * deploy/digitalocean/worker-user-data.yaml.tmpl. Mounting the shared NFS
	 * storage is the only thing it needs to do (decision 048, design point
	 * #9: keep the per-boot path minimal, since the golden snapshot already
	 * has Docker installed and the workspace image pre-pulled). */
	userData: string;
	tags?: string[] | undefined;
	/** Override for tests (points at a fake server instead of the real API). */
	apiBaseUrl?: string | undefined;
	/** Override for tests, to avoid depending on the global fetch. */
	fetchImpl?: typeof fetch | undefined;
	/** Override for tests, to avoid real waiting. */
	sleepImpl?: ((ms: number) => Promise<void>) | undefined;
	/** How long to poll a newly created droplet for 'active' + a private IP
	 * before giving up. */
	provisionTimeoutMs?: number | undefined;
	pollIntervalMs?: number | undefined;
};

const DEFAULT_API_BASE_URL = "https://api.digitalocean.com";
const DEFAULT_PROVISION_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;

function randomNameSuffix(): string {
	return Math.random().toString(36).slice(2, 10);
}

export class DigitalOceanFleetProvisioner implements FleetProvisioner {
	private readonly apiBaseUrl: string;
	private readonly fetchImpl: typeof fetch;
	private readonly sleepImpl: (ms: number) => Promise<void>;

	constructor(private readonly options: DigitalOceanFleetProvisionerOptions) {
		this.apiBaseUrl = options.apiBaseUrl ?? DEFAULT_API_BASE_URL;
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.sleepImpl = options.sleepImpl ?? ((ms) => Bun.sleep(ms));
	}

	async createWorker(_spec: WorkerSpec): Promise<ProvisionedWorker> {
		const response = await this.request<DigitalOceanDropletResponse>(
			"POST",
			"/v2/droplets",
			{
				name: `coderunner-worker-${randomNameSuffix()}`,
				region: this.options.region,
				size: this.options.sizeSlug,
				image: this.options.imageId,
				ssh_keys: this.options.sshKeyIds,
				vpc_uuid: this.options.vpcUuid,
				user_data: this.options.userData,
				backups: false,
				ipv6: false,
				monitoring: true,
				tags: [...(this.options.tags ?? []), "coderunner-worker"],
			},
		);
		const dropletId = String(response.droplet.id);
		const privateIp = await this.waitForPrivateIp(dropletId);
		return { doDropletId: dropletId, privateIp };
	}

	async destroyWorker(doDropletId: string): Promise<void> {
		await this.request("DELETE", `/v2/droplets/${doDropletId}`);
	}

	private async waitForPrivateIp(dropletId: string): Promise<string> {
		const deadline =
			Date.now() +
			(this.options.provisionTimeoutMs ?? DEFAULT_PROVISION_TIMEOUT_MS);
		const pollIntervalMs =
			this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
		for (;;) {
			const response = await this.request<DigitalOceanDropletResponse>(
				"GET",
				`/v2/droplets/${dropletId}`,
			);
			const privateNetwork = response.droplet.networks.v4?.find(
				(network) => network.type === "private",
			);
			if (response.droplet.status === "active" && privateNetwork) {
				return privateNetwork.ip_address;
			}
			if (Date.now() >= deadline) {
				throw new Error(
					`Worker droplet ${dropletId} did not reach 'active' with a private IP within the timeout.`,
				);
			}
			await this.sleepImpl(pollIntervalMs);
		}
	}

	private async request<T = unknown>(
		method: string,
		path: string,
		body?: unknown,
	): Promise<T> {
		const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${this.options.apiToken}`,
				"Content-Type": "application/json",
			},
			...(body ? { body: JSON.stringify(body) } : {}),
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new Error(
				`DigitalOcean API ${method} ${path} failed: ${response.status} ${detail}`,
			);
		}
		if (response.status === 204) {
			return null as T;
		}
		return (await response.json()) as T;
	}
}
