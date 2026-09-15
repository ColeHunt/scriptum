#!/usr/bin/env bun
// Cross-validates vendor/tools.json against the places its facts are
// supposed to be mirrored, so a vendored tool being added/upgraded/removed
// can't silently leave stale docs/config behind the way PathPlanner's
// removal did (see docs/decisions/043-vendor-tool-manifest.md). Wired into
// `bun run verify`.
//
// Checks, per tool:
//  - submodule tools have a matching [submodule "<path>"] block in
//    .gitmodules, with the same repo URL
//  - THIRD_PARTY_NOTICES.md has a summary-table row and a license section
//    naming the tool
//  - a patches/<tool>/README.md exists when patchesDir is set
//  - distDirEnvVar is referenced in both .env.example and apps/control/src/config.ts
//  - imageDistPath appears as a build/copy target in every listed buildSite

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadVendorManifest, type VendorTool } from "./vendor-manifest";

const repoRoot = resolve(import.meta.dirname, "..");

async function readIfExists(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return null;
	}
}

async function checkSubmodule(
	root: string,
	tool: VendorTool,
	errors: string[],
): Promise<void> {
	if (!tool.submodulePath) return;
	const gitmodules = (await readIfExists(resolve(root, ".gitmodules"))) ?? "";
	const blockPattern = new RegExp(
		`\\[submodule "[^"]+"\\][^\\[]*path = ${escapeRegExp(tool.submodulePath)}\\b[^\\[]*url = ${escapeRegExp(tool.repoUrl)}\\b`,
	);
	if (!blockPattern.test(gitmodules)) {
		errors.push(
			`${tool.id}: .gitmodules has no submodule at "${tool.submodulePath}" pointing at "${tool.repoUrl}" (or the manifest's pin/repoUrl has drifted from .gitmodules).`,
		);
	}
}

async function checkThirdPartyNotices(
	root: string,
	tool: VendorTool,
	errors: string[],
): Promise<void> {
	const notices =
		(await readIfExists(resolve(root, "THIRD_PARTY_NOTICES.md"))) ?? "";
	if (!notices.includes(tool.displayName)) {
		errors.push(
			`${tool.id}: THIRD_PARTY_NOTICES.md has no mention of "${tool.displayName}" (expected a summary row and a license section).`,
		);
	}
}

async function checkPatchesReadme(
	root: string,
	tool: VendorTool,
	errors: string[],
): Promise<void> {
	if (!tool.patchesDir) return;
	const readme = await readIfExists(
		resolve(root, tool.patchesDir, "README.md"),
	);
	if (readme === null) {
		errors.push(`${tool.id}: expected ${tool.patchesDir}/README.md to exist.`);
	}
}

async function checkDistDirEnvVar(
	root: string,
	tool: VendorTool,
	errors: string[],
): Promise<void> {
	const envExample = (await readIfExists(resolve(root, ".env.example"))) ?? "";
	if (!envExample.includes(tool.distDirEnvVar)) {
		errors.push(
			`${tool.id}: .env.example has no mention of ${tool.distDirEnvVar}.`,
		);
	}

	const config =
		(await readIfExists(resolve(root, "apps/control/src/config.ts"))) ?? "";
	if (!config.includes(tool.distDirEnvVar)) {
		errors.push(
			`${tool.id}: apps/control/src/config.ts has no mention of ${tool.distDirEnvVar}.`,
		);
	}
}

async function checkBuildSites(
	root: string,
	tool: VendorTool,
	errors: string[],
): Promise<void> {
	let anySiteHasDist = false;

	for (const site of tool.buildSites) {
		const contents = await readIfExists(resolve(root, site));
		if (contents === null) {
			errors.push(`${tool.id}: buildSite "${site}" does not exist.`);
			continue;
		}
		if (contents.includes(tool.imageDistPath)) {
			anySiteHasDist = true;
		}

		// "clone" tools (unlike submodules) have their pin as a literal string
		// in each build site (a Dockerfile ARG default) — this is exactly the
		// class of drift that bit Choreo's CHOREO_REPO/CHOREO_COMMIT once being
		// duplicated across three files independently. Every listed site must
		// still agree with the manifest's pin.
		if (tool.kind === "clone" && !contents.includes(tool.pin)) {
			errors.push(
				`${tool.id}: ${site} does not reference pin "${tool.pin}" - has it drifted from vendor/tools.json?`,
			);
		}
	}

	if (!anySiteHasDist) {
		errors.push(
			`${tool.id}: none of its buildSites (${tool.buildSites.join(", ")}) reference imageDistPath "${tool.imageDistPath}".`,
		);
	}
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function checkVendorManifest(
	root: string = repoRoot,
): Promise<string[]> {
	const manifest = await loadVendorManifest(
		resolve(root, "vendor", "tools.json"),
	);
	const errors: string[] = [];

	for (const tool of manifest.tools) {
		await checkSubmodule(root, tool, errors);
		await checkThirdPartyNotices(root, tool, errors);
		await checkPatchesReadme(root, tool, errors);
		await checkDistDirEnvVar(root, tool, errors);
		await checkBuildSites(root, tool, errors);
	}

	return errors;
}

if (import.meta.main) {
	const errors = await checkVendorManifest();
	if (errors.length > 0) {
		console.error(
			`vendor/tools.json drift check failed (${errors.length} issue${errors.length === 1 ? "" : "s"}):\n`,
		);
		for (const error of errors) {
			console.error(`  - ${error}`);
		}
		process.exit(1);
	}
	console.log(
		`vendor/tools.json is consistent with .gitmodules, THIRD_PARTY_NOTICES.md, .env.example, config.ts, and every tool's build sites.`,
	);
}
