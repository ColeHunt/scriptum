import { readFile } from "node:fs/promises";

export type WorkerUserDataParams = {
	storagePrivateIp: string;
	mountPoint: string;
	remoteExportPath: string;
};

/**
 * Renders deploy/digitalocean/worker-user-data.yaml.tmpl's placeholders into
 * a real cloud-init document, ready to pass as
 * DigitalOceanFleetProvisionerOptions.userData - see decision 048, design
 * point #9. Plain string substitution, not Terraform's templatefile(): this
 * runs at fleet-creation time from the head's own process (once per new
 * worker), not from a one-time `terraform apply` - unlike
 * storage-node-user-data.yaml.tftpl, which really is Terraform-rendered
 * since the storage node is a one-time resource.
 */
export async function renderWorkerUserData(
	templatePath: string,
	params: WorkerUserDataParams,
): Promise<string> {
	const template = await readFile(templatePath, "utf8");
	const rendered = template
		// biome-ignore lint/suspicious/noTemplateCurlyInString: matches literal cloud-init placeholder text, not a JS template literal
		.replaceAll("${storage_private_ip}", params.storagePrivateIp)
		// biome-ignore lint/suspicious/noTemplateCurlyInString: matches literal cloud-init placeholder text, not a JS template literal
		.replaceAll("${mount_point}", params.mountPoint)
		// biome-ignore lint/suspicious/noTemplateCurlyInString: matches literal cloud-init placeholder text, not a JS template literal
		.replaceAll("${remote_export_path}", params.remoteExportPath);

	const unresolved = rendered.match(/\$\{[a-z_]+\}/);
	if (unresolved) {
		throw new Error(
			`worker-user-data template has an unresolved placeholder: ${unresolved[0]}. ` +
				// biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder syntax in the error message, not a JS template literal
				"Check WorkerUserDataParams covers every ${...} in worker-user-data.yaml.tmpl.",
		);
	}

	return rendered;
}
