import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { checkVendorManifest } from "./check-vendor-manifest";

const repoRoot = resolve(import.meta.dirname, "..");

async function writeFixtureFile(
	root: string,
	relativePath: string,
	contents: string,
) {
	const path = resolve(root, relativePath);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, contents, "utf8");
}

/** A minimal, internally-consistent fixture tree, mirroring what check-vendor-manifest
 * expects for one submodule tool ("widget") and one clone tool ("gadget"). Tests
 * mutate a copy of this to introduce exactly one class of drift at a time. */
async function writeConsistentFixture(root: string): Promise<void> {
	await writeFixtureFile(
		root,
		"vendor/tools.json",
		JSON.stringify({
			schemaVersion: 1,
			tools: [
				{
					id: "widget",
					displayName: "Widget",
					kind: "submodule",
					repoUrl: "https://example.com/widget.git",
					pin: "v1.0.0",
					submodulePath: "vendor/widget",
					patchesDir: "patches/widget",
					license: "MIT",
					distDirEnvVar: "FRC_WIDGET_DIST_DIR",
					imageDistPath: "dist/widget",
					buildScript: "scripts/build-widget.ts",
					buildSites: ["containers/control/Dockerfile"],
					docsDecisionRef: "docs/decisions/999-widget.md",
				},
				{
					id: "gadget",
					displayName: "Gadget",
					kind: "clone",
					repoUrl: "https://example.com/gadget.git",
					pin: "deadbeef",
					license: "BSD-3-Clause",
					distDirEnvVar: "FRC_GADGET_DIST_DIR",
					imageDistPath: "dist/gadget",
					buildScript: "scripts/build-gadget.ts",
					buildSites: ["containers/control/Dockerfile"],
					docsDecisionRef: "docs/decisions/998-gadget.md",
				},
			],
		}),
	);
	await writeFixtureFile(
		root,
		".gitmodules",
		`[submodule "vendor/widget"]\n\tpath = vendor/widget\n\turl = https://example.com/widget.git\n`,
	);
	await writeFixtureFile(
		root,
		"THIRD_PARTY_NOTICES.md",
		"## Widget\n...\n## Gadget\n...\n",
	);
	await writeFixtureFile(root, "patches/widget/README.md", "Widget patches.\n");
	await writeFixtureFile(
		root,
		".env.example",
		"FRC_WIDGET_DIST_DIR=dist/widget\nFRC_GADGET_DIST_DIR=dist/gadget\n",
	);
	await writeFixtureFile(
		root,
		"apps/control/src/config.ts",
		"const x = { FRC_WIDGET_DIST_DIR: 1, FRC_GADGET_DIST_DIR: 2 };\n",
	);
	await writeFixtureFile(
		root,
		"containers/control/Dockerfile",
		"ARG GADGET_COMMIT=deadbeef\nCOPY --from=x / dist/widget\nCOPY --from=y / dist/gadget\n",
	);
}

async function withFixture(
	mutate: (root: string) => Promise<void>,
): Promise<string[]> {
	const dir = await mkdtemp(resolve(tmpdir(), "vendor-manifest-fixture-"));
	try {
		await writeConsistentFixture(dir);
		await mutate(dir);
		return await checkVendorManifest(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

describe("checkVendorManifest", () => {
	test("passes for the real repo's current vendor/tools.json", async () => {
		expect(await checkVendorManifest(repoRoot)).toEqual([]);
	});

	test("passes for an internally-consistent fixture", async () => {
		const errors = await withFixture(async () => {});
		expect(errors).toEqual([]);
	});

	test("flags a submodule tool missing from .gitmodules", async () => {
		const errors = await withFixture(async (root) => {
			await writeFixtureFile(root, ".gitmodules", "");
		});
		expect(errors).toEqual([
			expect.stringContaining(
				'widget: .gitmodules has no submodule at "vendor/widget"',
			),
		]);
	});

	test("flags a tool missing from THIRD_PARTY_NOTICES.md", async () => {
		const errors = await withFixture(async (root) => {
			await writeFixtureFile(
				root,
				"THIRD_PARTY_NOTICES.md",
				"## Widget\n...\n",
			);
		});
		expect(errors).toEqual([
			expect.stringContaining(
				'gadget: THIRD_PARTY_NOTICES.md has no mention of "Gadget"',
			),
		]);
	});

	test("flags a missing patches README when patchesDir is set", async () => {
		const errors = await withFixture(async (root) => {
			await rm(resolve(root, "patches/widget/README.md"));
		});
		expect(errors).toEqual([
			expect.stringContaining(
				"widget: expected patches/widget/README.md to exist",
			),
		]);
	});

	test("flags a distDirEnvVar missing from .env.example or config.ts", async () => {
		const errors = await withFixture(async (root) => {
			await writeFixtureFile(
				root,
				".env.example",
				"FRC_WIDGET_DIST_DIR=dist/widget\n",
			);
		});
		expect(errors).toEqual([
			expect.stringContaining(
				".env.example has no mention of FRC_GADGET_DIST_DIR",
			),
		]);
	});

	test("flags imageDistPath missing from every buildSite", async () => {
		const errors = await withFixture(async (root) => {
			await writeFixtureFile(
				root,
				"containers/control/Dockerfile",
				"ARG GADGET_COMMIT=deadbeef\nCOPY --from=x / dist/widget\n",
			);
		});
		expect(errors).toEqual([
			expect.stringContaining("gadget: none of its buildSites"),
		]);
	});

	test("flags a clone tool's pin drifting out of a buildSite", async () => {
		const errors = await withFixture(async (root) => {
			await writeFixtureFile(
				root,
				"containers/control/Dockerfile",
				"ARG GADGET_COMMIT=stale-commit\nCOPY --from=x / dist/widget\nCOPY --from=y / dist/gadget\n",
			);
		});
		expect(errors).toEqual([
			expect.stringContaining(
				'gadget: containers/control/Dockerfile does not reference pin "deadbeef"',
			),
		]);
	});

	test("flags a buildSite file that does not exist", async () => {
		const errors = await withFixture(async (root) => {
			await rm(resolve(root, "containers/control/Dockerfile"));
		});
		// Both tools list the same missing buildSite, plus the resulting
		// "no site references imageDistPath" fallout for each.
		expect(
			errors.some((e) =>
				e.includes('buildSite "containers/control/Dockerfile" does not exist'),
			),
		).toBe(true);
	});
});
