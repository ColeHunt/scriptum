// Matches AdvantageScope Lite's own `LocalStorageKeys.STATE`
// (vendor/AdvantageScope/src/main/lite/localStorageKeys.ts). AdvantageScope
// re-saves its full UI state (tabs, plotted fields, axis ranges, etc.) to
// this key every 250ms on its own (vendor/AdvantageScope/src/hub/hub.ts), so
// reading it is never meaningfully stale - no patch is needed to read it,
// only the same-origin `contentWindow.localStorage` access the unsandboxed
// `/scope` iframe already allows.
const SCOPE_STATE_KEY = "AdvantageScopeLite/state";

/**
 * Snapshots the AdvantageScope Lite iframe's own saved UI layout, to send
 * along with a checkpoint verify request. Deliberately untyped - it's
 * AdvantageScope's own schema, not ours. Fails closed to `null` on any
 * error (iframe not loaded, cross-origin, JSON parse failure, etc.) so a
 * layout read never blocks Verify from running.
 */
export function readScopeLayout(
	frame: HTMLIFrameElement | null | undefined,
): unknown | null {
	try {
		const raw = frame?.contentWindow?.localStorage.getItem(SCOPE_STATE_KEY);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}
