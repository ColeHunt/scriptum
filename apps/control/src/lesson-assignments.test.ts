import { describe, expect, test } from "bun:test";
import type { LessonModule } from "@frc-scriptum/contracts";
import { filterVisibleModules } from "./lesson-assignments";
import type { LessonAssignmentRow } from "./storage";

function module(
	overrides: Partial<LessonModule> & { id: string },
): LessonModule {
	return {
		title: overrides.id,
		description: "",
		subdir: `modules/${overrides.id}`,
		kind: "plain-java",
		order: 0,
		checkpoints: [],
		requires: [],
		...overrides,
	};
}

function assignment(
	overrides: Partial<LessonAssignmentRow> & {
		target_type: "module" | "track";
		target_id: string;
		assignee_type: "user" | "group";
		assignee_id: string;
	},
): LessonAssignmentRow {
	return {
		id: 1,
		created_at: "2026-01-01T00:00:00.000Z",
		created_by: "admin1",
		...overrides,
	};
}

describe("filterVisibleModules", () => {
	test("no assignments at all - every module stays visible", () => {
		const modules = [
			module({ id: "hello-world" }),
			module({ id: "robot-starter" }),
		];
		expect(filterVisibleModules(modules, [], { id: "u1", groups: [] })).toEqual(
			modules,
		);
	});

	test("an unrelated module's assignment does not hide other modules", () => {
		const modules = [
			module({ id: "hello-world" }),
			module({ id: "robot-starter" }),
		];
		const assignments = [
			assignment({
				target_type: "module",
				target_id: "robot-starter",
				assignee_type: "user",
				assignee_id: "u2",
			}),
		];
		const visible = filterVisibleModules(modules, assignments, {
			id: "u1",
			groups: [],
		});
		expect(visible.map((m) => m.id)).toEqual(["hello-world"]);
	});

	test("module assigned to a specific user is visible to that user only", () => {
		const modules = [module({ id: "hello-world" })];
		const assignments = [
			assignment({
				target_type: "module",
				target_id: "hello-world",
				assignee_type: "user",
				assignee_id: "u1",
			}),
		];
		expect(
			filterVisibleModules(modules, assignments, { id: "u1", groups: [] }),
		).toHaveLength(1);
		expect(
			filterVisibleModules(modules, assignments, { id: "u2", groups: [] }),
		).toHaveLength(0);
	});

	test("module assigned to a group is visible to members of that group only", () => {
		const modules = [module({ id: "robot-starter" })];
		const assignments = [
			assignment({
				target_type: "module",
				target_id: "robot-starter",
				assignee_type: "group",
				assignee_id: "team-4143",
			}),
		];
		expect(
			filterVisibleModules(modules, assignments, {
				id: "u1",
				groups: ["team-4143"],
			}),
		).toHaveLength(1);
		expect(
			filterVisibleModules(modules, assignments, {
				id: "u1",
				groups: ["team-4423"],
			}),
		).toHaveLength(0);
	});

	test("a track-level assignment covers every module in that track", () => {
		const modules = [
			module({ id: "onboarding-1", track: "Software Onboarding" }),
			module({ id: "onboarding-2", track: "Software Onboarding" }),
			module({ id: "unrelated" }),
		];
		const assignments = [
			assignment({
				target_type: "track",
				target_id: "Software Onboarding",
				assignee_type: "group",
				assignee_id: "team-4143",
			}),
		];
		const memberVisible = filterVisibleModules(modules, assignments, {
			id: "u1",
			groups: ["team-4143"],
		});
		expect(memberVisible.map((m) => m.id).sort()).toEqual([
			"onboarding-1",
			"onboarding-2",
			"unrelated",
		]);

		const outsiderVisible = filterVisibleModules(modules, assignments, {
			id: "u2",
			groups: [],
		});
		expect(outsiderVisible.map((m) => m.id)).toEqual(["unrelated"]);
	});

	test("a module and its track can both carry assignments - either match makes it visible", () => {
		const modules = [module({ id: "m1", track: "Track A" })];
		const assignments = [
			assignment({
				target_type: "track",
				target_id: "Track A",
				assignee_type: "group",
				assignee_id: "group-a",
			}),
			assignment({
				target_type: "module",
				target_id: "m1",
				assignee_type: "user",
				assignee_id: "u2",
			}),
		];
		expect(
			filterVisibleModules(modules, assignments, {
				id: "u2",
				groups: [],
			}),
		).toHaveLength(1);
		expect(
			filterVisibleModules(modules, assignments, {
				id: "u3",
				groups: ["group-a"],
			}),
		).toHaveLength(1);
		expect(
			filterVisibleModules(modules, assignments, {
				id: "u4",
				groups: [],
			}),
		).toHaveLength(0);
	});
});
