import { useEffect, useState } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { AdminApp } from "@/admin/AdminApp";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { topLevelSessionResponseSchema } from "@/lib/contracts";
import { LoginPage } from "@/routes/LoginPage";
import { ServiceOfflinePage } from "@/routes/ServiceOfflinePage";
import { WorkspaceLayout } from "@/routes/WorkspaceLayout";
import { WorkspacePage } from "@/routes/WorkspacePage";

const router = createBrowserRouter([
	{
		path: "/",
		element: <RootIndex />,
	},
	{
		path: "/login",
		element: <LoginPage />,
	},
	{
		path: "/admin/*",
		element: <AdminApp />,
	},
	{
		path: "/u/:slug",
		element: <WorkspaceLayout />,
		children: [
			{
				index: true,
				element: <WorkspacePage />,
			},
		],
	},
	{
		path: "*",
		element: <FallbackRedirect />,
	},
]);

function RootIndex() {
	// When served from CF Pages static assets, bun never sees a request for `/`,
	// so the server-side "redirect logged-in users to their workspace" path in
	// apps/control/src/app.ts can't run. Replicate it here.
	const [slug, setSlug] = useState<string | null | undefined>(undefined);

	useEffect(() => {
		let cancelled = false;
		fetch("/api/session", { credentials: "same-origin" })
			.then((res) =>
				res.ok ? res.json() : { authenticated: false, slug: null },
			)
			.then((body) => {
				if (cancelled) return;
				setSlug(topLevelSessionResponseSchema.parse(body).slug);
			})
			.catch(() => {
				if (!cancelled) setSlug(null);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	if (slug === undefined) return null;
	if (slug) return <Navigate to={`/u/${slug}/`} replace />;
	return <Navigate to="/login" replace />;
}

function FallbackRedirect() {
	const parts = window.location.pathname.split("/").filter(Boolean);
	const slug = parts[0] === "u" ? parts[1] : undefined;
	if (slug) {
		return <Navigate to={`/u/${slug}`} replace />;
	}
	return <Navigate to="/login" replace />;
}

export default function App() {
	const [health, setHealth] = useState<"checking" | "online" | "offline">(
		"checking",
	);

	useEffect(() => {
		if (health !== "checking") return;
		const controller = new AbortController();
		const timeoutId = window.setTimeout(() => controller.abort(), 5000);
		fetch("/healthz", { signal: controller.signal })
			.then((res) => setHealth(res.ok ? "online" : "offline"))
			.catch(() => setHealth("offline"))
			.finally(() => window.clearTimeout(timeoutId));
		return () => {
			window.clearTimeout(timeoutId);
			controller.abort();
		};
	}, [health]);

	if (health === "checking") {
		return (
			<ThemeProvider defaultTheme="dark">
				<ServiceOfflinePage loading />
			</ThemeProvider>
		);
	}

	if (health === "offline") {
		return (
			<ThemeProvider defaultTheme="dark">
				<ServiceOfflinePage onRetry={() => setHealth("checking")} />
			</ThemeProvider>
		);
	}

	return (
		<ThemeProvider defaultTheme="dark">
			<TooltipProvider>
				<RouterProvider router={router} />
				<Toaster />
			</TooltipProvider>
		</ThemeProvider>
	);
}
