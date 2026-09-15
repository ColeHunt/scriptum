/**
 * Lesson/track visibility filtering (admin-assigned narrowing of the catalog).
 *
 * See docs/decisions/048-lesson-assignment.md: unassigned modules/tracks stay
 * visible to everyone (matches the pre-existing zero-config behavior). The
 * moment ANY assignment row exists for a module (directly, or via its
 * cosmetic `track` grouping), it becomes visible only to the users/groups
 * assigned to it.
 */
import type { LessonModule } from "@frc-coderunner/contracts";
import type { LessonAssignmentRow } from "./storage";

/** Filters `modules` down to what `viewer` is allowed to see. */
export function filterVisibleModules<T extends LessonModule>(
	modules: T[],
	assignments: LessonAssignmentRow[],
	viewer: { id: string; groups: string[] },
): T[] {
	if (assignments.length === 0) return modules;

	const byModule = new Map<string, LessonAssignmentRow[]>();
	const byTrack = new Map<string, LessonAssignmentRow[]>();
	for (const assignment of assignments) {
		const map = assignment.target_type === "module" ? byModule : byTrack;
		const list = map.get(assignment.target_id) ?? [];
		list.push(assignment);
		map.set(assignment.target_id, list);
	}

	return modules.filter((module) => {
		const relevant = [
			...(byModule.get(module.id) ?? []),
			...(module.track ? (byTrack.get(module.track) ?? []) : []),
		];
		if (relevant.length === 0) return true;
		return relevant.some((assignment) =>
			assignment.assignee_type === "user"
				? assignment.assignee_id === viewer.id
				: viewer.groups.includes(assignment.assignee_id),
		);
	});
}
