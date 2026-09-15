import { EDITOR_STATE_HEADER } from "@frc-scriptum/contracts";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useEditorReachability } from "./useEditorReachability";

/** A fetch Response stub carrying just what the hook reads. */
function response(
	status: number,
	options: { editorState?: string; body?: string } = {},
) {
	return {
		status,
		headers: {
			get: (name: string) =>
				name === EDITOR_STATE_HEADER ? (options.editorState ?? null) : null,
		},
		text: () => Promise.resolve(options.body ?? ""),
	};
}

describe("useEditorReachability", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	test("returns loading and never probes when there is no url", () => {
		vi.stubGlobal("fetch", vi.fn());
		const { result } = renderHook(() => useEditorReachability(null));
		expect(result.current.status).toBe("loading");
		expect(fetch).not.toHaveBeenCalled();
	});

	test("a 503 marked starting is not an error", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(response(503, { editorState: "starting" })),
		);
		const { result } = renderHook(() => useEditorReachability("/u/a/vscode/"));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(result.current.status).toBe("starting");
		expect(result.current.errorDetail).toBeNull();
	});

	test("an unmarked 503 is an error carrying the proxy's explanation", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					response(503, { body: "No such image: workspace\n" }),
				),
		);
		const { result } = renderHook(() => useEditorReachability("/u/a/vscode/"));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(result.current.status).toBe("error");
		expect(result.current.errorDetail).toBe("No such image: workspace");
	});

	test("counts up while starting", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(response(503, { editorState: "starting" })),
		);
		const { result } = renderHook(() => useEditorReachability("/u/a/vscode/"));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(20_000);
		});
		expect(result.current.waitingSeconds).toBeGreaterThanOrEqual(20);
	});

	test("stops counting once reachable, so the tree does not re-render forever", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200)));
		const { result } = renderHook(() => useEditorReachability("/u/a/vscode/"));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(result.current.status).toBe("reachable");

		await act(async () => {
			await vi.advanceTimersByTimeAsync(60_000);
		});
		// Still probing (so a later failure is caught), but no longer producing
		// a fresh waitingSeconds value on every tick.
		expect(fetch).toHaveBeenCalledTimes(7);
		expect(result.current.waitingSeconds).toBe(0);
	});
});
