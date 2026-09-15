// Applies a vendored tool's source-level patches (patches/<tool>/*.patch) to
// its git submodule worktree, idempotently. Replaces what used to be two
// near-identical copies of this logic (apply-ascope-patches.ts,
// apply-elastic-patches.ts) — the tool-specific bits (submodule path, patch
// dir) now come from vendor/tools.json instead of being hand-duplicated.
//
// Deliberately dependency-free (reads vendor/tools.json with a plain
// JSON.parse, not the zod-validated loader in vendor-manifest.ts): this
// script also runs inside containers/control/Dockerfile's `ascope-build`
// stage, which copies in only vendor/, patches/, and this script — no
// `bun install`, so no node_modules/zod available there. Other vendor
// tooling (check-vendor-manifest.ts, image.ts, build-choreo.ts) always runs
// with a full install and should prefer vendor-manifest.ts's typed loader.
//
// Usage: bun scripts/apply-vendor-patches.ts --tool=<id>
// See docs/decisions/043-vendor-tool-manifest.md.

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const defaultRepoRoot = resolve(import.meta.dirname, "..");

type MinimalVendorTool = {
	id: string;
	displayName: string;
	submodulePath?: string;
	patchesDir?: string;
};

async function readVendorTool(
	id: string,
	manifestPath: string,
): Promise<MinimalVendorTool> {
	const raw = JSON.parse(await readFile(manifestPath, "utf8")) as {
		tools?: unknown;
	};
	const tools = Array.isArray(raw.tools)
		? (raw.tools as MinimalVendorTool[])
		: [];
	const tool = tools.find((entry) => entry?.id === id);
	if (!tool) {
		throw new Error(
			`No vendor tool "${id}" in ${manifestPath}. Known ids: ${tools
				.map((entry) => entry?.id)
				.join(", ")}`,
		);
	}
	return tool;
}

type CommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

async function run(
	submoduleRoot: string,
	args: string[],
	allowFailure = false,
): Promise<CommandResult> {
	const subprocess = Bun.spawn(["git", "-C", submoduleRoot, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(subprocess.stdout).text(),
		new Response(subprocess.stderr).text(),
		subprocess.exited,
	]);

	if (!allowFailure && exitCode !== 0) {
		const detail = stderr.trim() || stdout.trim() || `exit ${exitCode}`;
		throw new Error(
			`git -C ${submoduleRoot} ${args.join(" ")} failed: ${detail}`,
		);
	}

	return { exitCode, stdout, stderr };
}

async function patchFiles(patchDir: string): Promise<string[]> {
	const entries = await readdir(patchDir, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".patch"))
		.map((entry) => resolve(patchDir, entry.name))
		.sort((left, right) => left.localeCompare(right));
}

/**
 * Applies every *.patch file in a vendor tool's patches dir to its submodule
 * worktree, in order. Safe to call repeatedly on an already-fully-patched
 * tree: skipped as a whole rather than per patch (see the whole-series check
 * below for why per-patch detection doesn't work when patches touch
 * overlapping files across patch boundaries, which is common - e.g. patch 2
 * further modifying a file patch 1 already created).
 *
 * `repoRoot` defaults to this repo, and only exists as a parameter so tests
 * can point it at a throwaway fixture tree instead.
 */
export async function applyVendorPatches(
	toolId: string,
	repoRoot: string = defaultRepoRoot,
): Promise<void> {
	const manifestPath = resolve(repoRoot, "vendor", "tools.json");
	const tool = await readVendorTool(toolId, manifestPath);
	if (!tool.submodulePath || !tool.patchesDir) {
		throw new Error(
			`Vendor tool "${toolId}" has no submodulePath/patchesDir in vendor/tools.json - nothing to patch.`,
		);
	}
	const submoduleRoot = resolve(repoRoot, tool.submodulePath);
	const patchDir = resolve(repoRoot, tool.patchesDir);

	const patches = await patchFiles(patchDir);
	if (patches.length === 0) {
		throw new Error(`No ${tool.displayName} patches found in ${patchDir}.`);
	}

	// Whole-series idempotency check, not per-patch: testing "can patch 1
	// itself be reversed" is unreliable once a later patch has further
	// modified a file patch 1 touched (the tree is no longer in patch 1's
	// own post-apply state, even though patch 1 genuinely is applied - this
	// bit both AdvantageScope's and Choreo's real patch chains, both of
	// which have exactly this shape). Reversing the LAST patch instead is
	// reliable: it only succeeds if the tree is in the series' final state,
	// which requires every earlier patch's preconditions to already have
	// held when the series was first applied in order.
	const lastPatch = patches[patches.length - 1]!;
	const lastReverseCheck = await run(
		submoduleRoot,
		["apply", "--reverse", "--check", lastPatch],
		true,
	);
	if (lastReverseCheck.exitCode === 0) {
		console.log(
			`Already applied all ${patches.length} ${tool.displayName} patches`,
		);
		return;
	}

	for (const patch of patches) {
		const check = await run(submoduleRoot, ["apply", "--check", patch], true);
		if (check.exitCode !== 0) {
			const detail =
				check.stderr.trim() ||
				check.stdout.trim() ||
				"patch did not apply cleanly";
			throw new Error(`Unable to apply ${patch}: ${detail}`);
		}
		await run(submoduleRoot, ["apply", patch]);
		console.log(`Applied ${patch}`);
	}
}

function parseToolArg(argv: string[]): string {
	const flag = argv.find((arg) => arg.startsWith("--tool="));
	const tool = flag?.slice("--tool=".length);
	if (!tool) {
		console.error("Usage: bun scripts/apply-vendor-patches.ts --tool=<id>");
		process.exit(2);
	}
	return tool;
}

if (import.meta.main) {
	try {
		await applyVendorPatches(parseToolArg(Bun.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
