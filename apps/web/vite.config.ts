import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const controlPlane = "http://localhost:4000";
const proxyOpts = { target: controlPlane, ws: true, changeOrigin: true };

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), tailwindcss()],
	base: "/",
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	server: {
		port: 5173,
		proxy: {
			"/api": proxyOpts,
			"/healthz": controlPlane,
			"/metrics": controlPlane,
			"/scope": controlPlane,
			"/choreo": controlPlane,
			"/elastic": controlPlane,
			"/scriptum-icon.png": controlPlane,
			"/favicon.ico": controlPlane,
			"/login/legion": controlPlane,
			"/logout": controlPlane,
			// (\?.*)? at the end matters: without it, a request with a query
			// string (e.g. /admin/audit-log?limit=50, which useAdminPoll always
			// sends) fails the $-anchored match and silently falls through to
			// index.html instead of being proxied.
			"^/admin/(assets|lessons|audit-log|users|containers|workspaces|config|status)(/.*)?(\\?.*)?$":
				proxyOpts,
			"^/u/[^/]+/(api|ws|sim|vscode|assets|scriptum-icon\\.png|favicon\\.ico)(/.*)?$":
				proxyOpts,
		},
	},
});
