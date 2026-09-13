import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useCheckpoints } from "./useCheckpoints";

const STATE = {
	ok: true,
	state: {
		moduleId: "git-basics",
		available: true,
		checkpoints: [
			{
				id: "first-commit",
				title: "First commit",
				description: "Add your name and commit it.",
				optional: false,
				verifier: { type: "script", path: "checkpoints/git-basics/a.sh" },
				result: null,
			},
		],
	},
};

describe("useCheckpoints", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	test("does not fetch when slug is null", () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const { result } = renderHook(() => useCheckpoints(null));
		expect(fetchMock).not.toHaveBeenCalled();
		expect(result.current.state.available).toBe(false);
	});

	test("loads the stored checkpoint state", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: () => Promise.resolve(STATE),
			}),
		);
		const { result } = renderHook(() => useCheckpoints("test-slug"));
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.state.available).toBe(true);
		expect(result.current.state.checkpoints).toHaveLength(1);
	});

	test("sets an error when the GET request fails", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 500 }),
		);
		const { result } = renderHook(() => useCheckpoints("test-slug"));
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.error).toContain("500");
		expect(result.current.state.available).toBe(false);
	});

	test("verify POSTs and updates state from the response", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () => Promise.resolve(STATE),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () =>
					Promise.resolve({
						ok: true,
						state: {
							...STATE.state,
							checkpoints: [
								{
									...STATE.state.checkpoints[0],
									result: {
										checkpointId: "first-commit",
										status: "passed",
										message: null,
										verifiedAt: new Date(0).toISOString(),
									},
								},
							],
						},
					}),
			});
		vi.stubGlobal("fetch", fetchMock);

		const { result } = renderHook(() => useCheckpoints("test-slug"));
		await waitFor(() => expect(result.current.loading).toBe(false));

		await act(async () => {
			await result.current.verify();
		});

		expect(result.current.state.checkpoints[0]?.result?.status).toBe("passed");
		const verifyCall = fetchMock.mock.calls[1];
		expect(verifyCall?.[0]).toBe("/u/test-slug/api/checkpoints/verify");
		expect(verifyCall?.[1]?.method).toBe("POST");
	});

	test("verify surfaces the server error message on a non-ok response", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () => Promise.resolve(STATE),
			})
			.mockResolvedValueOnce({
				ok: false,
				status: 409,
				json: () => Promise.resolve({ error: "A verify is already running." }),
			});
		vi.stubGlobal("fetch", fetchMock);

		const { result } = renderHook(() => useCheckpoints("test-slug"));
		await waitFor(() => expect(result.current.loading).toBe(false));

		await act(async () => {
			await result.current.verify();
		});

		expect(result.current.error).toBe("A verify is already running.");
		expect(result.current.verifying).toBe(false);
	});

	test("refetch re-requests the state", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: () => Promise.resolve(STATE),
		});
		vi.stubGlobal("fetch", fetchMock);

		const { result } = renderHook(() => useCheckpoints("test-slug"));
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(fetchMock).toHaveBeenCalledTimes(1);

		act(() => result.current.refetch());
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
	});
});
