import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { applyVendorPatches } from "./apply-vendor-patches";

async function run(cwd: string, args: string[]): Promise<void> {
	const subprocess = Bun.spawn(["git", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const exitCode = await subprocess.exited;
	if (exitCode !== 0) {
		const stderr = await new Response(subprocess.stderr).text();
		throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
	}
}

/** A throwaway repo tree standing in for {repo root, vendor submodule worktree,
 * patches dir} — everything applyVendorPatches needs, at a fixture path
 * instead of this repo's real vendor/AdvantageScope or vendor/elastic_dashboard. */
async function setupFixture(): Promise<{
	repoRoot: string;
	submoduleRoot: string;
}> {
	const repoRoot = await mkdtemp(resolve(tmpdir(), "apply-vendor-patches-"));
	const submoduleRoot = resolve(repoRoot, "vendor", "fixture");
	await mkdir(submoduleRoot, { recursive: true });

	await run(submoduleRoot, ["init", "-q"]);
	await run(submoduleRoot, ["config", "user.email", "test@example.com"]);
	await run(submoduleRoot, ["config", "user.name", "Test"]);
	await writeFile(resolve(submoduleRoot, "main.txt"), "line one\nline two\n");
	await run(submoduleRoot, ["add", "main.txt"]);
	await run(submoduleRoot, ["commit", "-q", "-m", "initial"]);

	const patchDir = resolve(repoRoot, "patches", "fixture");
	await mkdir(patchDir, { recursive: true });
	await writeFile(
		resolve(patchDir, "001-add-line.patch"),
		[
			"--- a/main.txt",
			"+++ b/main.txt",
			"@@ -1,2 +1,3 @@",
			" line one",
			" line two",
			"+line three",
			"",
		].join("\n"),
	);

	await writeFile(
		resolve(repoRoot, "vendor", "tools.json"),
		JSON.stringify({
			schemaVersion: 1,
			tools: [
				{
					id: "fixture-tool",
					displayName: "Fixture Tool",
					kind: "submodule",
					repoUrl: "https://example.com/fixture.git",
					pin: "n/a",
					submodulePath: "vendor/fixture",
					patchesDir: "patches/fixture",
					license: "MIT",
					distDirEnvVar: "FRC_FIXTURE_DIST_DIR",
					imageDistPath: "dist/fixture",
					buildScript: "scripts/build-fixture.ts",
					buildSites: ["containers/control/Dockerfile"],
					docsDecisionRef: "docs/decisions/999-fixture.md",
				},
			],
		}),
	);

	return { repoRoot, submoduleRoot };
}

/** Two patches where the second further modifies the same file the first
 * touches — the exact shape that broke per-patch reverse-check idempotency
 * for both AdvantageScope's and Choreo's real patch chains (a later patch
 * modifying a file an earlier one already created/touched). */
async function setupOverlappingFixture(): Promise<{
	repoRoot: string;
	submoduleRoot: string;
}> {
	const repoRoot = await mkdtemp(
		resolve(tmpdir(), "apply-vendor-patches-overlap-"),
	);
	const submoduleRoot = resolve(repoRoot, "vendor", "fixture");
	await mkdir(submoduleRoot, { recursive: true });

	await run(submoduleRoot, ["init", "-q"]);
	await run(submoduleRoot, ["config", "user.email", "test@example.com"]);
	await run(submoduleRoot, ["config", "user.name", "Test"]);
	await writeFile(resolve(submoduleRoot, "main.txt"), "line one\nline two\n");
	await run(submoduleRoot, ["add", "main.txt"]);
	await run(submoduleRoot, ["commit", "-q", "-m", "initial"]);

	const patchDir = resolve(repoRoot, "patches", "fixture");
	await mkdir(patchDir, { recursive: true });
	await writeFile(
		resolve(patchDir, "001-add-line.patch"),
		[
			"--- a/main.txt",
			"+++ b/main.txt",
			"@@ -1,2 +1,3 @@",
			" line one",
			" line two",
			"+line three",
			"",
		].join("\n"),
	);
	// Touches the same file 001 already modified — this is what broke
	// patch 001's own reverse-check once 002 is also applied.
	await writeFile(
		resolve(patchDir, "002-add-another-line.patch"),
		[
			"--- a/main.txt",
			"+++ b/main.txt",
			"@@ -1,3 +1,4 @@",
			" line one",
			" line two",
			" line three",
			"+line four",
			"",
		].join("\n"),
	);

	await writeFile(
		resolve(repoRoot, "vendor", "tools.json"),
		JSON.stringify({
			schemaVersion: 1,
			tools: [
				{
					id: "fixture-tool",
					displayName: "Fixture Tool",
					kind: "submodule",
					repoUrl: "https://example.com/fixture.git",
					pin: "n/a",
					submodulePath: "vendor/fixture",
					patchesDir: "patches/fixture",
					license: "MIT",
					distDirEnvVar: "FRC_FIXTURE_DIST_DIR",
					imageDistPath: "dist/fixture",
					buildScript: "scripts/build-fixture.ts",
					buildSites: ["containers/control/Dockerfile"],
					docsDecisionRef: "docs/decisions/999-fixture.md",
				},
			],
		}),
	);

	return { repoRoot, submoduleRoot };
}

describe("applyVendorPatches", () => {
	test("applies a patch cleanly and is idempotent on a second run", async () => {
		const { repoRoot, submoduleRoot } = await setupFixture();
		try {
			await applyVendorPatches("fixture-tool", repoRoot);
			expect(await Bun.file(resolve(submoduleRoot, "main.txt")).text()).toBe(
				"line one\nline two\nline three\n",
			);

			// Second run must not throw ("already applied", not "conflict" or a
			// blind re-apply that would double the added line).
			await applyVendorPatches("fixture-tool", repoRoot);
			expect(await Bun.file(resolve(submoduleRoot, "main.txt")).text()).toBe(
				"line one\nline two\nline three\n",
			);
		} finally {
			await rm(repoRoot, { recursive: true, force: true });
		}
	});

	test("is idempotent when a later patch further modifies a file an earlier patch touched", async () => {
		const { repoRoot, submoduleRoot } = await setupOverlappingFixture();
		try {
			await applyVendorPatches("fixture-tool", repoRoot);
			expect(await Bun.file(resolve(submoduleRoot, "main.txt")).text()).toBe(
				"line one\nline two\nline three\nline four\n",
			);

			// Regression: a per-patch reverse-check would find patch 001's own
			// reverse-check failing here (the file is in patch 002's post-apply
			// state, not patch 001's), and incorrectly try to re-apply it.
			await applyVendorPatches("fixture-tool", repoRoot);
			expect(await Bun.file(resolve(submoduleRoot, "main.txt")).text()).toBe(
				"line one\nline two\nline three\nline four\n",
			);
		} finally {
			await rm(repoRoot, { recursive: true, force: true });
		}
	});

	test("rejects an unknown tool id", async () => {
		const { repoRoot } = await setupFixture();
		try {
			await expect(
				applyVendorPatches("does-not-exist", repoRoot),
			).rejects.toThrow(/No vendor tool "does-not-exist"/);
		} finally {
			await rm(repoRoot, { recursive: true, force: true });
		}
	});

	test("rejects a patch that cannot apply cleanly", async () => {
		const { repoRoot, submoduleRoot } = await setupFixture();
		try {
			// Diverge the worktree so the patch's context lines no longer match.
			await writeFile(
				resolve(submoduleRoot, "main.txt"),
				"completely different\n",
			);

			await expect(
				applyVendorPatches("fixture-tool", repoRoot),
			).rejects.toThrow(/Unable to apply/);
		} finally {
			await rm(repoRoot, { recursive: true, force: true });
		}
	});

	test("rejects a tool with no submodulePath/patchesDir", async () => {
		const { repoRoot } = await setupFixture();
		try {
			const manifestPath = resolve(repoRoot, "vendor", "tools.json");
			const manifest = JSON.parse(await Bun.file(manifestPath).text());
			manifest.tools.push({
				id: "no-patches",
				displayName: "No Patches",
				kind: "clone",
				repoUrl: "https://example.com/no-patches.git",
				pin: "n/a",
				license: "MIT",
				distDirEnvVar: "FRC_NO_PATCHES_DIST_DIR",
				imageDistPath: "dist/no-patches",
				buildScript: "scripts/build-no-patches.ts",
				buildSites: ["containers/control/Dockerfile"],
				docsDecisionRef: "docs/decisions/997-no-patches.md",
			});
			await writeFile(manifestPath, JSON.stringify(manifest));

			await expect(applyVendorPatches("no-patches", repoRoot)).rejects.toThrow(
				/has no submodulePath\/patchesDir/,
			);
		} finally {
			await rm(repoRoot, { recursive: true, force: true });
		}
	});
});
