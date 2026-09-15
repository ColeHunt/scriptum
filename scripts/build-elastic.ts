import { cp, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { applyVendorPatches } from "./apply-vendor-patches";

const repoRoot = resolve(import.meta.dirname, "..");
const elasticRoot = resolve(repoRoot, "vendor", "elastic_dashboard");
const elasticWebOutput = resolve(elasticRoot, "build", "web");
const distDir = resolve(repoRoot, "dist", "elastic");
const flutterCommand = process.platform === "win32" ? "flutter.bat" : "flutter";

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function run(
	command: string,
	args: string[],
	options: { cwd: string },
): Promise<void> {
	console.log(`\n> ${command} ${args.join(" ")}`);
	const subprocess = Bun.spawn([command, ...args], {
		cwd: options.cwd,
		stdout: "inherit",
		stderr: "inherit",
		stdin: "ignore",
	});
	const exitCode = await subprocess.exited;
	if (exitCode !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} failed with exit ${exitCode}.`,
		);
	}
}

async function ensureSubmodule(): Promise<void> {
	if (!(await exists(resolve(elasticRoot, "pubspec.yaml")))) {
		throw new Error(
			"vendor/elastic_dashboard/pubspec.yaml not found. Run git submodule update --init --recursive.",
		);
	}
}

async function ensureFlutter(): Promise<void> {
	const subprocess = Bun.spawn([flutterCommand, "--version"], {
		stdout: "ignore",
		stderr: "ignore",
	});
	const exitCode = await subprocess.exited.catch(() => 1);
	if (exitCode !== 0) {
		throw new Error(
			"Flutter SDK not found on PATH. build:elastic is deliberately kept " +
				"out of this repo's own Docker/CI toolchain (see " +
				"docs/decisions/041-elastic-dashboard-integration.md) - install " +
				"Flutter locally, or use `bun run fetch:dist` to download a " +
				"prebuilt elastic-dist.tar.gz instead.",
		);
	}
}

async function stageBundle(): Promise<void> {
	if (!(await exists(resolve(elasticWebOutput, "index.html")))) {
		throw new Error(`Expected Elastic web output at ${elasticWebOutput}.`);
	}

	await rm(distDir, { recursive: true, force: true });
	await cp(elasticWebOutput, distDir, { recursive: true });
}

export async function buildElastic(): Promise<void> {
	await ensureSubmodule();
	await ensureFlutter();
	await applyVendorPatches("elastic");

	console.log(`Building Elastic Dashboard from ${elasticRoot}`);
	await run(flutterCommand, ["pub", "get"], { cwd: elasticRoot });
	await run(flutterCommand, ["build", "web", "--release"], {
		cwd: elasticRoot,
	});
	await stageBundle();
	console.log(`\nElastic Dashboard staged at ${distDir}`);
}

if (import.meta.main) {
	try {
		await buildElastic();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
