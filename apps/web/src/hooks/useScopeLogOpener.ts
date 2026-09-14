import { useCallback, useEffect, useState } from "react";

export type ScopeLogStatus = "idle" | "loading" | "loaded" | "error";

/**
 * Lets a lesson (one with `showScope: true` but no live NT4 server) tell the
 * `/scope` iframe to fetch and open a log file by URL, via the
 * `frc-sim:open-log` postMessage the AdvantageScope patch
 * (`patches/advantagescope/002-lite-log-url-injection.patch`) listens for.
 * Unlike `useScopeHandshake`, this never fires automatically - the student's
 * program runs via the ordinary terminal/editor Run, not the app's own run
 * channel, so there's no "run finished" signal to hook. `openLog` is called
 * from a button instead.
 */
export function useScopeLogOpener(
	frameRef: React.RefObject<HTMLIFrameElement | null>,
	logUrl: string | null,
) {
	const [status, setStatus] = useState<ScopeLogStatus>("idle");
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			if (event.origin !== window.location.origin) return;
			const type = (event.data as { type?: unknown } | null)?.type;
			if (type === "frc-sim:log-ready") {
				setStatus("loaded");
				setError(null);
			} else if (type === "frc-sim:log-error") {
				setStatus("error");
				const message = (event.data as { error?: unknown }).error;
				setError(typeof message === "string" ? message : "Failed to open log.");
			}
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, []);

	const openLog = useCallback(() => {
		if (!logUrl) return;
		setStatus("loading");
		setError(null);
		// Cache-bust: the student may have re-run their program and produced a
		// new log since the last open, and the fetch this triggers is a plain
		// same-origin GET the browser would otherwise be free to cache.
		const bustedUrl = `${logUrl}${logUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;
		frameRef.current?.contentWindow?.postMessage(
			{ type: "frc-sim:open-log", url: bustedUrl },
			window.location.origin,
		);
	}, [logUrl, frameRef]);

	return { status, error, openLog };
}
