import { expect } from "bun:test";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceId } from "@frc-fabrica/contracts";
import { type ControlApp, type ControlAppOptions, createApp } from "../app";
import { getSessionFromRequest } from "../auth/middleware";
import type { DockerCommandResult, DockerRunner } from "../containers";
import type { LegionSsoClaims } from "../legion/sso";
import { signLegionToken } from "../legion/sso";
import type { RunCommandFactory } from "../runs";
import type {
	ExecOptions,
	ExecResult,
	ManagedWorkspaceRuntime,
	WorkspaceRuntime,
	WorkspaceRuntimeCommand,
	WorkspaceRuntimeProvider,
} from "../runtime";
import type { WorkspaceRow } from "../storage";

export async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Build a bundled-catalog fixture: a `catalog/` dir with a `modules.json`
 * manifest plus one `plain-java` and one `robot` module subdir. Returned path
 * is wired into the test `ControlApp` as `catalogDir`.
 */
export async function createCatalogDir(root: string): Promise<string> {
	const catalogDir = join(root, "catalog");

	// hello-world (plain-java)
	const helloDir = join(catalogDir, "modules", "hello-world");
	await mkdir(join(helloDir, "src"), { recursive: true });
	await mkdir(join(helloDir, ".vscode"), { recursive: true });
	await writeFile(
		join(helloDir, "src", "Main.java"),
		"public class Main {\n  public static void main(String[] a) {}\n}\n",
		"utf8",
	);
	await writeFile(join(helloDir, "README.md"), "# Hello, World\n", "utf8");
	await writeFile(
		join(helloDir, ".vscode", "launch.json"),
		'{ "version": "0.2.0", "configurations": [] }\n',
		"utf8",
	);

	// robot-starter (robot)
	const robotDir = join(catalogDir, "modules", "robot-starter");
	await mkdir(join(robotDir, "src", "main", "java", "frc", "robot"), {
		recursive: true,
	});
	await writeFile(join(robotDir, "build.gradle"), "plugins {}\n", "utf8");
	await writeFile(
		join(robotDir, "src", "main", "java", "frc", "robot", "Robot.java"),
		"package frc.robot;\n",
		"utf8",
	);
	await writeFile(join(robotDir, "README.md"), "# Robot Starter\n", "utf8");

	// checkpoint-demo (git) - a minimal module carrying two checkpoints, for
	// exercising the Checkpoints UI/API end to end. The MockWorkspaceRuntimeProvider
	// never actually runs these scripts, but real ones ship anyway so the
	// module is a faithful (if tiny) stand-in for catalog/modules/git-basics.
	const checkpointDir = join(catalogDir, "modules", "checkpoint-demo");
	const checkpointScriptsDir = join(
		catalogDir,
		"checkpoints",
		"checkpoint-demo",
		"verify",
	);
	await mkdir(checkpointDir, { recursive: true });
	await mkdir(checkpointScriptsDir, { recursive: true });
	await writeFile(
		join(checkpointDir, "README.md"),
		"# Checkpoint Demo\n",
		"utf8",
	);
	await writeFile(
		join(checkpointScriptsDir, "first-commit.sh"),
		"#!/usr/bin/env bash\nexit 0\n",
		"utf8",
	);
	await writeFile(
		join(checkpointScriptsDir, "rebase.sh"),
		"#!/usr/bin/env bash\nexit 1\n",
		"utf8",
	);
	await writeFile(
		join(catalogDir, "checkpoints", "checkpoint-demo", "setup.sh"),
		"#!/usr/bin/env bash\nexit 0\n",
		"utf8",
	);

	await writeFile(
		join(catalogDir, "modules.json"),
		JSON.stringify(
			{
				schemaVersion: 1,
				modules: [
					{
						id: "hello-world",
						title: "Hello, World",
						description: "Variables and stdin.",
						subdir: "modules/hello-world",
						kind: "plain-java",
						order: 10,
					},
					{
						id: "robot-starter",
						title: "Robot Starter",
						description: "A starter robot project.",
						subdir: "modules/robot-starter",
						kind: "robot",
						order: 20,
					},
					{
						id: "checkpoint-demo",
						title: "Checkpoint Demo",
						description: "A tiny git lesson with two checkpoints.",
						subdir: "modules/checkpoint-demo",
						kind: "git",
						order: 30,
						setupScript: "checkpoints/checkpoint-demo/setup.sh",
						checkpoints: [
							{
								id: "first-commit",
								title: "First commit",
								description: "Always passes.",
								verifier: {
									type: "script",
									path: "checkpoints/checkpoint-demo/verify/first-commit.sh",
								},
							},
							{
								id: "rebase",
								title: "Rebase",
								description: "Always fails.",
								verifier: {
									type: "script",
									path: "checkpoints/checkpoint-demo/verify/rebase.sh",
								},
							},
						],
					},
					{
						id: "locked-followup",
						title: "Locked Followup",
						description: "Requires checkpoint-demo to be fully complete first.",
						subdir: "modules/hello-world",
						kind: "plain-java",
						order: 40,
						requires: ["checkpoint-demo"],
					},
				],
			},
			null,
			2,
		),
		"utf8",
	);

	return catalogDir;
}

export async function createWebDist(root: string): Promise<string> {
	const webDistDir = join(root, "web-dist");
	await mkdir(join(webDistDir, "assets"), { recursive: true });
	await writeFile(
		join(webDistDir, "index.html"),
		'<!doctype html><html><head><script type="module" src="./assets/app.js"></script></head><body>V2 test shell</body></html>',
		"utf8",
	);
	await writeFile(
		join(webDistDir, "assets", "app.js"),
		"console.log('v2 shell');\n",
		"utf8",
	);
	await writeFile(
		join(webDistDir, "coderunner-icon.png"),
		"fake png\n",
		"utf8",
	);
	return webDistDir;
}

export async function createAdvantageScopeDist(root: string): Promise<string> {
	const ascopeDistDir = join(root, "ascope-dist");
	await mkdir(join(ascopeDistDir, "bundles"), { recursive: true });
	await mkdir(join(ascopeDistDir, "bundledAssets", "Robot_Test"), {
		recursive: true,
	});
	await mkdir(join(ascopeDistDir, "www", "textures"), { recursive: true });
	await writeFile(
		join(ascopeDistDir, "index.html"),
		'<!doctype html><html><head><script type="module" src="bundles/main.js"></script></head><body>AS Lite</body></html>',
		"utf8",
	);
	await writeFile(
		join(ascopeDistDir, "bundles", "main.js"),
		"console.log('ascope main');\n",
		"utf8",
	);
	await writeFile(
		join(ascopeDistDir, "bundles", "hub.js"),
		"console.log('ascope hub');\n",
		"utf8",
	);
	await writeFile(
		join(ascopeDistDir, "bundledAssets", "Robot_Test", "config.json"),
		'{"name":"Robot_Test"}\n',
		"utf8",
	);
	await writeFile(
		join(ascopeDistDir, "www", "textures", "example.png"),
		"fake png\n",
		"utf8",
	);
	return ascopeDistDir;
}

export async function createChoreoDist(root: string): Promise<string> {
	const choreoDistDir = join(root, "choreo-dist");
	await mkdir(choreoDistDir, { recursive: true });
	await writeFile(
		join(choreoDistDir, "index.html"),
		'<!doctype html><html><head><base href="/choreo/"><script src="main.js" defer></script></head><body data-fake-choreo-ready="true">Choreo test dist</body></html>',
		"utf8",
	);
	// Loads are counted in sessionStorage (shared with the parent page — same
	// origin) so E2E specs can prove the iframe actually reloaded after a
	// project swap; its `src` is unchanged by the remount, so the counter is
	// the only observable difference.
	await writeFile(
		join(choreoDistDir, "main.js"),
		`const key = "e2e:choreo-loads";
let loads = 1;
try {
	loads = Number(sessionStorage.getItem(key) ?? "0") + 1;
	sessionStorage.setItem(key, String(loads));
} catch {}
document.body.dataset.fakeChoreoLoads = String(loads);
`,
		"utf8",
	);
	return choreoDistDir;
}

export async function createElasticDist(root: string): Promise<string> {
	const elasticDistDir = join(root, "elastic-dist");
	await mkdir(elasticDistDir, { recursive: true });
	await writeFile(
		join(elasticDistDir, "index.html"),
		'<!doctype html><html><head><script src="main.js" defer></script></head><body>Elastic test dist</body></html>',
		"utf8",
	);
	await writeFile(
		join(elasticDistDir, "main.js"),
		"console.log('elastic main');\n",
		"utf8",
	);
	return elasticDistDir;
}

export async function withApp<T>(
	fn: (app: ControlApp, root: string) => Promise<T>,
	options: Partial<ControlAppOptions> = {},
): Promise<T> {
	const root = await mkdtemp(join(tmpdir(), "frc-v2-control-"));
	const catalogDir = await createCatalogDir(root);
	const webDistDir = await createWebDist(root);
	const advantageScopeDistDir = await createAdvantageScopeDist(root);
	const choreoDistDir = await createChoreoDist(root);
	const elasticDistDir = await createElasticDist(root);
	const app = await createApp({
		dataDir: join(root, "data"),
		catalogDir,
		// Empty string, not null/omitted: config.ts's resolution is
		// `input.catalogRepo ?? Bun.env.LESSONS_CATALOG_REPO ?? null`, and `??`
		// treats an explicit null exactly like "not provided" - it would still
		// fall through to Bun.env.LESSONS_CATALOG_REPO. Bun auto-loads .env for
		// every bun process including `bun test`, so a developer's real
		// LESSONS_CATALOG_REPO in .env (for their own local deployment) would
		// otherwise silently swap every test's catalog source from this
		// fixture to a live network fetch of their real remote catalog. Empty
		// string is falsy (createCatalogSource's `if (config.catalogRepo)`
		// correctly treats it as "no repo", same as null) but not nullish, so
		// it actually wins the `??` chain. Tests that want the remote path can
		// still override via `options`, spread below.
		catalogRepo: "",
		webDistDir,
		advantageScopeDistDir,
		choreoDistDir,
		elasticDistDir,
		ssoSecret: "test-sso-secret",
		baseUrl: "http://localhost:4000",
		idleStopMinutes: 30,
		containerAutoStart: false,
		// Explicit false (not nullish, so `??` can't fall through to
		// Bun.env.FABRICA_DEMO_MODE) - same class of bug as catalogRepo
		// above: a developer's real .env with demo mode on for local testing
		// would otherwise silently flip every test into demo mode. Tests that
		// actually want demo mode still override it via `options`, spread below.
		demo: false,
		portAvailable: options.dockerRunner ? async () => true : undefined,
		...options,
	});

	try {
		return await fn(app, root);
	} finally {
		app.close();
		await rm(root, { recursive: true, force: true });
	}
}

type FakeContainerPort = {
	hostPort: number;
	containerPort: number;
	hostIp: string;
};

type FakeContainerMount = {
	Type: string;
	Destination: string;
};

type FakeContainer = {
	name: string;
	running: boolean;
	labels: Record<string, string>;
	ports: FakeContainerPort[];
	networks?: string[];
	mounts?: FakeContainerMount[];
};

export function ok(stdout = ""): DockerCommandResult {
	return { exitCode: 0, stdout, stderr: "" };
}

export function missing(message = "missing"): DockerCommandResult {
	return { exitCode: 1, stdout: "", stderr: message };
}

export function dockerInspect(container: FakeContainer): unknown {
	const portsMap: Record<
		string,
		Array<{ HostIp: string; HostPort: string }>
	> = {};
	for (const p of container.ports) {
		const key = `${p.containerPort}/tcp`;
		if (!portsMap[key]) {
			portsMap[key] = [];
		}
		portsMap[key].push({ HostIp: p.hostIp, HostPort: String(p.hostPort) });
	}
	const networks: Record<string, unknown> = {};
	for (const network of container.networks ?? []) {
		networks[network] = { NetworkID: `fake-${network}` };
	}
	return {
		Name: `/${container.name}`,
		State: {
			Running: container.running,
			Status: container.running ? "running" : "exited",
		},
		Config: {
			Labels: container.labels,
		},
		Mounts: container.mounts,
		NetworkSettings: {
			Ports: portsMap,
			Networks: networks,
		},
	};
}

/** Parse long mounts and short Linux volume flags out of a `docker run` argv. */
function parseMountFlags(args: string[]): FakeContainerMount[] {
	const mounts: FakeContainerMount[] = [];
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === "-v") {
			const [source, destination] = (args[index + 1] ?? "").split(":");
			if (source && destination) {
				mounts.push({
					Type: source.startsWith("/") ? "bind" : "volume",
					Destination: destination,
				});
			}
			continue;
		}
		if (args[index] !== "--mount") continue;
		const fields = new Map(
			(args[index + 1] ?? "")
				.split(",")
				.map((pair) => pair.split("=") as [string, string]),
		);
		const type = fields.get("type");
		const destination = fields.get("dst");
		if (type && destination) {
			mounts.push({ Type: type, Destination: destination });
		}
	}
	return mounts;
}

export function createFakeDocker(
	options: {
		failRunPortsOnce?: number[];
		onRun?: (name: string, ports: FakeContainerPort[]) => void;
	} = {},
) {
	const containers = new Map<string, FakeContainer>();
	const calls: string[][] = [];
	const failRunPortsOnce = new Set(options.failRunPortsOnce ?? []);

	const runner: DockerRunner = async (args) => {
		calls.push([...args]);

		if (args[0] === "image" && args[1] === "inspect") {
			return ok(JSON.stringify([{ Id: "fake-image" }]));
		}

		if (args[0] === "container" && args[1] === "inspect") {
			const requested = args.slice(2);
			const found = requested
				.map((name) => containers.get(name))
				.filter((container): container is FakeContainer => Boolean(container));
			// Mirror real docker: it prints the JSON array of resolved containers
			// even when some names are missing, exiting non-zero in that case.
			const allFound = found.length === requested.length;
			const stdout = found.length
				? JSON.stringify(found.map((container) => dockerInspect(container)))
				: "";
			return allFound
				? ok(stdout)
				: {
						exitCode: 1,
						stdout,
						stderr: "Error: No such container",
					};
		}

		if (args[0] === "container" && args[1] === "ls") {
			const workspaceFilter = args.find((arg) =>
				arg.startsWith("label=frc-sim.workspace="),
			);
			const workspaceId = workspaceFilter?.slice(
				"label=frc-sim.workspace=".length,
			);
			const roleFilter = args.find((arg) =>
				arg.startsWith("label=frc-sim.role="),
			);
			const roleValue = roleFilter?.slice("label=frc-sim.role=".length);
			const versionFilter = args.find((arg) =>
				arg.startsWith("label=frc-sim.version="),
			);
			const versionValue = versionFilter?.slice(
				"label=frc-sim.version=".length,
			);
			const statusFilter = args.find((arg) => arg.startsWith("status="));
			const statusValue = statusFilter?.slice("status=".length);
			const names = [...containers.values()]
				.filter((container) => {
					if (
						workspaceId &&
						container.labels["frc-sim.workspace"] !== workspaceId
					) {
						return false;
					}
					if (roleValue && container.labels["frc-sim.role"] !== roleValue) {
						return false;
					}
					if (
						versionValue &&
						container.labels["frc-sim.version"] !== versionValue
					) {
						return false;
					}
					if (statusValue === "exited" && container.running) {
						return false;
					}
					if (statusValue === "running" && !container.running) {
						return false;
					}
					return true;
				})
				.map((container) => container.name);
			return ok(`${names.join("\n")}${names.length ? "\n" : ""}`);
		}

		if (args[0] === "run") {
			const name = args[args.indexOf("--name") + 1] ?? "";
			// Parse all -p flags for dual-port support
			const parsedPorts: FakeContainerPort[] = [];
			for (let i = 0; i < args.length; i += 1) {
				if (args[i] === "-p") {
					const mapping = args[i + 1] ?? "";
					const portMatch = /^([\d.]+):(\d+):(\d+)$/u.exec(mapping);
					if (portMatch) {
						parsedPorts.push({
							hostIp: portMatch[1]!,
							hostPort: Number(portMatch[2]),
							containerPort: Number(portMatch[3]),
						});
					}
				}
			}
			// Check if any port should trigger a failure
			for (const p of parsedPorts) {
				if (failRunPortsOnce.has(p.hostPort)) {
					failRunPortsOnce.delete(p.hostPort);
					return missing(
						`Bind for ${p.hostIp}:${p.hostPort} failed: port is already allocated`,
					);
				}
			}
			const labels: Record<string, string> = {};
			const networks: string[] = [];
			for (let index = 0; index < args.length; index += 1) {
				if (args[index] === "--label") {
					const [key, value] = (args[index + 1] ?? "").split("=");
					if (key && value) {
						labels[key] = value;
					}
				}
				if (args[index] === "--network") {
					const network = args[index + 1];
					if (network) {
						networks.push(network);
					}
				}
			}
			containers.set(name, {
				name,
				running: true,
				labels,
				ports: parsedPorts,
				networks,
				mounts: parseMountFlags(args),
			});
			options.onRun?.(name, parsedPorts);
			return ok("fake-container-id\n");
		}

		// The demo-mode /config volume. Creation is not allowFailure, so an
		// unhandled fall-through here would throw rather than fail an assertion.
		if (args[0] === "volume" && (args[1] === "create" || args[1] === "rm")) {
			return ok();
		}

		if (args[0] === "start") {
			const container = containers.get(args[1] ?? "");
			if (!container) {
				return missing("No such container");
			}
			container.running = true;
			return ok(`${container.name}\n`);
		}

		if (args[0] === "rm" && args[1] === "-f") {
			containers.delete(args[2] ?? "");
			return ok();
		}

		if (args[0] === "rm" && args[1] && args[1] !== "-f") {
			containers.delete(args[1]);
			return ok();
		}

		if (args[0] === "stop") {
			const container = containers.get(args[1] ?? "");
			if (!container) {
				return missing("No such container");
			}
			container.running = false;
			return ok(`${container.name}\n`);
		}

		return missing(`unhandled docker args: ${args.join(" ")}`);
	};

	return { runner, containers, calls };
}

export type ExecOverride = {
	predicate: (command: string[]) => boolean;
	result: ExecResult;
};

export class MockWorkspaceRuntimeProvider implements WorkspaceRuntimeProvider {
	readonly execCalls: Array<{
		workspaceId: WorkspaceId;
		command: string[];
		options: ExecOptions;
	}> = [];
	readonly streamCalls: Array<{
		workspaceId: WorkspaceId;
		command: string[];
		options: ExecOptions;
	}> = [];
	private readonly runtimes = new Map<WorkspaceId, WorkspaceRuntime>();
	private readonly execOverrides = new Map<WorkspaceId, ExecOverride[]>();

	constructor(initialRuntimes: WorkspaceRuntime[] = []) {
		for (const runtime of initialRuntimes) {
			this.runtimes.set(runtime.workspaceId, runtime);
		}
	}

	setRuntime(runtime: WorkspaceRuntime): void {
		this.runtimes.set(runtime.workspaceId, runtime);
	}

	/**
	 * Flip a workspace runtime into the "error" state with the given message.
	 * Used by build-failure / run-state-recovery specs to simulate an upstream
	 * container crash after the runtime had been running.
	 */
	simulateRuntimeFailure(
		workspaceId: WorkspaceId,
		message = "Container exited unexpectedly.",
	): void {
		const runtime = this.runtimes.get(workspaceId);
		if (!runtime) {
			throw new Error(`No mock runtime for workspace ${workspaceId}.`);
		}
		this.runtimes.set(workspaceId, {
			...runtime,
			state: "error",
			error: message,
		});
	}

	/**
	 * Register an exec() override matched by the given predicate over command
	 * shape. The first matching override is consumed (one-shot) and the runtime
	 * returns the provided result instead of the default empty success.
	 */
	injectExecFailure(
		workspaceId: WorkspaceId,
		predicate: (command: string[]) => boolean,
		result: ExecResult,
	): void {
		const list = this.execOverrides.get(workspaceId) ?? [];
		list.push({ predicate, result });
		this.execOverrides.set(workspaceId, list);
	}

	async ensureWorkspaceRunning(
		workspaceId: WorkspaceId,
	): Promise<WorkspaceRuntime> {
		const runtime = this.getRuntime(workspaceId);
		if (runtime.state === "running") {
			return runtime;
		}
		if (runtime.state === "error") {
			// Mirror real provider: a simulated failure does not silently recover.
			return runtime;
		}
		const running: WorkspaceRuntime = {
			...runtime,
			state: "running",
			error: null,
		};
		this.runtimes.set(workspaceId, running);
		return running;
	}

	async stopWorkspace(workspaceId: WorkspaceId): Promise<void> {
		const runtime = this.getRuntime(workspaceId);
		this.runtimes.set(workspaceId, { ...runtime, state: "stopped" });
	}

	async restartWorkspace(workspaceId: WorkspaceId): Promise<WorkspaceRuntime> {
		const runtime = {
			...this.getRuntime(workspaceId),
			state: "running" as const,
			error: null,
		};
		this.runtimes.set(workspaceId, runtime);
		return runtime;
	}

	async removeWorkspace(workspaceId: WorkspaceId): Promise<void> {
		const runtime = this.getRuntime(workspaceId);
		this.runtimes.set(workspaceId, {
			...runtime,
			state: "missing",
			runtimeName: null,
			ports: { nt4: null, vscode: null, halsim: null, choreo: null },
			endpoints: { vscode: null, nt4: null, halsim: null, choreo: null },
		});
	}

	async getWorkspaceStatus(
		workspaceId: WorkspaceId,
	): Promise<WorkspaceRuntime> {
		return this.getRuntime(workspaceId);
	}

	async exec(
		workspaceId: WorkspaceId,
		command: string[],
		options: ExecOptions = {},
	): Promise<ExecResult> {
		this.execCalls.push({ workspaceId, command: [...command], options });
		const overrides = this.execOverrides.get(workspaceId);
		if (overrides) {
			for (let i = 0; i < overrides.length; i += 1) {
				const ov = overrides[i]!;
				if (ov.predicate(command)) {
					overrides.splice(i, 1);
					return ov.result;
				}
			}
		}
		return { exitCode: 0, stdout: "", stderr: "" };
	}

	execStream(
		workspaceId: WorkspaceId,
		command: string[],
		options: ExecOptions = {},
	): WorkspaceRuntimeCommand {
		this.streamCalls.push({ workspaceId, command: [...command], options });
		return {
			stdout: null,
			stderr: null,
			exited: Promise.resolve({ code: 0, signal: null }),
			kill() {},
		};
	}

	async listRuntimes(): Promise<ManagedWorkspaceRuntime[]> {
		return [...this.runtimes.values()].map((runtime) => ({
			name: runtime.runtimeName ?? runtime.workspaceId,
			id: null,
			workspaceId: runtime.workspaceId,
			role: "code",
			state: runtime.state,
			cpuPercent: null,
			memoryUsage: null,
			memoryLimit: null,
			memoryPercent: null,
		}));
	}

	async cleanupStoppedRuntimes(): Promise<string[]> {
		return [];
	}

	async countRunningWorkspaces(): Promise<number> {
		return [...this.runtimes.values()].filter(
			(runtime) => runtime.state === "running",
		).length;
	}

	private getRuntime(workspaceId: WorkspaceId): WorkspaceRuntime {
		const runtime = this.runtimes.get(workspaceId);
		if (!runtime) {
			throw new Error(`No mock runtime for workspace ${workspaceId}.`);
		}
		return runtime;
	}
}

/**
 * Test helper: build a controllable RunCommandFactory. Each call returns a
 * fresh `RunCommand`-shaped object whose stdout / stderr / exit can be driven
 * from the test. Use `script` to enqueue lines (with stream tag and an
 * optional terminal exit code).
 *
 *     const factory = makeScriptedRunCommandFactory([
 *       { stream: "stdout", line: "Starting up" },
 *       { stream: "stdout", line: "NetworkTables listening on 5810" },
 *       // ... command stays alive until `kill()` or the next entry exits.
 *     ]);
 *
 * If the script never sets an exit code, the command stays running until the
 * caller invokes `command.kill()` (which resolves `exited`).
 */
export type ScriptedRunLine =
	| { stream: "stdout" | "stderr"; line: string; delayMs?: number }
	| { exit: number; signal?: string | null };

export function makeScriptedRunCommandFactory(
	script: ScriptedRunLine[],
): RunCommandFactory {
	return () => {
		let stdoutEnqueue: ((chunk: Uint8Array) => void) | null = null;
		let stdoutClose: (() => void) | null = null;
		let stderrEnqueue: ((chunk: Uint8Array) => void) | null = null;
		let stderrClose: (() => void) | null = null;

		const stdout = new ReadableStream<Uint8Array>({
			start(controller) {
				stdoutEnqueue = (c) => controller.enqueue(c);
				stdoutClose = () => {
					try {
						controller.close();
					} catch {}
				};
			},
		});
		const stderr = new ReadableStream<Uint8Array>({
			start(controller) {
				stderrEnqueue = (c) => controller.enqueue(c);
				stderrClose = () => {
					try {
						controller.close();
					} catch {}
				};
			},
		});

		let resolveExit!: (value: {
			code: number | null;
			signal: string | null;
		}) => void;
		const exited = new Promise<{ code: number | null; signal: string | null }>(
			(resolve) => {
				resolveExit = resolve;
			},
		);

		let killed = false;
		const finish = (code: number | null, signal: string | null) => {
			if (stdoutClose) stdoutClose();
			if (stderrClose) stderrClose();
			resolveExit({ code, signal });
		};

		void (async () => {
			const encoder = new TextEncoder();
			for (const entry of script) {
				if (killed) return;
				if ("exit" in entry) {
					finish(entry.exit, entry.signal ?? null);
					return;
				}
				if (entry.delayMs)
					await new Promise((r) => setTimeout(r, entry.delayMs));
				const enq = (
					entry.stream === "stdout" ? stdoutEnqueue : stderrEnqueue
				) as ((chunk: Uint8Array) => void) | null;
				if (enq) enq(encoder.encode(`${entry.line}\n`));
			}
			// Script ran out without an exit entry — keep the streams open so the
			// run sits in `running` until the consumer kills it.
		})();

		return {
			stdout,
			stderr,
			exited,
			kill() {
				killed = true;
				finish(null, "SIGTERM");
			},
		};
	};
}

export async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		if (predicate()) {
			return;
		}
		await Bun.sleep(10);
	}
	throw new Error("Timed out waiting for condition.");
}

/** Legion mints an 8-lowercase-hex-char `member_code` (`secrets.token_hex(4)`). */
function randomMemberCode(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(4));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Simulate a Legion login by signing a real `mw_sso` cookie (see
 * `../legion/sso.ts`) rather than driving Legion's own /sso/authorize flow.
 * Returns a fake Response whose set-cookie header carries the signed token,
 * keeping the existing `cookieFrom()` helper working unchanged.
 *
 * `options.email`, despite the name, becomes the Legion `username` claim —
 * kept as `email` so existing call sites across the test suite don't need a
 * rename; the wire field it ends up in (`session.user.email`) is unchanged.
 */
export async function login(
	app: ControlApp,
	displayName: string,
	options: {
		role?: "student" | "admin";
		email?: string;
		/** Extra Legion group slugs beyond what `role` implies (e.g. for
		 * testing lesson-assignment targeting a non-admin group). */
		groups?: string[];
	} = {},
): Promise<Response> {
	const secret = app.storage.config.ssoSecret;
	if (!secret) {
		throw new Error("Test ControlApp has no ssoSecret configured for login().");
	}
	// Bare, no "@domain" - a real Legion username never contains one (unlike
	// the OAuth email this replaced), and slugFromUsername has no email-style
	// "strip everything after @" step, so a domain suffix here would leak into
	// the derived workspace slug.
	const username = (options.email ?? displayName.toLowerCase()).toLowerCase();

	// Reuse the same member_code across repeated logins for the same identity
	// (matches the old OAuth login()'s "same email -> same user" behavior),
	// rather than minting a fresh identity - and workspace - every call.
	const existing = app.storage.db
		.query("SELECT id FROM user WHERE email = ?")
		.get(username) as { id: string } | null;
	const memberCode = existing?.id ?? randomMemberCode();

	const claims: LegionSsoClaims = {
		member_code: memberCode,
		username,
		name: displayName,
		role: "student",
		team_number: null,
		groups: [
			...((options.role ?? "student") === "admin" ? ["fabrica-admin"] : []),
			...(options.groups ?? []),
		],
		slack_user_id: null,
	};
	const token = signLegionToken(claims, secret);

	// Resolve the session once server-side so the redirect Location carries the
	// materialized workspace slug, and the user/workspace rows exist before the
	// caller's first request under the cookie.
	const probeRequest = new Request(`${app.storage.config.baseUrl}/`, {
		headers: { cookie: `mw_sso=${encodeURIComponent(token)}` },
	});
	const session = await getSessionFromRequest(app.storage, probeRequest);
	if (!session) {
		throw new Error(
			"login(): failed to resolve the freshly-signed test session.",
		);
	}

	return new Response(null, {
		status: 303,
		headers: new Headers([
			["set-cookie", `mw_sso=${encodeURIComponent(token)}; Path=/; HttpOnly`],
			["location", `/u/${session.user.slug}/`],
		]),
	});
}

export function cookieFrom(response: Response): string {
	const setCookie = response.headers.get("set-cookie");
	expect(setCookie).toBeTruthy();
	return setCookie?.split(";")[0] ?? "";
}

export function workspaceProjectPath(app: ControlApp, slug: string): string {
	const workspace = app.storage.db
		.query("SELECT * FROM workspaces WHERE slug = ?")
		.get(slug) as {
		project_path: string;
	} | null;
	expect(workspace).toBeTruthy();
	return workspace?.project_path ?? "";
}

export function workspaceBySlug(app: ControlApp, slug: string) {
	const workspace = app.storage.db
		.query("SELECT * FROM workspaces WHERE slug = ?")
		.get(slug) as WorkspaceRow | null;
	expect(workspace).toBeTruthy();
	return workspace!;
}
