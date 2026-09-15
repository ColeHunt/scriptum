// Build or pull Scriptum's Docker images under their canonical names:
//   ${SCRIPTUM_IMAGE_NS:-ghcr.io/mathewdunne}/coderunner-<kind>:${SCRIPTUM_TAG:-latest}
//
// Usage: bun scripts/image.ts <build|pull> <workspace|control>
//
// The image name itself is still literally "coderunner-<kind>", not
// "scriptum-<kind>" — that's the currently-published GHCR artifact name
// (upstream's own release channel, unrelated to this repo's own rename).
// Renaming it here would just point the default at an image that doesn't
// exist. See decision 049 for the full rename scope and this deliberate
// exception.
//
// The same name resolution is used by docker-compose.yml and the control
// plane's codeImage default, so a local build is picked up directly by
// `docker compose up` — no re-tagging step. CODE_IMAGE overrides the
// workspace image name outright (matching the control plane).

const dockerPath = Bun.env.FRC_DOCKER_PATH ?? "docker";

const dockerfiles = {
	workspace: "containers/code/Dockerfile",
	control: "containers/control/Dockerfile",
} as const;

type Kind = keyof typeof dockerfiles;

function imageName(kind: Kind): string {
	if (kind === "workspace" && Bun.env.CODE_IMAGE) return Bun.env.CODE_IMAGE;
	const ns = Bun.env.SCRIPTUM_IMAGE_NS ?? "ghcr.io/mathewdunne";
	const tag = Bun.env.SCRIPTUM_TAG ?? "latest";
	return `${ns}/coderunner-${kind}:${tag}`;
}

const [command, kind] = Bun.argv.slice(2);
if ((command !== "build" && command !== "pull") || !(kind! in dockerfiles)) {
	console.error("Usage: bun scripts/image.ts <build|pull> <workspace|control>");
	process.exit(2);
}

const image = imageName(kind as Kind);
const args =
	command === "build"
		? ["build", "-f", dockerfiles[kind as Kind], "-t", image, "."]
		: ["pull", image];

console.log(`${command === "build" ? "Building" : "Pulling"} ${image}`);

const subprocess = Bun.spawn([dockerPath, ...args], {
	stdout: "inherit",
	stderr: "inherit",
});

const exitCode = await subprocess.exited;
if (exitCode !== 0) {
	console.error(`docker ${args.join(" ")} failed with exit code ${exitCode}`);
	process.exit(exitCode);
}

export {};
