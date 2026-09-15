import {
	cp,
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
	dirname,
	extname,
	isAbsolute,
	relative,
	resolve,
	sep,
} from "node:path";
import { unzipSync } from "fflate";
import { requireSession } from "../auth/middleware";
import type { AppStorage } from "../storage";
import { htmlResponse, jsonResponse, notFound, redirect } from "./responses";

export function contentTypeFor(path: string): string {
	switch (extname(path).toLowerCase()) {
		case ".css":
			return "text/css; charset=utf-8";
		case ".html":
			return "text/html; charset=utf-8";
		case ".js":
		case ".mjs":
			return "text/javascript; charset=utf-8";
		case ".json":
			return "application/json; charset=utf-8";
		case ".ico":
			return "image/x-icon";
		case ".png":
			return "image/png";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".webp":
			return "image/webp";
		case ".svg":
			return "image/svg+xml";
		case ".glb":
			return "model/gltf-binary";
		case ".woff":
			return "font/woff";
		case ".woff2":
			return "font/woff2";
		case ".wasm":
			return "application/wasm";
		default:
			return "application/octet-stream";
	}
}

export function isInsideDirectory(root: string, target: string): boolean {
	const relativePath = relative(root, target);
	return (
		relativePath === "" ||
		(!relativePath.startsWith("..") && !isAbsolute(relativePath))
	);
}

export function safeRelativeAssetPath(value: string): string | null {
	if (
		value.length === 0 ||
		value.length > 512 ||
		value.startsWith("/") ||
		value.startsWith("\\") ||
		/^[a-zA-Z]:/.test(value) ||
		value.includes("\\") ||
		// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — rejects control chars in asset paths
		/[\u0000-\u001f\u007f]/.test(value)
	) {
		return null;
	}

	const segments = value.split("/");
	if (
		segments.some(
			(segment) => segment.length === 0 || segment === "." || segment === "..",
		)
	) {
		return null;
	}
	return value;
}

export async function staticFileResponse(
	root: string,
	path: string,
): Promise<Response> {
	const target = resolve(root, path);
	if (!isInsideDirectory(root, target)) {
		return new Response("Static asset path is outside the web shell.", {
			status: 403,
		});
	}

	try {
		const targetStats = await stat(target);
		if (!targetStats.isFile()) {
			return notFound();
		}
	} catch {
		return notFound();
	}

	const file = Bun.file(target);
	if (!(await file.exists())) {
		return notFound();
	}

	return new Response(file, {
		headers: {
			"content-type": contentTypeFor(target),
		},
	});
}

export async function webShellResponse(storage: AppStorage): Promise<Response> {
	try {
		const indexHtml = await readFile(
			resolve(storage.config.webDistDir, "index.html"),
			"utf8",
		);
		return htmlResponse(indexHtml);
	} catch {
		return htmlResponse(
			"The V2 web shell has not been built yet. Run `bun run build:web` before starting the control plane.",
			{ status: 503 },
		);
	}
}

export async function webAssetResponse(
	storage: AppStorage,
	rawPath: string,
): Promise<Response> {
	let assetPath: string;
	try {
		assetPath = decodeURIComponent(rawPath);
	} catch {
		return new Response("Invalid static asset path.", { status: 400 });
	}

	const safePath = safeRelativeAssetPath(assetPath);
	if (!safePath) {
		return new Response("Invalid static asset path.", { status: 400 });
	}

	return staticFileResponse(storage.config.webDistDir, safePath);
}

type AssetManifest = Record<string, unknown>;

export async function readScopeAssetManifest(
	storage: AppStorage,
	userAssetsDir?: string,
): Promise<AssetManifest> {
	const bundledAssetsRoot = resolve(
		storage.config.advantageScopeDistDir,
		"bundledAssets",
	);
	const manifest: AssetManifest = {};

	async function walk(directory: string, root: string): Promise<void> {
		const entries = await readdir(directory, { withFileTypes: true }).catch(
			() => null,
		);
		if (!entries) {
			return;
		}

		for (const entry of entries) {
			if (entry.name.startsWith(".")) {
				continue;
			}

			const absolutePath = resolve(directory, entry.name);
			if (entry.isDirectory()) {
				await walk(absolutePath, root);
				continue;
			}
			if (!entry.isFile()) {
				continue;
			}

			const manifestPath = relative(root, absolutePath).split(sep).join("/");
			let contents: unknown = null;
			if (entry.name === "config.json") {
				try {
					contents = JSON.parse(await readFile(absolutePath, "utf8"));
				} catch {
					contents = null;
				}
			}
			manifest[manifestPath] = contents;
		}
	}

	await walk(bundledAssetsRoot, bundledAssetsRoot);

	if (userAssetsDir) {
		await walk(userAssetsDir, userAssetsDir);
	}

	return manifest;
}

export async function scopeResponse(
	storage: AppStorage,
	pathname: string,
	userAssetsDir?: string,
): Promise<Response> {
	let suffix = pathname === "/scope" ? "" : pathname.slice("/scope/".length);
	if (suffix === "" || suffix === "/") {
		suffix = "index.html";
	}

	if (suffix.startsWith("www/www/")) {
		return redirect(`/scope/www/${suffix.slice("www/www/".length)}`, {
			status: 302,
		});
	}

	let assetPath: string;
	try {
		assetPath = decodeURIComponent(suffix);
	} catch {
		return new Response("Invalid AdvantageScope asset path.", { status: 400 });
	}

	if (assetPath === "assets" || assetPath === "assets/") {
		return jsonResponse(await readScopeAssetManifest(storage, userAssetsDir));
	}

	if (assetPath.startsWith("assets/")) {
		const relativeAssetPath = assetPath.slice("assets/".length);
		// Check user assets first, then fall back to bundled
		if (userAssetsDir) {
			const userFile = resolve(userAssetsDir, relativeAssetPath);
			if (isInsideDirectory(userAssetsDir, userFile)) {
				try {
					const fileStat = await stat(userFile);
					if (fileStat.isFile()) {
						return new Response(Bun.file(userFile), {
							headers: { "content-type": contentTypeFor(userFile) },
						});
					}
				} catch {
					// Fall through to bundled assets
				}
			}
		}
		return staticFileResponse(
			resolve(storage.config.advantageScopeDistDir, "bundledAssets"),
			relativeAssetPath,
		);
	}

	return staticFileResponse(storage.config.advantageScopeDistDir, assetPath);
}

/**
 * Serves a vendored tool's built static dist under a fixed URL mount prefix
 * (e.g. `/choreo/`, `/elastic/`) — every such tool is served identically
 * (SPA-style, index.html fallback, a friendly 503 while the dist is
 * missing/not yet built). Only AdvantageScope (`scopeResponse`, above) is
 * genuinely different, since it also serves a walked bundled-assets
 * manifest — everything else should go through this one helper rather than
 * growing another copy-pasted per-tool function. See
 * docs/decisions/043-vendor-tool-manifest.md.
 */
export async function vendorDistAssetResponse(
	distDir: string,
	mountPrefix: string,
	pathname: string,
	notBuiltMessage: string,
): Promise<Response> {
	let suffix =
		pathname === mountPrefix ? "" : pathname.slice(`${mountPrefix}/`.length);
	if (suffix === "" || suffix === "/") {
		suffix = "index.html";
	}

	let assetPath: string;
	try {
		assetPath = decodeURIComponent(suffix);
	} catch {
		return new Response(`Invalid ${mountPrefix} asset path.`, { status: 400 });
	}
	const safePath = safeRelativeAssetPath(assetPath);
	if (!safePath) {
		return new Response(`Invalid ${mountPrefix} asset path.`, { status: 400 });
	}

	const response = await staticFileResponse(distDir, safePath);
	if (response.status === 404 && safePath === "index.html") {
		return htmlResponse(notBuiltMessage, { status: 503 });
	}
	return response;
}

export async function choreoWebAssetResponse(
	storage: AppStorage,
	pathname: string,
): Promise<Response> {
	return vendorDistAssetResponse(
		storage.config.choreoDistDir,
		"/choreo",
		pathname,
		"Choreo has not been built yet. Rebuild the control image to install the Choreo web dist.",
	);
}

export async function elasticWebAssetResponse(
	storage: AppStorage,
	pathname: string,
): Promise<Response> {
	return vendorDistAssetResponse(
		storage.config.elasticDistDir,
		"/elastic",
		pathname,
		"Elastic Dashboard has not been built yet. Run `bun run build:elastic` " +
			"or `bun run fetch:dist` before starting the control plane.",
	);
}

export function userAssetsPath(workspace: {
	id: string;
	project_path: string;
}): string {
	return resolve(dirname(workspace.project_path), "assets");
}

export async function handleUploadAsset(
	storage: AppStorage,
	request: Request,
): Promise<Response> {
	const session = await requireSession(storage, request);
	if (session instanceof Response) return session;

	const workspace = storage.findWorkspaceByUserId(session.user.id);
	if (!workspace) {
		return new Response("No workspace found.", { status: 400 });
	}

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return new Response("Invalid form data.", { status: 400 });
	}

	const file = formData.get("file");
	if (!file || !(file instanceof File)) {
		return new Response("No file provided.", { status: 400 });
	}

	if (!file.name.endsWith(".zip")) {
		return new Response("File must be a .zip archive.", { status: 400 });
	}

	const maxSize = 50 * 1024 * 1024; // 50 MB
	if (file.size > maxSize) {
		return new Response("File is too large (max 50 MB).", { status: 400 });
	}

	const assetsDir = userAssetsPath(workspace);
	await mkdir(assetsDir, { recursive: true });

	const tmpDir = resolve(tmpdir(), `frc-upload-${crypto.randomUUID()}`);
	try {
		await mkdir(tmpDir, { recursive: true });

		// Extract and validate ZIP structure in-process (no external `unzip`
		// binary, which is absent on Windows). zip-slip is prevented by
		// resolving each entry inside tmpDir and rejecting escapes.
		let entries: Record<string, Uint8Array>;
		try {
			entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
		} catch {
			return new Response("Failed to extract ZIP archive.", { status: 400 });
		}

		for (const [name, data] of Object.entries(entries)) {
			if (name.endsWith("/")) continue; // directory entry
			const dest = resolve(tmpDir, name);
			const rel = relative(tmpDir, dest);
			if (rel.startsWith("..") || isAbsolute(rel)) {
				return new Response("ZIP contains invalid paths.", { status: 400 });
			}
			await mkdir(dirname(dest), { recursive: true });
			await writeFile(dest, data);
		}

		// Find top-level directories in the extracted content
		const extractedEntries = await readdir(tmpDir, { withFileTypes: true });
		const assetDirs = extractedEntries.filter((e) => e.isDirectory());

		if (assetDirs.length === 0) {
			return new Response(
				"ZIP must contain at least one directory with asset files.",
				{ status: 400 },
			);
		}

		// Validate and move each asset directory
		let movedCount = 0;
		for (const assetDir of assetDirs) {
			const srcDir = resolve(tmpDir, assetDir.name);
			const configPath = resolve(srcDir, "config.json");
			try {
				await stat(configPath);
			} catch {
				continue; // Skip directories without config.json
			}

			const destDir = resolve(assetsDir, assetDir.name);
			await rm(destDir, { recursive: true, force: true });
			await cp(srcDir, destDir, { recursive: true });
			movedCount++;
		}

		if (movedCount === 0) {
			return new Response(
				"No valid assets found. Each asset directory must contain a config.json.",
				{ status: 400 },
			);
		}

		return new Response("OK", { status: 200 });
	} finally {
		await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
	}
}
