# 047 — Admin lesson/track assignment

Status: **Accepted** — 2026-09-15

## Context

With Legion (046) as a real identity/group system to target, the admin
portal can now do what the user asked for from the start: assign specific
lessons or tracks to specific students or Legion groups, on top of the
existing Dashboard/Containers/Workspaces/Users/Audit Log admin surface.
Confirmed scope: **catalog + assignment management only** — browsing and
targeting modules/tracks, not in-browser lesson *content* authoring, which
stays git-based against the `coderunner-lessons` repo (029, 044).

## Decision

- **New migration `014_lesson_assignments.sql`**: a single `lesson_assignments`
  table — `target_type` (`'module'|'track'`), `target_id`, `assignee_type`
  (`'user'|'group'`), `assignee_id` (a Legion `member_code` or group slug),
  unique on the four-column combination. `track` is already a purely cosmetic
  grouping string on each module (`lessonModuleSchema.track`, unrelated to the
  gating `requires` chain) — a track-type assignment covers every module that
  currently reports that `track` value; there is no separate track entity to
  create or maintain.
- **Default visibility: unassigned stays visible to everyone.** An assignment
  row is a *narrowing* mechanism — the moment any assignment exists for a
  module (directly, or via its track), it becomes visible only to the
  assigned users/groups. The alternative (hidden-until-assigned) was rejected:
  it would silently hide the entire bundled demo catalog the instant this
  shipped, for every existing zero-config deployment — not worth the footgun,
  and inconsistent with decision 029's "runs zero-config" intent.
- **New `apps/control/src/lesson-assignments.ts`** — `filterVisibleModules()`,
  a small pure function taking the full module list, all assignment rows, and
  the viewer's `{id, groups}`, applying the rule above. Kept separate from
  `checkpoints.ts` (which owns lock-state, a different concern) so it has its
  own focused unit tests (`lesson-assignments.test.ts`) independent of a full
  `ControlApp`.
- **`GET /api/lessons` (workspace-routes.ts)** computes lock state against the
  *full, unfiltered* manifest first, then applies visibility filtering to the
  result — in that order specifically, so a prerequisite module that happens
  to be assigned away from the current viewer still correctly locks its
  dependents, rather than being silently skipped as an "unknown prerequisite."
  This endpoint enforces visibility for the catalog *listing* only;
  `POST /api/lessons/load` does not independently re-check assignment for the
  requested `moduleId` — this is an organizational/visibility feature for a
  classroom deployment, not an adversarial access-control boundary, matching
  how the rest of the lesson catalog already works (any authenticated user can
  already name any bundled module id).
- **`AuthContext`/`ResolvedSession`/`LegionSession` all gained a `groups:
  string[]` field** (the raw Legion group slugs, not just the derived
  `role`) — needed because group-targeted assignments must be checked against
  the viewer's actual group membership, which `role` (admin/student only)
  can't express. Demo mode and the `ADMIN_TOKEN` break-glass session both
  report `groups: []`.
- **New admin routes** (`admin-routes.ts`, `requireAdmin`-gated, audit-logged
  as `lesson-assignment.add`/`lesson-assignment.remove`): `GET
  /admin/lessons/catalog` (thin wrapper around the existing
  `catalogSource.getManifest()` — no second loader), `GET`/`POST
  /admin/lessons/assignments`, `DELETE /admin/lessons/assignments/:id`. A
  duplicate `POST` (same target + assignee) is a 409, not a silent
  no-op or 500.
- **New web admin page** `apps/web/src/admin/pages/Lessons.tsx` (new
  `"lessons"` tab in `AdminLayout`/`AdminApp`) — the same thin
  fetch-and-poll pattern as the existing admin pages (`useAdminPoll`): list
  modules/tracks, add/remove assignments. No content-editing UI, per the
  confirmed scope.

## Consequences

- A module or track with zero assignment rows behaves exactly as it does
  today for every existing deployment — this feature is additive and
  changes nothing by default.
- Because visibility is listing-only, a student who already knows another
  module's id (e.g. from a classmate) can still load it directly even if it's
  assigned away from them. Acceptable for a classroom organization tool;
  would need to move the check into `POST /api/lessons/load` if this ever
  needs to be a real access boundary instead.
- Assigning a track targets by the module's free-text `track` string, not a
  stable id — renaming a track in the lessons repo silently detaches any
  existing track-level assignments from the modules that moved. No migration
  path for this today; an admin re-adds the assignment under the new name.
