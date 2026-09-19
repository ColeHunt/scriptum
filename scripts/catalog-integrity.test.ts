import { describe, expect, test } from "bun:test";
import { access, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BundledCatalogSource } from "../apps/control/src/catalog";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const catalogRoot = resolve(repoRoot, "catalog");

async function expectCatalogFile(relativePath: string): Promise<void> {
	const path = resolve(catalogRoot, relativePath);
	await access(path);
	const fileStat = await stat(path);
	expect(fileStat.isFile()).toBe(true);
	expect(fileStat.size).toBeGreaterThan(0);
}

// Loaded once via the real BundledCatalogSource - the same index +
// modules-meta/<id>.json merge production uses - rather than hand-parsing
// modules.json, so this test actually exercises the on-disk split format
// (decision 051), not just the schema shape.
const source = new BundledCatalogSource(catalogRoot);
const { modules: catalogModules, error: catalogError } =
	await source.getManifest();

describe("bundled lesson catalog", () => {
	test("loads cleanly through BundledCatalogSource", () => {
		expect(catalogError).toBeNull();
	});

	test("modules.json + modules-meta/*.json list the expected module ids", () => {
		const ids = catalogModules.map((module) => module.id).sort();
		// The bundled catalog is a minimal zero-config/offline demo, not the full
		// curriculum - git-basics, the rest of the Java Basics track, and the
		// advantagescope-intro/elastic-intro tool lessons live in the external
		// lessons repo LESSONS_CATALOG_REPO points a real deployment at. See
		// docs/decisions/029-lessons-and-modules.md and
		// docs/decisions/044-remote-catalog-checkpoints.md.
		expect(ids).toEqual(["hello-world", "robot-starter"]);
	});

	test("every module subdir exists and is non-empty", async () => {
		for (const module of catalogModules) {
			const subdirPath = resolve(catalogRoot, module.subdir);
			const subdirStat = await stat(subdirPath);
			expect(subdirStat.isDirectory()).toBe(true);
			const entries = await readdir(subdirPath);
			expect(entries.length).toBeGreaterThan(0);
		}
	});

	test("hello-world plain-java module ships its sources and launch config", async () => {
		await Promise.all([
			expectCatalogFile("modules/hello-world/src/Main.java"),
			expectCatalogFile("modules/hello-world/.vscode/launch.json"),
		]);
	});

	test("robot-starter is a complete buildable robot project with a lesson README", async () => {
		await Promise.all([
			expectCatalogFile("modules/robot-starter/build.gradle"),
			expectCatalogFile("modules/robot-starter/gradlew"),
			expectCatalogFile(
				"modules/robot-starter/gradle/wrapper/gradle-wrapper.jar",
			),
			expectCatalogFile(
				"modules/robot-starter/vendordeps/WPILibNewCommands.json",
			),
			expectCatalogFile("modules/robot-starter/README.md"),
			expectCatalogFile(
				"modules/robot-starter/src/main/java/frc/robot/Robot.java",
			),
		]);
	});

	test("every checkpoint's verifier script exists and checkpoint ids are unique", async () => {
		for (const module of catalogModules) {
			const ids = module.checkpoints.map((c) => c.id);
			expect(new Set(ids).size).toBe(ids.length);

			for (const checkpoint of module.checkpoints) {
				if (checkpoint.verifier.type === "script") {
					await expectCatalogFile(checkpoint.verifier.path);
					// Checkpoint scripts live outside the module subdir that gets
					// copied into the student's project - otherwise they'd be
					// readable/editable right in the workspace Explorer, not just
					// from a terminal `cat`.
					expect(checkpoint.verifier.path.startsWith(`${module.subdir}/`)).toBe(
						false,
					);
				} else if (checkpoint.verifier.type === "nt4-value") {
					// Checked live against a running robot by the control plane -
					// no file to check exists on disk.
					expect(checkpoint.verifier.topic.length).toBeGreaterThan(0);
				}
			}
		}
	});
});
