-- Replace Better Auth's OAuth identity model with Legion `mw_sso` identity.
--
-- Better Auth's `user`/`session`/`account`/`verification` tables were created
-- dynamically by its own migration engine (storage.ts, via
-- better-auth/db/migration), not by any static migration file here, so there is
-- no earlier CREATE TABLE for `user` in this directory to build on.
--
-- Under Legion there is no local session table at all: every request
-- re-verifies the `mw_sso` cookie fresh (see apps/control/src/legion/), so
-- `session`/`account`/`verification` hold nothing worth a staged rollback -
-- dropped outright rather than kept around for a later migration. `user` is
-- rebuilt by hand with Legion's shape: `id` is a Legion `member_code`, `email`
-- carries Legion's `username` (Legion has no email concept), and there is no
-- `emailVerified` column (nothing to verify - Legion already authenticated the
-- person over Slack).
--
-- FK checks are disabled by the migration runner before this runs.

DROP TABLE IF EXISTS session;
DROP TABLE IF EXISTS account;
DROP TABLE IF EXISTS verification;

-- A fresh database (no prior deployment) never had Better Auth's dynamically
-- created `user` table at all, so the rebuild below has nothing to select
-- from. This is a no-op on a real deployment's existing `user` table (it
-- already exists, with more columns - e.g. emailVerified - that the SELECT
-- below simply doesn't select) and creates an empty starting point otherwise.
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  image TEXT,
  role TEXT NOT NULL DEFAULT 'student',
  slug TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE user_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  image TEXT,
  role TEXT NOT NULL DEFAULT 'student',
  slug TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
INSERT INTO user_new (id, name, email, image, role, slug, createdAt, updatedAt)
  SELECT id, name, email, image, COALESCE(role, 'student'), slug, createdAt, updatedAt
  FROM user;
DROP TABLE user;
ALTER TABLE user_new RENAME TO user;

CREATE UNIQUE INDEX idx_user_email_unique ON user(email);
