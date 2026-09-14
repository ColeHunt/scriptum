import { Loader2 } from "lucide-react";
import { forwardRef, type ReactNode, useCallback, useState } from "react";

interface ScopePaneProps {
	/** Extra chrome above the iframe - e.g. an "Open log" button for a
	 * lesson with no live NT4 server (see useScopeLogOpener). Most lessons
	 * don't need this. */
	toolbar?: ReactNode;
	/** Whether this lesson will send a live NT4 endpoint via
	 * `useScopeHandshake` (`?frcEndpoint=postMessage`). Defaults to true -
	 * every robot-sim lesson wants it. A lesson that only opens a static log
	 * (`showScope: true`, no live sim) must pass `false`: the patched
	 * AdvantageScope build shows a full-screen "did not receive an endpoint
	 * configuration" error 10s after load in that mode if no NT4 endpoint
	 * ever arrives, which it never will here. */
	expectNt4Endpoint?: boolean;
}

export const ScopePane = forwardRef<HTMLIFrameElement, ScopePaneProps>(
	function ScopePane({ toolbar, expectNt4Endpoint = true }, ref) {
		const [iframeLoaded, setIframeLoaded] = useState(false);
		const handleLoad = useCallback(() => setIframeLoaded(true), []);

		return (
			<aside className="relative flex h-full min-h-0 min-w-0 flex-col border-l border-border bg-card">
				{toolbar}
				<iframe
					ref={ref}
					title="AdvantageScope Lite"
					data-pane="scope"
					src={
						expectNt4Endpoint ? "/scope/?frcEndpoint=postMessage" : "/scope/"
					}
					className="min-h-0 w-full flex-1 border-0 bg-white"
					onLoad={handleLoad}
				/>
				{!iframeLoaded && (
					<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card">
						<Loader2 className="size-8 animate-spin text-muted-foreground" />
						<span className="font-mono text-sm text-muted-foreground">
							Loading AdvantageScope…
						</span>
					</div>
				)}
			</aside>
		);
	},
);
