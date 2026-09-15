import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../apps/control/src/app";

const repoRoot = resolve(import.meta.dirname, "..");
const distDir = resolve(repoRoot, "dist", "elastic");
const elasticRoot = resolve(repoRoot, "vendor", "elastic_dashboard");
const patchDir = resolve(repoRoot, "patches", "elastic");

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

async function createCatalogDir(root: string): Promise<string> {
	const catalogDir = join(root, "catalog");
	await mkdir(catalogDir, { recursive: true });
	await writeFile(
		join(catalogDir, "modules.json"),
		JSON.stringify({ schemaVersion: 1, modules: [] }),
		"utf8",
	);
	return catalogDir;
}

async function runGit(
	args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const subprocess = Bun.spawn(["git", "-C", elasticRoot, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(subprocess.stdout).text(),
		new Response(subprocess.stderr).text(),
		subprocess.exited,
	]);
	return { exitCode, stdout, stderr };
}

async function verifyPatchFiles(): Promise<void> {
	const patches = (await readdir(patchDir, { withFileTypes: true }))
		.filter((entry) => entry.isFile() && entry.name.endsWith(".patch"))
		.map((entry) => resolve(patchDir, entry.name))
		.sort((left, right) => left.localeCompare(right));
	assert(
		patches.length > 0,
		`No Elastic Dashboard patches found in ${patchDir}.`,
	);

	for (const patch of patches) {
		const check = await runGit(["apply", "--check", patch]);
		if (check.exitCode === 0) {
			continue;
		}

		const reverseCheck = await runGit(["apply", "--reverse", "--check", patch]);
		assert(
			reverseCheck.exitCode === 0,
			`Patch ${patch} is neither cleanly applicable nor already applied: ${check.stderr || reverseCheck.stderr}`,
		);
	}
}

async function verifyStagedBundle(): Promise<void> {
	assert(
		await exists(resolve(distDir, "index.html")),
		"dist/elastic/index.html is missing. Run bun run build:elastic.",
	);
	assert(
		await exists(resolve(distDir, "main.dart.js")),
		"dist/elastic/main.dart.js is missing. Run bun run build:elastic.",
	);

	const mainBundle = await readFile(resolve(distDir, "main.dart.js"), "utf8");
	// Both strings are literal endpoint paths from lib/services/coderunner_embed.dart
	// (patches/elastic/001-coderunner-integration.patch) - unlike the Dart
	// identifier names around them, these survive release-build minification
	// since they're runtime string literals, not symbols.
	assert(
		mainBundle.includes("sim/nt4?app=Elastic"),
		"Elastic main.dart.js is missing the CodeRunner NT4 endpoint override (coderunnerNt4Endpoint()).",
	);
	assert(
		mainBundle.includes("api/elastic-layout"),
		"Elastic main.dart.js is missing the CodeRunner layout persistence API calls (coderunnerFetchLayout()/coderunnerPersistLayout()).",
	);
}

async function verifyElasticServing(): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "frc-elastic-"));
	const catalogDir = await createCatalogDir(root);
	const webDistDir = join(root, "web-dist");
	await mkdir(webDistDir, { recursive: true });
	await writeFile(
		join(webDistDir, "index.html"),
		"<!doctype html><html></html>",
		"utf8",
	);

	const app = await createApp({
		dataDir: join(root, "data"),
		catalogDir,
		// See withApp() in apps/control/src/__tests__/helpers.ts - Bun
		// auto-loads .env, so these must be pinned to avoid a developer's real
		// local settings silently changing this smoke test's behavior.
		catalogRepo: "",
		demo: false,
		webDistDir,
		elasticDistDir: distDir,
		containerAutoStart: false,
		ssoSecret: "verify-elastic-sso-secret",
	});

	try {
		const index = await app.fetch(new Request("http://localhost/elastic/"));
		assert(index.status === 200, `/elastic/ returned ${index.status}.`);
		assert(
			(index.headers.get("content-type") ?? "").includes("text/html"),
			"/elastic/ did not serve HTML.",
		);

		const main = await app.fetch(
			new Request("http://localhost/elastic/main.dart.js"),
		);
		assert(
			main.status === 200,
			`/elastic/main.dart.js returned ${main.status}.`,
		);
		assert(
			(main.headers.get("content-type") ?? "").includes("text/javascript"),
			"main.dart.js content type is wrong.",
		);
	} finally {
		app.close();
		await rm(root, { recursive: true, force: true });
	}
}

try {
	await verifyPatchFiles();
	await verifyStagedBundle();
	await verifyElasticServing();
	console.log("Elastic Dashboard patch and /elastic/ serving smoke passed.");
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
