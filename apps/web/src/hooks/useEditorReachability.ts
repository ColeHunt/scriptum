import { EDITOR_STATE_HEADER } from "@frc-fabrica/contracts";
import { useEffect, useState } from "react";

export type EditorStatus = "loading" | "starting" | "reachable" | "error";

export interface EditorReachability {
	status: EditorStatus;
	/** Seconds spent waiting for the editor, for progressive "still going" copy. */
	waitingSeconds: number;
	/** The proxy's explanation of a failed start, when it sent one. */
	errorDetail: string | null;
}

export function useEditorReachability(
	editorUrl: string | null,
): EditorReachability {
	const [status, setStatus] = useState<EditorStatus>("loading");
	const [waitingSeconds, setWaitingSeconds] = useState(0);
	const [errorDetail, setErrorDetail] = useState<string | null>(null);

	useEffect(() => {
		if (!editorUrl) return;

		let cancelled = false;
		// Once reachable there is nothing left to count, and ticking the counter
		// anyway would re-render the whole workspace tree every 10s all session.
		let settled = false;
		const startedAt = Date.now();
		setWaitingSeconds(0);

		const probeEditor = async () => {
			try {
				const response = await fetch(editorUrl, {
					credentials: "same-origin",
					method: "GET",
				});
				if (cancelled) return;
				if (response.status < 500) {
					settled = true;
					setStatus("reachable");
					setErrorDetail(null);
					return;
				}
				settled = false;
				// The proxy marks "still booting" so a slow first boot does not
				// present as a failure.
				if (response.headers.get(EDITOR_STATE_HEADER) === "starting") {
					setStatus("starting");
					setErrorDetail(null);
					return;
				}
				// Only safe to read on this branch: a reachable editor's body is the
				// whole VS Code document, while a 503's is the proxy's error text.
				const detail = await response.text().catch(() => "");
				if (cancelled) return;
				setStatus("error");
				setErrorDetail(detail.trim() || null);
			} catch {
				if (cancelled) return;
				settled = false;
				setStatus("error");
				setErrorDetail(null);
			}
		};

		void probeEditor();
		const interval = window.setInterval(() => {
			if (!settled) {
				setWaitingSeconds(Math.floor((Date.now() - startedAt) / 1000));
			}
			void probeEditor();
		}, 10_000);
		return () => {
			cancelled = true;
			window.clearInterval(interval);
		};
	}, [editorUrl]);

	return { status, waitingSeconds, errorDetail };
}
