import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDockerCli } from "./docker-client";

/**
 * `dockerEnv` is what fleet/remote-docker-runtime-provider.ts uses to target
 * a worker's daemon over SSH (DOCKER_HOST) - see docs/decisions/048. These
 * tests verify the plumbing with a fake "docker" script instead of a real
 * Docker install, since the point is to check what env the subprocess
 * receives, not real Docker behavior.
 */
describe("runDockerCli dockerEnv", () => {
	async function fakeDockerThatEchoesEnv(varName: string): Promise<string> {
		const dir = await mkdtemp(join(tmpdir(), "frc-fake-docker-"));
		const path = join(dir, "docker");
		await writeFile(path, `#!/bin/sh\necho "$${varName}"\n`, "utf8");
		await chmod(path, 0o755);
		return path;
	}

	test("merges dockerEnv onto the subprocess environment", async () => {
		const dockerPath = await fakeDockerThatEchoesEnv("DOCKER_HOST");
		const result = await runDockerCli(
			dockerPath,
			[],
			{},
			{
				DOCKER_HOST: "ssh://coderunner-agent@10.0.0.5",
			},
		);
		expect(result.stdout.trim()).toBe("ssh://coderunner-agent@10.0.0.5");
	});

	test("without dockerEnv, the subprocess still inherits the parent environment", async () => {
		const dockerPath = await fakeDockerThatEchoesEnv("PATH");
		const result = await runDockerCli(dockerPath, []);
		// Bun.spawn's default (no env option passed) inherits process.env, so
		// PATH should be non-empty - proof existing callers are unaffected.
		expect(result.stdout.trim().length).toBeGreaterThan(0);
	});
});
