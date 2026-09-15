# 046 — Legion auth integration (replaces Better Auth)

Status: **Accepted** — 2026-09-15 (supersedes 014's Better Auth adoption)

## Context

CodeRunner had its own siloed identity provider (Better Auth, GitHub/Google
OAuth) plus a hand-rolled `data/allowlist.json` email/domain gate, while every
sibling app in this family (Munus, Tempus, Virtus) already runs on Legion — a
shared, Slack-native, passwordless SSO service the user already operates for
their team. There was also no way to target specific lessons at specific
students without a real identity/group system to target against (see 047).

Legion is *not* OAuth/OIDC. A client app verifies Legion's `mw_sso` cookie
locally — no callback to Legion — signed via Python's
`itsdangerous.URLSafeTimedSerializer(SSO_SECRET, salt="mw-sso")`. Per Legion's
own `CLAUDE.md` ("nothing is imported across the three projects"), each
sibling app hand-writes its own small integration rather than depending on a
shared package; CodeRunner does the same in TypeScript.

Confirmed with the user going in: **full replace** (Better Auth removed
entirely, not run alongside Legion), demo mode stays fully standalone with no
Legion configured, and **Legion membership alone is the access gate** — no
local allowlist.

## Decision

- **New `apps/control/src/legion/sso.ts`** — a from-scratch TypeScript port of
  `itsdangerous.URLSafeTimedSerializer`, verified byte-for-byte against the
  installed itsdangerous 2.2.0 source (`/prj/frc/apps/legion/venv`): compact
  JSON payload, optional zlib-deflate compression with a `.` prefix marker,
  base64url encoding throughout, HMAC-SHA1 over `payload_b64.timestamp_b64`
  using itsdangerous's default "django-concat" key derivation
  (`SHA1(salt + "signer" + secret)`). Verify has a fixture test
  (`sso.test.ts`) cross-checked against a token minted by the real Python
  package — the single highest-value test in this change, since a subtle
  algorithm mismatch would fail silently as "cookie never verifies."
- **New `apps/control/src/legion/session.ts`** resolves the `mw_sso` cookie
  into the same session shape `getSessionFromRequest` already returned, so
  `requireSession`/`requireWorkspaceOwnership`/`requireAdmin`
  (`auth/middleware.ts`) needed no signature changes. `role` is recomputed
  fresh on every request from the cookie's `groups` claim (`"admin"` iff
  `groups` includes `coderunner-admin`) rather than stored — there is no local
  session table, so nothing can go stale. A `via:"link"` (magic-link) session
  is still valid for the student portal but forced non-admin;
  `requireAdmin` redirects such a session to Legion's `/sso/stepup` instead of
  a flat 403, matching every sibling app's convention.
- **The wire field `email` is kept**, now populated with Legion's `username`
  (Legion exposes no email at all) — renaming it across the ~15 call sites
  that read `session.user.email`/`SessionResponse.user.email` would have been
  a large, purely mechanical diff for no behavior change. UI copy was
  relabeled instead (e.g. the admin Users table's "Email" column header now
  reads "Username").
- **`id` is Legion's `member_code`** (8 lowercase hex chars) — this required
  widening `packages/contracts/src/index.ts`'s user-id pattern (previously
  `BETTERAUTH_ID_PATTERN`, `{16,64}` chars) down to `{4,64}`, since a
  16-character minimum silently rejected every Legion session. Caught before
  it shipped, but flagged here because it's the kind of bound that fails
  invisibly.
- **Local roster mirror is lazy upsert-on-login**, not a periodic sync job —
  `getLegionSessionFromRequest` calls `storage.upsertLegionUser()` +
  `ensureWorkspaceForUser()` on every resolved session. Simpler than a
  scheduler, and avoids a hard `LEGION_API_KEY` runtime dependency this scope
  doesn't need (see `scripts/migrate-legion-identity.ts` below for the one
  place that *does* need the roster API).
- **`data/allowlist.json` is deleted entirely** — `auth/allowlist.ts`, the
  `/admin/allowlist*` routes, the `coderunner allowlist` CLI subcommand, the
  web Allowlist admin page, and the `bun run allowlist:*` npm scripts are all
  gone. Legion membership is the only gate now.
- **Better Auth is deleted outright**: `auth/{auth,providers}.ts`, the
  `/api/auth/*` route passthrough, the web `auth-client.ts` wrapper, and the
  dependency itself. No OAuth-style callback route exists under Legion —
  Legion's own `/sso/authorize` mints the cookie and redirects straight back
  to `return_to` on CodeRunner's own domain.
- **New migration `013_legion_identity.sql`** drops `session`/`account`/
  `verification` outright (there is nothing worth a staged rollback under a
  no-local-session design) and rebuilds `user` by hand — confirmed Better
  Auth's `user`/`session`/`account`/`verification` tables were never defined
  by a static migration file here at all; they were created dynamically by
  `better-auth/db/migration` at boot (`storage.ts`'s old step 4). The new
  `user` table drops `emailVerified` (nothing to verify — Legion already
  authenticated the person over Slack) and is a single migration rather than
  the originally-considered two-step (additive now, drop-tables later) —
  confirmed with the user there's no real "something to preserve" in those
  three tables.
- **Admin role management moved to Legion entirely**: the `/admin/users/:id/
  (promote|demote)` routes, `bun run users:promote`/`users:demote`, and the
  web Users page's Promote/Demote buttons are all gone — there is no local
  role to persist a promotion into anymore. `bun run users:list` (read-only)
  remains. Deleting a user via the admin Users page now only clears their
  local workspace/project files (relabeled "Delete workspace" in the UI,
  audited as `workspace.delete`) — it can't revoke Legion access, and the
  person is lazily re-upserted with a fresh empty workspace on their next
  Legion sign-in.
- **New read-only `scripts/migrate-legion-identity.ts`** — Legion's read API
  has no `username` field (only `name`, `member_code`, `role`, `groups`, …),
  so there is no reliable machine key to join a pre-existing local `user` row
  against a Legion roster entry. This can only ever be a best-effort NAME
  match; the script prints a matched/ambiguous/unresolved report and writes
  nothing. A live-data check found `data/app.db`'s only real row matches demo
  mode's own fixed seed user, which meaningfully lowers the practical
  migration risk — but the script exists for anyone with genuine pre-Legion
  production data.

## Consequences

- CodeRunner and the Legion instance it points at must share a parent domain
  (Legion's own `SSO_COOKIE_DOMAIN`) for the browser to send `mw_sso` to both
  — a deploy-topology prerequisite, not a CodeRunner config knob.
  `SSO_SECRET`/`SSO_SESSION_TTL` must match Legion's own values exactly.
- A `coderunner-admin` Legion group must exist (created in Legion's own
  `/admin/groups`) before any real deployment can reach `/admin`.
- Demo mode (`CODERUNNER_DEMO_MODE=1`) is completely unaffected — it still
  short-circuits to a synthetic admin session before Legion is ever consulted,
  and needs no `SSO_SECRET` configured.
- `packages/contracts/src/index.ts`'s `authProviderSchema`/
  `authProvidersResponseSchema` (OAuth provider discovery) are gone — there is
  only one sign-in path now, so `/login` is a single static "Sign in via
  Legion" button rather than a dynamically-discovered provider list.
