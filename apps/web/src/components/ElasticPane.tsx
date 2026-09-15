import { Loader2 } from "lucide-react";
import { forwardRef, useCallback, useState } from "react";

interface ElasticPaneProps {
	workspaceSlug: string | null;
}

/**
 * Iframe host for the Elastic Dashboard web build served at /elastic/. The
 * app inside reads `?ws=<slug>` (same convention as Choreo) to compute its
 * proxied NT4 endpoint (`/u/<slug>/sim/nt4?app=Elastic`) and its layout API
 * base (`/u/<slug>/api/elastic-layout`); the session cookie (same origin)
 * authenticates both. See patches/elastic/README.md.
 */
export const ElasticPane = forwardRef<HTMLIFrameElement, ElasticPaneProps>(
	function ElasticPane({ workspaceSlug }, ref) {
		const [iframeLoaded, setIframeLoaded] = useState(false);
		const handleLoad = useCallback(() => setIframeLoaded(true), []);

		return (
			<aside className="relative flex h-full min-h-0 min-w-0 flex-col border-l border-border bg-card">
				{workspaceSlug !== null && (
					<iframe
						ref={ref}
						title="Elastic"
						data-pane="elastic"
						src={`/elastic/?ws=${encodeURIComponent(workspaceSlug)}`}
						className="min-h-0 w-full flex-1 border-0 bg-white"
						onLoad={handleLoad}
					/>
				)}
				{workspaceSlug !== null && !iframeLoaded && (
					<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card">
						<Loader2 className="size-8 animate-spin text-muted-foreground" />
						<span className="font-mono text-sm text-muted-foreground">
							Loading Elastic…
						</span>
					</div>
				)}
				{workspaceSlug === null && (
					<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card">
						<span className="font-mono text-sm text-muted-foreground">
							Elastic is not available for this module.
						</span>
					</div>
				)}
			</aside>
		);
	},
);
