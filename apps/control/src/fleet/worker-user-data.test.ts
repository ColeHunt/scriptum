import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { renderWorkerUserData } from "./worker-user-data";

// Renders the REAL template file at its real repo path - catches drift
// between this code's placeholder names and worker-user-data.yaml.tmpl's,
// which a synthetic in-test template string would not.
const TEMPLATE_PATH = resolve(
	import.meta.dirname,
	"../../../../deploy/digitalocean/worker-user-data.yaml.tmpl",
);

describe("renderWorkerUserData", () => {
	test("substitutes every placeholder in the real template file", async () => {
		const rendered = await renderWorkerUserData(TEMPLATE_PATH, {
			storagePrivateIp: "10.10.0.5",
			mountPoint: "/mnt/coderunner-data",
			remoteExportPath: "/mnt/coderunner-data/users",
		});

		expect(rendered).toContain(
			"10.10.0.5:/mnt/coderunner-data/users /mnt/coderunner-data nfs4",
		);
		expect(rendered).not.toMatch(/\$\{[a-z_]+\}/);
	});

	test("throws instead of silently shipping an unresolved placeholder", async () => {
		const dir = await mkdtemp(join(tmpdir(), "frc-worker-user-data-"));
		const path = join(dir, "template.yaml.tmpl");
		try {
			await Bun.write(
				path,
				// biome-ignore lint/suspicious/noTemplateCurlyInString: fake template file content, not a JS template literal
				"runcmd: [mount ${mount_point}, echo ${unknown_key}]\n",
			);

			await expect(
				renderWorkerUserData(path, {
					storagePrivateIp: "10.10.0.5",
					mountPoint: "/mnt/coderunner-data",
					remoteExportPath: "/mnt/coderunner-data/users",
				}),
			).rejects.toThrow(/unresolved placeholder/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
