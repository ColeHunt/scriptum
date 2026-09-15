-- Lesson/track assignment: an admin can narrow a module or track's visibility
-- to specific Legion users or groups. See docs/decisions/048-lesson-assignment.md.
--
-- Unassigned modules/tracks stay visible to everyone by default (matches the
-- existing zero-config behavior) - a row here only ever narrows visibility,
-- it never grants access to something otherwise hidden.

CREATE TABLE lesson_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL CHECK (target_type IN ('module', 'track')),
  target_id TEXT NOT NULL,
  assignee_type TEXT NOT NULL CHECK (assignee_type IN ('user', 'group')),
  -- A Legion member_code (assignee_type='user') or Legion group slug (assignee_type='group').
  assignee_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  UNIQUE (target_type, target_id, assignee_type, assignee_id)
);

CREATE INDEX idx_lesson_assignments_target
  ON lesson_assignments(target_type, target_id);
