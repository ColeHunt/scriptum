import { describe, expect, test } from "bun:test";
import {
	deriveWorkerCapacity,
	isWorkerDestroyEligible,
	selectWorkerForPlacement,
	type WorkerCandidate,
} from "./scheduler";

function worker(
	overrides: Partial<WorkerCandidate> & { id: string },
): WorkerCandidate {
	return {
		status: "ready",
		capacity: 4,
		currentCount: 0,
		...overrides,
	};
}

describe("selectWorkerForPlacement (pack-tightest)", () => {
	test("picks the fullest worker with room, not the emptiest", () => {
		const workers = [
			worker({ id: "a", currentCount: 1 }),
			worker({ id: "b", currentCount: 3 }),
			worker({ id: "c", currentCount: 0 }),
		];
		expect(selectWorkerForPlacement(workers)).toBe("b");
	});

	test("skips workers that are already at capacity", () => {
		const workers = [
			worker({ id: "full", currentCount: 4, capacity: 4 }),
			worker({ id: "room", currentCount: 1, capacity: 4 }),
		];
		expect(selectWorkerForPlacement(workers)).toBe("room");
	});

	test("skips workers that are not ready (provisioning/draining/destroying)", () => {
		const workers = [
			worker({ id: "provisioning", status: "provisioning", currentCount: 0 }),
			worker({ id: "draining", status: "draining", currentCount: 0 }),
			worker({ id: "ready", status: "ready", currentCount: 2 }),
		];
		expect(selectWorkerForPlacement(workers)).toBe("ready");
	});

	test("returns null when no worker has room - caller must provision a new one", () => {
		const workers = [worker({ id: "full", currentCount: 4, capacity: 4 })];
		expect(selectWorkerForPlacement(workers)).toBeNull();
	});

	test("returns null against an empty fleet", () => {
		expect(selectWorkerForPlacement([])).toBeNull();
	});
});

describe("isWorkerDestroyEligible (idle grace-period debounce)", () => {
	const now = Date.parse("2026-09-15T12:00:00.000Z");
	const gracePeriodMs = 10 * 60_000;

	test("not eligible while it still has placed workspaces", () => {
		expect(
			isWorkerDestroyEligible(
				{ status: "ready", currentCount: 1 },
				now - gracePeriodMs * 2,
				now,
				gracePeriodMs,
			),
		).toBe(false);
	});

	test("not eligible if it isn't 'ready' (e.g. still provisioning)", () => {
		expect(
			isWorkerDestroyEligible(
				{ status: "provisioning", currentCount: 0 },
				now - gracePeriodMs * 2,
				now,
				gracePeriodMs,
			),
		).toBe(false);
	});

	test("not eligible if it has no recorded empty-since time", () => {
		expect(
			isWorkerDestroyEligible(
				{ status: "ready", currentCount: 0 },
				null,
				now,
				gracePeriodMs,
			),
		).toBe(false);
	});

	test("not eligible until the grace period has elapsed", () => {
		expect(
			isWorkerDestroyEligible(
				{ status: "ready", currentCount: 0 },
				now - gracePeriodMs / 2,
				now,
				gracePeriodMs,
			),
		).toBe(false);
	});

	test("eligible once empty for at least the grace period", () => {
		expect(
			isWorkerDestroyEligible(
				{ status: "ready", currentCount: 0 },
				now - gracePeriodMs,
				now,
				gracePeriodMs,
			),
		).toBe(true);
	});
});

describe("deriveWorkerCapacity", () => {
	test("floors RAM / per-student memory limit", () => {
		expect(deriveWorkerCapacity(16384, 4096)).toBe(4);
		expect(deriveWorkerCapacity(16384, 5000)).toBe(3);
	});

	test("never returns less than 1, even for an undersized worker", () => {
		expect(deriveWorkerCapacity(2048, 4096)).toBe(1);
	});
});
