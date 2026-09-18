import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useLessons } from "./useLessons";

const CATALOG = {
	ok: true,
	error: null,
	modules: [
		{
			id: "hello-world",
			title: "Hello, World",
			description: "Variables and input.",
			subdir: "modules/hello-world",
			kind: "plain-java",
			order: 10,
			checkpoints: [],
			requires: [],
			locked: false,
			missingPrerequisites: [],
			completed: false,
		},
		{
			id: "closest-distance",
			title: "Closest Distance",
			description: "Translation2d math.",
			subdir: "modules/closest-distance",
			kind: "robot",
			order: 40,
			checkpoints: [],
			requires: ["hello-world"],
			locked: true,
			missingPrerequisites: ["Hello, World"],
			completed: false,
		},
	],
};

describe("useLessons", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	test("does not fetch when slug is null", () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const { result } = renderHook(() => useLessons(null));
		expect(fetchMock).not.toHaveBeenCalled();
		expect(result.current.modules).toEqual([]);
	});

	test("loads and returns the catalog modules", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(CATALOG),
			}),
		);
		const { result } = renderHook(() => useLessons("test-slug"));
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.modules).toHaveLength(2);
		expect(result.current.modules[0]?.id).toBe("hello-world");
		expect(result.current.error).toBeNull();
	});

	test("carries lock state through for a locked module", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(CATALOG),
			}),
		);
		const { result } = renderHook(() => useLessons("test-slug"));
		await waitFor(() => expect(result.current.loading).toBe(false));
		const locked = result.current.modules.find(
			(m) => m.id === "closest-distance",
		);
		expect(locked).toMatchObject({
			locked: true,
			missingPrerequisites: ["Hello, World"],
		});
	});

	test("surfaces the catalog error string", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({ ok: true, modules: [], error: "catalog down" }),
			}),
		);
		const { result } = renderHook(() => useLessons("test-slug"));
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.modules).toEqual([]);
		expect(result.current.error).toBe("catalog down");
	});

	test("sets an error when the request throws", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
		const { result } = renderHook(() => useLessons("test-slug"));
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.error).toBe("network");
	});

	test("refetch re-requests the catalog", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(CATALOG),
		});
		vi.stubGlobal("fetch", fetchMock);
		const { result } = renderHook(() => useLessons("test-slug"));
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(fetchMock).toHaveBeenCalledTimes(1);
		act(() => result.current.refetch());
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
	});
});
