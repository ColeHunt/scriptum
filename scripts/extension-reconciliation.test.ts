import { afterEach, describe, expect, test } from "bun:test";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const reconcileScript = resolve(
	repoRoot,
	"containers/code/reconcile-extensions.sh",
);
const temporaryRoots: string[] = [];

interface ExtensionRecord {
	identifier: { id: string };
	version: string;
	relativeLocation: string;
	location: { path: string; scheme: string; $mid: number };
	metadata: { pinned: boolean; source: string };
}

function record(id: string, version: string, root: string): ExtensionRecord {
	const relativeLocation = `${id}-${version}`;
	return {
		identifier: { id },
		version,
		relativeLocation,
		location: {
			$mid: 1,
			path: join(root, relativeLocation),
			scheme: "file",
		},
		metadata: { pinned: true, source: "vsix" },
	};
}

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "scriptum-extensions-"));
	temporaryRoots.push(root);
	const cache = join(root, "cache");
	const target = join(root, "target");
	await mkdir(cache, { recursive: true });
	await mkdir(target, { recursive: true });

	const baked = [
		record("redhat.java", "1.55.0", cache),
		record("vscjava.vscode-java-test", "0.46.0", cache),
	];
	for (const extension of baked) {
		await mkdir(join(cache, extension.relativeLocation));
		await writeFile(
			join(cache, extension.relativeLocation, "version.txt"),
			extension.version,
		);
	}
	await writeFile(join(cache, "extensions.json"), `${JSON.stringify(baked)}\n`);
	await chmod(reconcileScript, 0o755);

	return { baked, cache, target };
}

async function reconcile(cache: string, target: string): Promise<string> {
	const process = Bun.spawn([reconcileScript, cache, target], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		process.exited,
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
	]);
	if (exitCode !== 0) throw new Error(stderr);
	return stdout.trim();
}

async function manifest(target: string): Promise<ExtensionRecord[]> {
	return JSON.parse(await readFile(join(target, "extensions.json"), "utf8"));
}

afterEach(async () => {
	await Promise.all(
		temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
	);
});

describe("workspace extension reconciliation", () => {
	test("seeds a fresh empty extension directory", async () => {
		const { baked, cache, target } = await fixture();

		expect(await reconcile(cache, target)).toBe("changed");
		expect(
			(await manifest(target)).map(({ identifier, version }) => [
				identifier.id,
				version,
			]),
		).toEqual(baked.map(({ identifier, version }) => [identifier.id, version]));
		for (const extension of baked) {
			expect(
				await readFile(
					join(target, extension.relativeLocation, "version.txt"),
					"utf8",
				),
			).toBe(extension.version);
		}
	});

	test("replaces old CodeRunner-managed versions", async () => {
		const { baked, cache, target } = await fixture();
		const old = [
			record("redhat.java", "1.38.0", target),
			record("vscjava.vscode-java-test", "0.45.0", target),
		];
		for (const extension of old) {
			await mkdir(join(target, extension.relativeLocation));
		}
		await writeFile(
			join(target, "extensions.json"),
			`${JSON.stringify(old)}\n`,
		);

		expect(await reconcile(cache, target)).toBe("changed");
		expect(
			(await manifest(target)).map(({ identifier, version }) => [
				identifier.id,
				version,
			]),
		).toEqual(baked.map(({ identifier, version }) => [identifier.id, version]));
		for (const extension of old) {
			expect(
				await Bun.file(join(target, extension.relativeLocation)).exists(),
			).toBe(false);
		}
	});

	test("preserves an unrelated student-installed extension", async () => {
		const { cache, target } = await fixture();
		const userExtension = record("student.favorite-theme", "2.4.0", target);
		await mkdir(join(target, userExtension.relativeLocation));
		await writeFile(
			join(target, userExtension.relativeLocation, "student-data.txt"),
			"preserve me\n",
		);
		await writeFile(
			join(target, "extensions.json"),
			`${JSON.stringify([userExtension])}\n`,
		);
		await writeFile(
			join(target, ".obsolete"),
			`${JSON.stringify({
				"redhat.java-1.38.0": true,
				[userExtension.relativeLocation]: true,
			})}\n`,
		);

		await reconcile(cache, target);
		const records = await manifest(target);
		expect(
			records.some(
				({ identifier }) => identifier.id === userExtension.identifier.id,
			),
		).toBe(true);
		expect(
			await readFile(
				join(target, userExtension.relativeLocation, "student-data.txt"),
				"utf8",
			),
		).toBe("preserve me\n");
		expect(
			JSON.parse(await readFile(join(target, ".obsolete"), "utf8")),
		).toEqual({ [userExtension.relativeLocation]: true });
		expect(await reconcile(cache, target)).toBe("unchanged");
	});

	test("removes stale managed directories even when the manifest is current", async () => {
		const { baked, cache, target } = await fixture();
		for (const extension of baked) {
			await mkdir(join(target, extension.relativeLocation));
		}
		await writeFile(
			join(target, "extensions.json"),
			`${JSON.stringify(baked)}\n`,
		);
		const staleDirectory = join(target, "redhat.java-1.38.0");
		await mkdir(staleDirectory);

		expect(await reconcile(cache, target)).toBe("changed");
		expect(await Bun.file(staleDirectory).exists()).toBe(false);
		expect(await reconcile(cache, target)).toBe("unchanged");
	});
});
