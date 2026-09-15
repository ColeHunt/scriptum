#!/usr/bin/env bun

// Builds Choreo's frontend (plain Vite/React/TS - this repo's own stack,
// unlike PathPlanner's Flutter) from the pinned vendor/Choreo submodule,
// patched the same way AdvantageScope/Elastic are - see
// docs/decisions/045-choreo-submodule-migration.md. The same submodule/pin
// is what containers/code/Dockerfile's choreo-builder stage builds the Rust
// sidecar from.
//
// Used by `bun run build` (prod build from source) and `fetch:dist` (the
// demo/quick-start path). Unlike PathPlanner's prebuilt-release-artifact
// fetch, there is nothing to download here: the frontend needs only Bun +
// Vite, both already required for this repo's own build:web step, so
// building it inline is no heavier a dependency than the thing it replaces.

import { cp, mkdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { applyVendorPatches } from "./apply-vendor-patches";
import { getVendorTool } from "./vendor-manifest";

const repoRoot = resolve(import.meta.dirname, "..");
const choreoRoot = resolve(repoRoot, "vendor", "Choreo");
const destDir = resolve(repoRoot, "dist", "choreo");

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function ensureSubmodule(): Promise<void> {
	if (!(await exists(resolve(choreoRoot, "package.json")))) {
		throw new Error(
			"vendor/Choreo/package.json not found. Run git submodule update --init --recursive.",
		);
	}
}

async function run(
	command: string,
	args: string[],
	cwd: string = choreoRoot,
): Promise<void> {
	const subprocess = Bun.spawn([command, ...args], {
		cwd,
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

export async function buildChoreo(): Promise<void> {
	await ensureSubmodule();
	const choreoTool = await getVendorTool("choreo");
	console.log(
		`Building Choreo's frontend from ${choreoRoot} @ ${choreoTool.pin}`,
	);

	await applyVendorPatches("choreo");
	await run("bun", ["install"]);
	await run("bunx", ["vite", "build"]);

	await rm(destDir, { recursive: true, force: true });
	await mkdir(destDir, { recursive: true });
	await cp(resolve(choreoRoot, "dist"), destDir, { recursive: true });

	console.log(`\nChoreo web dist ready at ${destDir}`);
}

if (import.meta.main) {
	try {
		await buildChoreo();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
