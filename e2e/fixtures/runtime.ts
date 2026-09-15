/**
 * Helpers for seeding the MockWorkspaceRuntimeProvider exposed by the `app`
 * fixture. Centralizes the WorkspaceRuntime shape so specs don't repeat it.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkspaceId } from "@frc-scriptum/contracts";
import type { MockWorkspaceRuntimeProvider } from "../../apps/control/src/__tests__/helpers";
import type { FakeHalsimHandle, FakeVscodeHandle } from "./types";

/**
 * Drop a minimal file into a workspace's project dir so the session reports
 * `projectEmpty: false`. Workspaces now start empty (first-login seeding was
 * removed), and an empty workspace auto-opens the Switch Project picker. Specs
 * that drive the loaded-project shell call this to suppress that picker.
 */
export async function seedWorkspaceProject(projectPath: string): Promise<void> {
	await mkdir(projectPath, { recursive: true });
	await writeFile(join(projectPath, "build.gradle"), "// e2e seed\n", "utf8");
}

export function seedRuntimeRunning(opts: {
	runtime: MockWorkspaceRuntimeProvider;
	workspaceId: WorkspaceId;
	fakeVscode: FakeVscodeHandle;
	fakeHalsim: FakeHalsimHandle;
}): void {
	const { runtime, workspaceId, fakeVscode, fakeHalsim } = opts;
	runtime.setRuntime({
		workspaceId,
		state: "running",
		image: "coderunner-workspace",
		runtimeName: `frc-${workspaceId.slice(0, 8)}`,
		ports: { nt4: 8080, vscode: 8081, halsim: 8082 },
		endpoints: {
			vscode: {
				httpBaseUrl: fakeVscode.httpBaseUrl,
				wsBaseUrl: fakeVscode.wsBaseUrl,
				basePath: "/",
			},
			nt4: {
				httpUrl: `${fakeVscode.httpBaseUrl}/nt4`,
				wsUrl: `${fakeVscode.wsBaseUrl.replace(/^http/, "ws")}/nt4`,
			},
			halsim: { wsUrl: fakeHalsim.wsUrl },
		},
		lastUsedAt: new Date().toISOString(),
		error: null,
	});
}

export function seedRuntimeMissing(
	runtime: MockWorkspaceRuntimeProvider,
	workspaceId: WorkspaceId,
): void {
	runtime.setRuntime({
		workspaceId,
		state: "missing",
		image: "coderunner-workspace",
		runtimeName: null,
		ports: { nt4: null, vscode: null, halsim: null },
		endpoints: { vscode: null, nt4: null, halsim: null },
		lastUsedAt: null,
		error: null,
	});
}
