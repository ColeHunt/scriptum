import { useCallback, useEffect, useState } from "react";
import type { CheckpointsState } from "@/lib/contracts";
import { checkpointsStateResponseSchema } from "@/lib/contracts";

const EMPTY_STATE: CheckpointsState = {
	moduleId: null,
	available: false,
	checkpoints: [],
};

interface UseCheckpointsReturn {
	state: CheckpointsState;
	loading: boolean;
	/** Set only while a verify POST is in flight. */
	verifying: boolean;
	error: string | null;
	/** Re-fetches the stored state (e.g. after a lesson load finishes). */
	refetch: () => void;
	/** Runs every checkpoint, or just `checkpointIds` when given. */
	verify: (checkpointIds?: string[]) => Promise<void>;
}

/**
 * Loads and re-runs a workspace's lesson checkpoints
 * (`GET`/`POST /api/checkpoints`). Verification only ever runs when `verify`
 * is called explicitly - never automatically on a poll or code change.
 */
export function useCheckpoints(
	workspaceSlug: string | null,
): UseCheckpointsReturn {
	const [state, setState] = useState<CheckpointsState>(EMPTY_STATE);
	const [loading, setLoading] = useState(false);
	const [verifying, setVerifying] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [nonce, setNonce] = useState(0);

	const refetch = useCallback(() => setNonce((n) => n + 1), []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `nonce` is a manual refetch trigger.
	useEffect(() => {
		if (!workspaceSlug) {
			setState(EMPTY_STATE);
			return;
		}
		let cancelled = false;
		setLoading(true);

		void (async () => {
			try {
				const response = await fetch(`/u/${workspaceSlug}/api/checkpoints`, {
					credentials: "same-origin",
				});
				if (!response.ok) {
					throw new Error(`Unable to load checkpoints (${response.status}).`);
				}
				const parsed = checkpointsStateResponseSchema.parse(
					await response.json(),
				);
				if (cancelled) return;
				setState(parsed.state);
				setError(null);
			} catch (err) {
				if (cancelled) return;
				setState(EMPTY_STATE);
				setError(
					err instanceof Error ? err.message : "Unable to load checkpoints.",
				);
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [workspaceSlug, nonce]);

	const verify = useCallback(
		async (checkpointIds?: string[]) => {
			if (!workspaceSlug) return;
			setVerifying(true);
			setError(null);
			try {
				const response = await fetch(
					`/u/${workspaceSlug}/api/checkpoints/verify`,
					{
						method: "POST",
						credentials: "same-origin",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(checkpointIds ? { checkpointIds } : {}),
					},
				);
				const body = await response.json();
				if (!response.ok) {
					throw new Error(
						typeof body?.error === "string" ? body.error : "Verify failed.",
					);
				}
				const parsed = checkpointsStateResponseSchema.parse(body);
				setState(parsed.state);
			} catch (err) {
				setError(err instanceof Error ? err.message : "Verify failed.");
			} finally {
				setVerifying(false);
			}
		},
		[workspaceSlug],
	);

	return { state, loading, verifying, error, refetch, verify };
}
