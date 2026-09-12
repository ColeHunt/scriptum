#!/usr/bin/env bun
import { resolve } from "node:path";

// Downloads the prebuilt release artifacts (web shell + AdvantageScope Lite)
// instead of building them from source. This is the demo/quick-start path: it
// skips the emscripten-dependent `build:ascope` compile entirely by reusing the
// `ascope-dist.tar.gz` and `web-dist.tar.gz` already published on each release.
// The GCE deploy does the same thing (see .github/workflows/deploy.yml).
//
// Choreo's frontend is built (not downloaded) last via build-choreo.ts - it
// needs only Bun + Vite, already required above, so there's no prebuilt
// artifact to fetch the way there was for PathPlanner's Flutter build.

import { buildChoreo } from "./build-choreo";
import { downloadAndExtract, withScratch } from "./dist-download";

const repoRoot = resolve(import.meta.dirname, "..");

// Overridable so forks can point at their own releases.
const repo = Bun.env.DEMO_RELEASE_REPO ?? "mathewdunne/CodeRunner";

// Default to the newest published release. Pass `--tag vX.Y.Z` to pin.
const tagArgIndex = Bun.argv.indexOf("--tag");
const tag =
	tagArgIndex >= 0
		? Bun.argv[tagArgIndex + 1]
		: (Bun.env.DEMO_RELEASE_TAG ?? "");

const artifacts = [
	{
		asset: "ascope-dist.tar.gz",
		destDir: resolve(repoRoot, "dist/advantagescope"),
	},
	{ asset: "web-dist.tar.gz", destDir: resolve(repoRoot, "apps/web/dist") },
];

function downloadUrl(asset: string): string {
	const base = `https://github.com/${repo}/releases`;
	return tag
		? `${base}/download/${tag}/${asset}`
		: `${base}/latest/download/${asset}`;
}

async function main(): Promise<void> {
	console.log(
		`Fetching prebuilt dist artifacts from ${repo} (${tag || "latest release"}).`,
	);
	await withScratch(async (scratch) => {
		for (const artifact of artifacts) {
			await downloadAndExtract(
				{
					asset: artifact.asset,
					url: downloadUrl(artifact.asset),
					destDir: artifact.destDir,
					hint: `Check that release ${tag || "latest"} exists for ${repo} and includes this asset.`,
				},
				scratch,
			);
		}
	});
	await buildChoreo();
	console.log("\nPrebuilt web shell and AdvantageScope Lite assets are ready.");
}

try {
	await main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
