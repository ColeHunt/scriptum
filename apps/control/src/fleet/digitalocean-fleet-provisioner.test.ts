import { describe, expect, test } from "bun:test";
import { DigitalOceanFleetProvisioner } from "./digitalocean-fleet-provisioner";

type FakeCall = { method: string; path: string; body: unknown };

/** Scripts a sequence of fake DO API responses, one per call, in order -
 * lets a test drive the create-then-poll-for-active sequence deterministically
 * without any real network access. */
function createFakeDoApi(responses: Array<{ status: number; body: unknown }>) {
	const calls: FakeCall[] = [];
	let index = 0;

	const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
		const response = responses[index];
		index += 1;
		if (!response) {
			throw new Error(`fake DO API: no scripted response for call ${index}`);
		}
		calls.push({
			method: String(init?.method ?? "GET"),
			path: String(url).replace("https://api.digitalocean.test", ""),
			body: init?.body ? JSON.parse(String(init.body)) : undefined,
		});
		return new Response(
			response.body === null ? null : JSON.stringify(response.body),
			{ status: response.status },
		);
	}) as unknown as typeof fetch;

	return { fetchImpl, calls };
}

const BASE_OPTIONS = {
	apiToken: "fake-token",
	region: "nyc3",
	sizeSlug: "s-4vcpu-8gb",
	imageId: "golden-snapshot-123",
	vpcUuid: "vpc-abc",
	sshKeyIds: ["key-1"],
	apiBaseUrl: "https://api.digitalocean.test",
	sleepImpl: async () => {}, // no real waiting in tests
	pollIntervalMs: 0,
};

describe("DigitalOceanFleetProvisioner.createWorker", () => {
	test("POSTs the expected droplet spec and polls until active with a private IP", async () => {
		const { fetchImpl, calls } = createFakeDoApi([
			{
				status: 202,
				body: { droplet: { id: 111, status: "new", networks: {} } },
			},
			{
				status: 200,
				body: {
					droplet: {
						id: 111,
						status: "new",
						networks: { v4: [] },
					},
				},
			},
			{
				status: 200,
				body: {
					droplet: {
						id: 111,
						status: "active",
						networks: {
							v4: [
								{ ip_address: "203.0.113.5", type: "public" },
								{ ip_address: "10.0.0.9", type: "private" },
							],
						},
					},
				},
			},
		]);

		const provisioner = new DigitalOceanFleetProvisioner({
			...BASE_OPTIONS,
			fetchImpl,
		});

		const worker = await provisioner.createWorker({ capacity: 4 });

		expect(worker).toEqual({ doDropletId: "111", privateIp: "10.0.0.9" });
		expect(calls.length).toBe(3);
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.path).toBe("/v2/droplets");
		expect(calls[0]?.body).toMatchObject({
			region: "nyc3",
			size: "s-4vcpu-8gb",
			image: "golden-snapshot-123",
			ssh_keys: ["key-1"],
			vpc_uuid: "vpc-abc",
			tags: ["coderunner-worker"],
		});
		expect(calls[1]?.method).toBe("GET");
		expect(calls[1]?.path).toBe("/v2/droplets/111");
		expect(calls[2]?.path).toBe("/v2/droplets/111");
	});

	test("gives up after the provision timeout if the droplet never becomes ready", async () => {
		const { fetchImpl } = createFakeDoApi([
			{
				status: 202,
				body: { droplet: { id: 222, status: "new", networks: {} } },
			},
			// Every poll after creation reports the same not-ready state - the
			// fake never runs out of responses since the loop should stop on
			// its own via the timeout, not by exhausting scripted calls.
			...Array.from({ length: 50 }, () => ({
				status: 200,
				body: { droplet: { id: 222, status: "new", networks: { v4: [] } } },
			})),
		]);

		const provisioner = new DigitalOceanFleetProvisioner({
			...BASE_OPTIONS,
			fetchImpl,
			provisionTimeoutMs: 0,
		});

		await expect(provisioner.createWorker({ capacity: 4 })).rejects.toThrow(
			/did not reach 'active'/,
		);
	});

	test("throws with the response body on an API error", async () => {
		const { fetchImpl } = createFakeDoApi([
			{
				status: 401,
				body: { id: "unauthorized", message: "Unable to authenticate you." },
			},
		]);

		const provisioner = new DigitalOceanFleetProvisioner({
			...BASE_OPTIONS,
			fetchImpl,
		});

		await expect(provisioner.createWorker({ capacity: 4 })).rejects.toThrow(
			/401/,
		);
	});
});

describe("DigitalOceanFleetProvisioner.destroyWorker", () => {
	test("sends a DELETE to the droplet's own path", async () => {
		const { fetchImpl, calls } = createFakeDoApi([{ status: 204, body: null }]);
		const provisioner = new DigitalOceanFleetProvisioner({
			...BASE_OPTIONS,
			fetchImpl,
		});

		await provisioner.destroyWorker("111");

		expect(calls).toEqual([
			{ method: "DELETE", path: "/v2/droplets/111", body: undefined },
		]);
	});

	test("throws on a failed destroy instead of silently succeeding", async () => {
		const { fetchImpl } = createFakeDoApi([
			{ status: 404, body: { id: "not_found", message: "not found" } },
		]);
		const provisioner = new DigitalOceanFleetProvisioner({
			...BASE_OPTIONS,
			fetchImpl,
		});

		await expect(provisioner.destroyWorker("does-not-exist")).rejects.toThrow(
			/404/,
		);
	});
});
