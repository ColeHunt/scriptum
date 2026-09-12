#!/usr/bin/env bun

// Builds Choreo's frontend (plain Vite/React/TS - this repo's own stack,
// unlike PathPlanner's Flutter) from a pinned commit of its own fork. The
// same commit is what containers/control/Dockerfile's choreo-web-build
// stage builds and containers/code/Dockerfile's choreo-builder stage builds
// the Rust sidecar from - see docs/decisions/040-choreo-integration.md.
//
// Used by `bun run build` (prod build from source) and `fetch:dist` (the
// demo/quick-start path). Unlike PathPlanner's prebuilt-release-artifact
// fetch, there is nothing to download here: the frontend needs only Bun +
// Vite, both already required for this repo's own build:web step, so
// building it inline is no heavier a dependency than the thing it replaces.

import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { withScratch } from "./dist-download";

const repoRoot = resolve(import.meta.dirname, "..");

// Overridable so forks can point at their own Choreo fork/commit.
const repo = Bun.env.CHOREO_REPO ?? "https://github.com/ColeHunt/Choreo.git";
const commit =
	Bun.env.CHOREO_COMMIT ?? "0f5f366574dfa4b76eeed636d0d2d246d618fe21";
const destDir = resolve(repoRoot, "dist/choreo");

async function run(
	command: string,
	args: string[],
	cwd: string = repoRoot,
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
	console.log(`Building Choreo's frontend from ${repo} @ ${commit}`);
	await withScratch(async (scratch) => {
		const checkout = resolve(scratch, "choreo");
		await run("git", ["clone", repo, checkout]);
		await run("git", ["-C", checkout, "checkout", commit]);
		await run("bun", ["install"], checkout);
		await run("bunx", ["vite", "build"], checkout);

		await rm(destDir, { recursive: true, force: true });
		await mkdir(destDir, { recursive: true });
		await run("cp", ["-a", `${resolve(checkout, "dist")}/.`, destDir]);
	});
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
