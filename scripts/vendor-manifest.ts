// Typed access to vendor/tools.json, the single source of truth for how each
// vendored third-party tool (AdvantageScope, Elastic Dashboard, Choreo) is
// pinned, patched, built, and served. Build/CI tooling only — no runtime
// control-plane or web code depends on this file, so it lives alongside the
// other build scripts rather than in packages/contracts.
//
// Deliberately dependency-free (hand-rolled validation, not zod): scripts
// under scripts/ run directly via `bun <file>.ts` with no workspace install
// guaranteed (apply-vendor-patches.ts in particular also runs inside
// containers/control/Dockerfile's minimal `ascope-build` stage, which never
// runs `bun install`), so nothing here should assume node_modules exists.
//
// See docs/decisions/043-vendor-tool-manifest.md.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
export const VENDOR_MANIFEST_PATH = resolve(repoRoot, "vendor", "tools.json");

export type VendorTool = {
	id: string;
	displayName: string;
	kind: "submodule" | "clone";
	repoUrl: string;
	/** Git tag, ref, or commit SHA the tool is pinned to. */
	pin: string;
	/** Set when kind is "submodule" — the .gitmodules path. */
	submodulePath?: string;
	/** Directory of *.patch files applied on top of the vendored source, if any. */
	patchesDir?: string;
	license: string;
	/** Env var (documented in .env.example) that overrides where the built dist is read from. */
	distDirEnvVar: string;
	/** Where the built dist lands inside the control image, relative to the repo root. */
	imageDistPath: string;
	/** Script that produces the dist at imageDistPath. */
	buildScript: string;
	/** Dockerfiles (or other build sites) that reference this tool. */
	buildSites: string[];
	/** Decision doc recording why this tool is vendored the way it is. */
	docsDecisionRef: string;
};

export type VendorToolManifest = {
	schemaVersion: 1;
	tools: VendorTool[];
};

const REQUIRED_STRING_FIELDS = [
	"id",
	"displayName",
	"repoUrl",
	"pin",
	"license",
	"distDirEnvVar",
	"imageDistPath",
	"buildScript",
	"docsDecisionRef",
] as const;

function assertValidTool(value: unknown, index: number): VendorTool {
	if (typeof value !== "object" || value === null) {
		throw new Error(`vendor/tools.json: tools[${index}] is not an object.`);
	}
	const tool = value as Record<string, unknown>;

	for (const field of REQUIRED_STRING_FIELDS) {
		if (typeof tool[field] !== "string" || tool[field] === "") {
			throw new Error(
				`vendor/tools.json: tools[${index}].${field} must be a non-empty string.`,
			);
		}
	}
	if (tool.kind !== "submodule" && tool.kind !== "clone") {
		throw new Error(
			`vendor/tools.json: tools[${index}].kind must be "submodule" or "clone", got ${JSON.stringify(tool.kind)}.`,
		);
	}
	if (
		!Array.isArray(tool.buildSites) ||
		tool.buildSites.length === 0 ||
		!tool.buildSites.every((site) => typeof site === "string" && site !== "")
	) {
		throw new Error(
			`vendor/tools.json: tools[${index}].buildSites must be a non-empty array of strings.`,
		);
	}
	if (
		tool.submodulePath !== undefined &&
		(typeof tool.submodulePath !== "string" || tool.submodulePath === "")
	) {
		throw new Error(
			`vendor/tools.json: tools[${index}].submodulePath must be a non-empty string when present.`,
		);
	}
	if (
		tool.patchesDir !== undefined &&
		(typeof tool.patchesDir !== "string" || tool.patchesDir === "")
	) {
		throw new Error(
			`vendor/tools.json: tools[${index}].patchesDir must be a non-empty string when present.`,
		);
	}

	return tool as VendorTool;
}

export async function loadVendorManifest(
	manifestPath: string = VENDOR_MANIFEST_PATH,
): Promise<VendorToolManifest> {
	const raw = JSON.parse(await readFile(manifestPath, "utf8")) as {
		schemaVersion?: unknown;
		tools?: unknown;
	};
	if (raw.schemaVersion !== 1) {
		throw new Error(
			`vendor/tools.json: expected schemaVersion 1, got ${JSON.stringify(raw.schemaVersion)}.`,
		);
	}
	if (!Array.isArray(raw.tools) || raw.tools.length === 0) {
		throw new Error("vendor/tools.json: tools must be a non-empty array.");
	}
	return {
		schemaVersion: 1,
		tools: raw.tools.map((tool, index) => assertValidTool(tool, index)),
	};
}

export async function getVendorTool(
	id: string,
	manifestPath: string = VENDOR_MANIFEST_PATH,
): Promise<VendorTool> {
	const manifest = await loadVendorManifest(manifestPath);
	const tool = manifest.tools.find((entry) => entry.id === id);
	if (!tool) {
		throw new Error(
			`No vendor tool "${id}" in ${manifestPath}. Known ids: ${manifest.tools
				.map((entry) => entry.id)
				.join(", ")}`,
		);
	}
	return tool;
}
