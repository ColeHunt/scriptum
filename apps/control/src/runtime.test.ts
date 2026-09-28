import { describe, expect, test } from "bun:test";
import type { WorkspaceId } from "@frc-scriptum/contracts";
import {
	type WorkspaceRuntime,
	type WorkspaceRuntimeProvider,
	waitForWorkspaceRunning,
} from "./runtime";

const ID = "ws_test" as WorkspaceId;

function runtime(
	state: WorkspaceRuntime["state"],
	error: string | null = null,
): WorkspaceRuntime {
	return {
		workspaceId: ID,
		state,
		image: "img",
		runtimeName: null,
		ports: { nt4: null, vscode: null, halsim: null, choreo: null },
		endpoints: { vscode: null, nt4: null, halsim: null, choreo: null },
		lastUsedAt: null,
		error,
	};
}

function providerReturning(...states: WorkspaceRuntime[]) {
	let calls = 0;
	const provider = {
		async ensureWorkspaceRunning() {
			const next = states[Math.min(calls, states.length - 1)];
			calls += 1;
			return next as WorkspaceRuntime;
		},
	} as unknown as WorkspaceRuntimeProvider;
	return { provider, calls: () => calls };
}

describe("waitForWorkspaceRunning", () => {
	test("returns immediately when already running (local Docker)", async () => {
		const { provider, calls } = providerReturning(runtime("running"));
		let starting = 0;
		const result = await waitForWorkspaceRunning(provider, ID, {
			onStarting: () => starting++,
			sleep: async () => {},
		});
		expect(result.state).toBe("running");
		expect(calls()).toBe(1);
		expect(starting).toBe(0);
	});

	test("waits through 'starting' (a booting worker) and reports it once", async () => {
		const { provider, calls } = providerReturning(
			runtime("starting"),
			runtime("starting"),
			runtime("running"),
		);
		let starting = 0;
		const result = await waitForWorkspaceRunning(provider, ID, {
			onStarting: () => starting++,
			sleep: async () => {},
		});
		expect(result.state).toBe("running");
		expect(calls()).toBe(3);
		expect(starting).toBe(1);
	});

	test("stops waiting on an error instead of spinning", async () => {
		const { provider } = providerReturning(
			runtime("starting"),
			runtime("starting", "Couldn't start a workspace server."),
		);
		const result = await waitForWorkspaceRunning(provider, ID, {
			sleep: async () => {},
		});
		expect(result.error).toContain("Couldn't start");
	});

	test("gives up at the timeout with the last runtime", async () => {
		const { provider } = providerReturning(runtime("starting"));
		const result = await waitForWorkspaceRunning(provider, ID, {
			timeoutMs: 0,
			sleep: async () => {},
		});
		expect(result.state).toBe("starting");
	});
});
