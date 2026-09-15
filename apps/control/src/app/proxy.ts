import { EDITOR_STATE_HEADER } from "@frc-scriptum/contracts";
import { requireWebSocketOrigin } from "../auth/middleware";
import { getLogger } from "../logging";
import { proxyUpstreamDuration } from "../metrics";
import type { WorkspaceRuntimeProvider } from "../runtime";
import type { AppStorage, AuthContext } from "../storage";
import type { BunUpgradeServer, HttpFetch, SocketData } from "./types";

const log = getLogger("proxy");

export function requestedProtocols(request: Request): string[] {
	return (request.headers.get("sec-websocket-protocol") ?? "")
		.split(",")
		.map((protocol) => protocol.trim())
		.filter(Boolean);
}

export function sendUpstreamWebSocketMessage(
	upstream: WebSocket,
	message: string | ArrayBuffer | Uint8Array,
): void {
	if (typeof message === "string" || message instanceof ArrayBuffer) {
		upstream.send(message);
		return;
	}

	const copy = new Uint8Array(message.byteLength);
	copy.set(message);
	upstream.send(copy.buffer);
}

// Headers that must not be forwarded by a proxy (RFC 7230 § 6.1 / RFC 9110 § 7.6.1).
const HOP_BY_HOP_HEADERS = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
]);

export function stripHopByHopHeaders(source: Headers): Headers {
	// The `Connection` header may list additional hop-by-hop header names.
	const connectionExtras = (source.get("connection") ?? "")
		.split(",")
		.map((token) => token.trim().toLowerCase())
		.filter(Boolean);

	const stripped = new Headers();
	source.forEach((value, key) => {
		const lower = key.toLowerCase();
		if (HOP_BY_HOP_HEADERS.has(lower) || connectionExtras.includes(lower)) {
			return;
		}
		stripped.set(key, value);
	});

	return stripped;
}

async function probeVscodeReady(
	httpBaseUrl: string,
	basePath: string,
	timeoutMs: number,
	upstreamFetch: HttpFetch,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	const probeUrl = `${httpBaseUrl}${basePath}`;
	while (Date.now() < deadline) {
		try {
			const response = await upstreamFetch(probeUrl, {
				signal: AbortSignal.timeout(500),
			});
			if (response.status >= 200 && response.status < 500) {
				return true;
			}
		} catch {
			// Connection refused or aborted; keep retrying.
		}
		await new Promise((resolveSleep) => setTimeout(resolveSleep, 250));
	}
	return false;
}

export async function vscodeHttpProxyResponse(
	storage: AppStorage,
	runtimeProvider: WorkspaceRuntimeProvider,
	auth: AuthContext,
	request: Request,
	fullPath: string,
	upstreamFetch: HttpFetch,
): Promise<Response> {
	void storage;
	const runtime = await runtimeProvider.ensureWorkspaceRunning(
		auth.workspace.id,
	);
	const vscode = runtime.endpoints.vscode;
	if (runtime.state !== "running" || !vscode) {
		// No runtime.error means the container is still coming up rather than
		// having failed, so the shell can say "starting" instead of showing an
		// indefinite spinner that reads as broken.
		return new Response(runtime.error ?? "Editor is not running.", {
			status: 503,
			...(runtime.error
				? {}
				: { headers: { [EDITOR_STATE_HEADER]: "starting" } }),
		});
	}

	if (
		!(await probeVscodeReady(
			vscode.httpBaseUrl,
			vscode.basePath,
			30_000,
			upstreamFetch,
		))
	) {
		log.warn("vscode upstream did not become ready", {
			workspaceId: auth.workspace.id,
			httpBaseUrl: vscode.httpBaseUrl,
		});
		// Running container, editor still booting: first boot seeds the Gradle
		// cache and extensions, which can outlast this probe on a slow filesystem.
		return new Response("Editor upstream did not become ready.", {
			status: 503,
			headers: { [EDITOR_STATE_HEADER]: "starting" },
		});
	}

	const upstreamUrl = `${vscode.httpBaseUrl}${fullPath}`;
	const forwardHeaders = stripHopByHopHeaders(request.headers);
	log.trace("vscode http proxy", {
		workspaceId: auth.workspace.id,
		method: request.method,
		path: fullPath,
	});

	const startedAt = performance.now();
	let outcome = "ok";
	try {
		const upstream = await upstreamFetch(upstreamUrl, {
			method: request.method,
			headers: forwardHeaders,
			body: request.body,
			redirect: "manual",
			decompress: false,
		});

		if (upstream.status >= 500) outcome = "upstream_5xx";
		else if (upstream.status >= 400) outcome = "upstream_4xx";
		const responseHeaders = stripHopByHopHeaders(upstream.headers);
		return new Response(upstream.body, {
			status: upstream.status,
			statusText: upstream.statusText,
			headers: responseHeaders,
		});
	} catch (err) {
		outcome = "error";
		log.warn("vscode upstream unreachable", {
			workspaceId: auth.workspace.id,
			upstreamUrl,
			err: err instanceof Error ? err : new Error(String(err)),
		});
		return new Response("Editor upstream is not reachable.", { status: 502 });
	} finally {
		proxyUpstreamDuration.observe(
			{ upstream: "vscode", outcome },
			(performance.now() - startedAt) / 1000,
		);
	}
}

export async function vscodeWebSocketResponse(
	storage: AppStorage,
	runtimeProvider: WorkspaceRuntimeProvider,
	auth: AuthContext,
	request: Request,
	fullPath: string,
	upstreamFetch: HttpFetch,
	server?: BunUpgradeServer,
): Promise<Response> {
	if (
		!server ||
		request.headers.get("upgrade")?.toLowerCase() !== "websocket"
	) {
		return new Response("Expected WebSocket upgrade.", { status: 426 });
	}
	const originError = requireWebSocketOrigin(request, storage.config.baseUrl);
	if (originError) {
		return originError;
	}

	const runtime = await runtimeProvider.ensureWorkspaceRunning(
		auth.workspace.id,
	);
	const vscode = runtime.endpoints.vscode;
	if (runtime.state !== "running" || !vscode) {
		return new Response(runtime.error ?? "Editor is not running.", {
			status: 503,
		});
	}

	if (
		!(await probeVscodeReady(
			vscode.httpBaseUrl,
			vscode.basePath,
			30_000,
			upstreamFetch,
		))
	) {
		return new Response("Editor upstream did not become ready.", {
			status: 503,
		});
	}

	const protocols = requestedProtocols(request);
	const upstreamUrl = `${vscode.wsBaseUrl}${fullPath}`;
	const upgradeOptions: { data: SocketData; headers?: HeadersInit } = {
		data: {
			kind: "vscode",
			upstreamUrl,
			protocols,
			upstreamOpen: false,
			pendingMessages: [],
		},
	};
	if (protocols.length > 0) {
		upgradeOptions.headers = { "sec-websocket-protocol": protocols[0] ?? "" };
	}
	const upgraded = server.upgrade(request, upgradeOptions);
	if (!upgraded) {
		return new Response("WebSocket upgrade failed.", { status: 400 });
	}
	return undefined as unknown as Response;
}

async function probeChoreoReady(
	httpBaseUrl: string,
	timeoutMs: number,
	upstreamFetch: HttpFetch,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	const probeUrl = `${httpBaseUrl}/healthz`;
	while (Date.now() < deadline) {
		try {
			const response = await upstreamFetch(probeUrl, {
				signal: AbortSignal.timeout(500),
			});
			if (response.status >= 200 && response.status < 500) {
				return true;
			}
		} catch {
			// Connection refused or aborted; keep retrying.
		}
		await new Promise((resolveSleep) => setTimeout(resolveSleep, 250));
	}
	return false;
}

/**
 * Proxies `/u/:slug/api/choreo/**` to choreo-server inside the workspace
 * container. `fullPath` has the `/u/:slug/api/choreo` prefix already
 * stripped by the caller - unlike the VSCode proxy, choreo-server has no
 * base-path awareness of its own, so the upstream URL is rooted at "/".
 */
export async function choreoHttpProxyResponse(
	storage: AppStorage,
	runtimeProvider: WorkspaceRuntimeProvider,
	auth: AuthContext,
	request: Request,
	fullPath: string,
	upstreamFetch: HttpFetch,
): Promise<Response> {
	void storage;
	const runtime = await runtimeProvider.ensureWorkspaceRunning(
		auth.workspace.id,
	);
	const choreo = runtime.endpoints.choreo;
	if (runtime.state !== "running" || !choreo) {
		return new Response(runtime.error ?? "Choreo is not running.", {
			status: 503,
		});
	}

	if (!(await probeChoreoReady(choreo.httpBaseUrl, 30_000, upstreamFetch))) {
		log.warn("choreo upstream did not become ready", {
			workspaceId: auth.workspace.id,
			httpBaseUrl: choreo.httpBaseUrl,
		});
		return new Response("Choreo upstream did not become ready.", {
			status: 503,
		});
	}

	const upstreamUrl = `${choreo.httpBaseUrl}${fullPath}`;
	const forwardHeaders = stripHopByHopHeaders(request.headers);
	log.trace("choreo http proxy", {
		workspaceId: auth.workspace.id,
		method: request.method,
		path: fullPath,
	});

	const startedAt = performance.now();
	let outcome = "ok";
	try {
		const upstream = await upstreamFetch(upstreamUrl, {
			method: request.method,
			headers: forwardHeaders,
			body: request.body,
			redirect: "manual",
			decompress: false,
		});

		if (upstream.status >= 500) outcome = "upstream_5xx";
		else if (upstream.status >= 400) outcome = "upstream_4xx";
		const responseHeaders = stripHopByHopHeaders(upstream.headers);
		return new Response(upstream.body, {
			status: upstream.status,
			statusText: upstream.statusText,
			headers: responseHeaders,
		});
	} catch (err) {
		outcome = "error";
		log.warn("choreo upstream unreachable", {
			workspaceId: auth.workspace.id,
			upstreamUrl,
			err: err instanceof Error ? err : new Error(String(err)),
		});
		return new Response("Choreo upstream is not reachable.", { status: 502 });
	} finally {
		proxyUpstreamDuration.observe(
			{ upstream: "choreo", outcome },
			(performance.now() - startedAt) / 1000,
		);
	}
}

export async function choreoWebSocketResponse(
	storage: AppStorage,
	runtimeProvider: WorkspaceRuntimeProvider,
	auth: AuthContext,
	request: Request,
	fullPath: string,
	upstreamFetch: HttpFetch,
	server?: BunUpgradeServer,
): Promise<Response> {
	if (
		!server ||
		request.headers.get("upgrade")?.toLowerCase() !== "websocket"
	) {
		return new Response("Expected WebSocket upgrade.", { status: 426 });
	}
	const originError = requireWebSocketOrigin(request, storage.config.baseUrl);
	if (originError) {
		return originError;
	}

	const runtime = await runtimeProvider.ensureWorkspaceRunning(
		auth.workspace.id,
	);
	const choreo = runtime.endpoints.choreo;
	if (runtime.state !== "running" || !choreo) {
		return new Response(runtime.error ?? "Choreo is not running.", {
			status: 503,
		});
	}

	if (!(await probeChoreoReady(choreo.httpBaseUrl, 30_000, upstreamFetch))) {
		return new Response("Choreo upstream did not become ready.", {
			status: 503,
		});
	}

	const protocols = requestedProtocols(request);
	const upstreamUrl = `${choreo.wsBaseUrl}${fullPath}`;
	const upgradeOptions: { data: SocketData; headers?: HeadersInit } = {
		data: {
			kind: "choreo",
			upstreamUrl,
			protocols,
			upstreamOpen: false,
			pendingMessages: [],
		},
	};
	if (protocols.length > 0) {
		upgradeOptions.headers = { "sec-websocket-protocol": protocols[0] ?? "" };
	}
	const upgraded = server.upgrade(request, upgradeOptions);
	if (!upgraded) {
		return new Response("WebSocket upgrade failed.", { status: 400 });
	}
	return undefined as unknown as Response;
}

export async function nt4AliveResponse(
	storage: AppStorage,
	runtimeProvider: WorkspaceRuntimeProvider,
	auth: AuthContext,
	upstreamFetch: HttpFetch,
): Promise<Response> {
	void storage;
	const runtime = await runtimeProvider.ensureWorkspaceRunning(
		auth.workspace.id,
	);
	if (runtime.state !== "running" || !runtime.endpoints.nt4) {
		return new Response(runtime.error ?? "Simulator is not running.", {
			status: 503,
		});
	}

	const startedAt = performance.now();
	let outcome = "ok";
	try {
		const upstream = await upstreamFetch(runtime.endpoints.nt4.httpUrl, {
			signal: AbortSignal.timeout(500),
		});
		if (!upstream.ok) {
			outcome = "not_ready";
			log.trace("nt4 alive probe not ready", {
				workspaceId: auth.workspace.id,
				status: upstream.status,
			});
			return new Response("Simulator NT4 endpoint is not ready.", {
				status: 503,
			});
		}
		return new Response("ok\n", {
			status: 200,
			headers: { "content-type": "text/plain; charset=utf-8" },
		});
	} catch (err) {
		outcome = "error";
		log.trace("nt4 alive probe unreachable", {
			workspaceId: auth.workspace.id,
			err: err instanceof Error ? err.message : String(err),
		});
		return new Response("Simulator NT4 endpoint is not reachable.", {
			status: 503,
		});
	} finally {
		proxyUpstreamDuration.observe(
			{ upstream: "nt4", outcome },
			(performance.now() - startedAt) / 1000,
		);
	}
}

const NT4_APP_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const NT4_APP_NAME_DEFAULT = "AdvantageScopeLite";

/**
 * The upstream NT4 endpoint's `wsUrl` always ends in `/nt/<name>` (see
 * containers/converters.ts). Swapping that trailing segment per-request lets
 * more than one browser-side NT4 client (AdvantageScope Lite, Elastic) share
 * one proxied route without pinning every connection to the same upstream
 * client identity.
 */
export function withNt4AppName(
	wsUrl: string,
	requestedAppName: string | null,
): string {
	const appName =
		requestedAppName && NT4_APP_NAME_PATTERN.test(requestedAppName)
			? requestedAppName
			: NT4_APP_NAME_DEFAULT;
	return wsUrl.replace(/\/nt\/[^/]+$/u, `/nt/${appName}`);
}

export async function nt4WebSocketResponse(
	storage: AppStorage,
	runtimeProvider: WorkspaceRuntimeProvider,
	auth: AuthContext,
	request: Request,
	server?: BunUpgradeServer,
): Promise<Response> {
	if (
		!server ||
		request.headers.get("upgrade")?.toLowerCase() !== "websocket"
	) {
		return new Response("Expected WebSocket upgrade.", { status: 426 });
	}
	const originError = requireWebSocketOrigin(request, storage.config.baseUrl);
	if (originError) {
		return originError;
	}

	const runtime = await runtimeProvider.ensureWorkspaceRunning(
		auth.workspace.id,
	);
	if (runtime.state !== "running" || !runtime.endpoints.nt4) {
		return new Response(runtime.error ?? "Simulator is not running.", {
			status: 503,
		});
	}

	const requestUrl = new URL(request.url);
	const protocols = requestedProtocols(request);
	const upgradeOptions: { data: SocketData; headers?: HeadersInit } = {
		data: {
			kind: "nt4",
			upstreamUrl: withNt4AppName(
				runtime.endpoints.nt4.wsUrl,
				requestUrl.searchParams.get("app"),
			),
			protocols,
			upstreamOpen: false,
			pendingMessages: [],
		},
	};
	if (protocols.length > 0) {
		upgradeOptions.headers = { "sec-websocket-protocol": protocols[0] ?? "" };
	}
	const upgraded = server.upgrade(request, upgradeOptions);
	if (!upgraded) {
		return new Response("WebSocket upgrade failed.", { status: 400 });
	}
	return undefined as unknown as Response;
}

export async function halsimWebSocketResponse(
	storage: AppStorage,
	runtimeProvider: WorkspaceRuntimeProvider,
	auth: AuthContext,
	request: Request,
	server?: BunUpgradeServer,
): Promise<Response> {
	if (
		!server ||
		request.headers.get("upgrade")?.toLowerCase() !== "websocket"
	) {
		return new Response("Expected WebSocket upgrade.", { status: 426 });
	}
	const originError = requireWebSocketOrigin(request, storage.config.baseUrl);
	if (originError) {
		return originError;
	}

	const runtime = await runtimeProvider.ensureWorkspaceRunning(
		auth.workspace.id,
	);
	if (runtime.state !== "running" || !runtime.endpoints.halsim) {
		return new Response(runtime.error ?? "Simulator is not running.", {
			status: 503,
		});
	}

	const protocols = requestedProtocols(request);
	const upgradeOptions: { data: SocketData; headers?: HeadersInit } = {
		data: {
			kind: "halsim",
			upstreamUrl: runtime.endpoints.halsim.wsUrl,
			protocols,
			upstreamOpen: false,
			pendingMessages: [],
		},
	};
	if (protocols.length > 0) {
		upgradeOptions.headers = { "sec-websocket-protocol": protocols[0] ?? "" };
	}
	const upgraded = server.upgrade(request, upgradeOptions);
	if (!upgraded) {
		return new Response("WebSocket upgrade failed.", { status: 400 });
	}
	return undefined as unknown as Response;
}
