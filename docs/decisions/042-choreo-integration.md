# 042 — Choreo integration

Status: **Accepted**, with its vendoring-mechanism decision **superseded by
[045](./045-choreo-submodule-migration.md)** — 2026-09-14 (records the
as-built decisions from the "Replace PathPlanner with Choreo" commits,
`f69b50a`/`a267b27`/`9ef1dab`; written after the fact because those commits
referenced this doc number before it existed — see decision 043's Context
for how that drift was caught). The first "Decision" bullet below (fork +
plain clone at build time, no patches) is superseded by 045 (submodule +
`patches/choreo/`) — everything else here (no deploy-files API, the
sidecar's own file access, the UI pane model, NT4 client-name passthrough)
is unaffected by that mechanism change and still accurate.

## Context

PathPlanner (decision 039) needed a separate Flutter fork
(`mathewdunne/pathplanner-web`) shipping prebuilt release artifacts, plus a
control-plane "deploy-files" file-sync API to hydrate/persist its in-memory
project copy over HTTP. Both were real ongoing costs: Flutter had to stay
completely out of this repo's own toolchain (no way to rebuild it locally
without the fork's own release process), and the deploy-files API was a
second, parallel way of reading/writing student project files alongside
VSCodium's own filesystem access, with its own security review surface and
its own edit-then-reload UX cost (external edits only reached PathPlanner on
iframe reload).

[Choreo](https://github.com/SleipnirGroup/Choreo) is FRC's actively
maintained path/trajectory planner. Unlike PathPlanner's Flutter GUI, its
frontend is plain Vite/React/TypeScript — this repo's own stack — making a
source-level fork practical to build inline instead of shipping prebuilt
artifacts from a separate release process.

## Decision

- **Fork, not a submodule — and NOT a no-patch tool.** `vendor/tools.json`
  lists Choreo as `kind: "clone"`: a plain `git clone` of a pinned commit of
  [`ColeHunt/Choreo`](https://github.com/ColeHunt/Choreo) (a fork of
  SleipnirGroup/Choreo), done at Docker build time — not a git submodule
  like AdvantageScope/Elastic. **Correction (this doc originally claimed
  "no source patches are applied... built as-is," which was wrong — verified
  via `gh api repos/ColeHunt/Choreo/compare/SleipnirGroup:main...ColeHunt:<pin>`,
  which shows the fork 5 commits ahead, 3 behind):** the fork *is* patched,
  just as direct commits on the fork itself rather than `patches/choreo/*.patch`
  files the way AdvantageScope/Elastic are. Those 5 commits are the entire
  CodeRunner-Choreo integration, not incidental tweaks:
  1. **`choreo-server`**: a new Rust/axum HTTP+WS sidecar wrapping
     `choreo-core` directly, replacing Choreo's native Tauri IPC boundary —
     ports the file-management/generation/codegen commands from
     `src-tauri/src/api.rs`, streams live solver progress over a
     `/ws/progress` WebSocket, and fixes the deploy root per-process via
     `CHOREO_DEPLOY_ROOT` (one instance per student) instead of Tauri's
     user-chosen deploy root.
  2. **Frontend ported off Tauri IPC** onto that sidecar's HTTP/WS API
     (every `invoke()` → `fetch()`/`WebSocket`), with desktop-only features
     with no browser equivalent (native file dialogs, diagnostic zip export)
     stubbed to reject clearly instead of hanging.
  3. **`base: /choreo/`** in the Vite config — without it, built asset URLs
     collide with CodeRunner's own `/assets/*` and the iframe renders blank.
  4. **Auto-discovery of the student's project** (`GET /project/discover`) —
     replaces the desktop Open-file-dialog flow, which has no browser
     equivalent, with a scan of the fixed per-student deploy root.
  5. **Bind `0.0.0.0`, not loopback** — required for the control plane to
     reach the sidecar over the Docker bridge network; loopback-only passed
     every same-container check (curl from inside, the s6 readiness probe)
     while being completely unreachable from outside it.

  In other words: embedding support does **not** live entirely on
  CodeRunner's side — most of it lives in these fork commits, and they need
  ongoing maintenance the same way `patches/advantagescope/`/`patches/elastic/`
  do. As of this correction the fork is already 3 commits behind upstream
  `SleipnirGroup/Choreo` main; periodically check
  `gh api repos/ColeHunt/Choreo/compare/SleipnirGroup:main...ColeHunt:<pin>`
  and rebase/cherry-pick upstream fixes as needed. A submodule (with these
  5 commits' worth of changes captured as `patches/choreo/*.patch` instead)
  would arguably make that divergence more visible than a fork does — worth
  reconsidering if the fork keeps drifting silently; not changed here since
  it's a real migration, not a docs fix.
- **Two build sites, deliberately not unified.** Choreo ships two artifacts
  from the same pinned commit: a Vite/React/TS web frontend (built in
  `containers/control/Dockerfile`'s `choreo-web-build` stage, served at
  `/choreo/`) and a Rust `choreo-server` binary — a small HTTP/WS sidecar
  wrapping `choreo-core`'s trajectory optimizer directly, no Tauri
  dependency — compiled in `containers/code/Dockerfile`'s `choreo-builder`
  stage and baked into the *workspace* image, not the control image. These
  stay separate stages in separate Dockerfiles because they serve
  fundamentally different roles: the frontend is control-plane-served
  static assets (like AdvantageScope/Elastic), while the sidecar is a
  process that runs *inside each student's own container* with direct
  filesystem access — unifying the build wouldn't remove real duplication,
  since one produces static files for one image and the other a native
  binary for a different image with a different (GCC 14, for Sleipnir's
  `<format>`/`<print>` usage) toolchain. The repo/commit pin itself,
  however, was real duplication risk across three independently-hand-edited
  `ARG CHOREO_REPO`/`CHOREO_COMMIT` defaults — see decision 043 for how that
  got single-sourced.
- **No deploy-files API — the sidecar owns its own file access.** Unlike
  PathPlanner's hydrate-over-HTTP model, `choreo-server` runs inside the
  student's own workspace container and reads/writes
  `src/main/deploy/choreo/**` on that container's local, already-bind-mounted
  filesystem directly (`CHOREO_DEPLOY_ROOT=/workspace/project/src/main/deploy/choreo`).
  The control plane's only job is reverse-proxying the browser's HTTP/WS
  traffic to it at `/u/:slug/api/choreo/**`
  (`apps/control/src/app/proxy.ts` `choreoHttpProxyResponse`/
  `choreoWebSocketResponse`, `apps/control/src/app/workspace-routes.ts`
  ~lines 275-293) — the same pattern already used for the editor and NT4,
  not a new file-sync surface to maintain or security-review. A
  `probeChoreoReady()` readiness probe (30s timeout) guards both the HTTP
  and WS proxy paths so a cold-starting sidecar surfaces as "not ready yet"
  rather than a raw connection-refused error.
- **UI**: Choreo joins the topbar's independently-toggleable pane row
  (editor / AdvantageScope / Choreo / Elastic — see decision 041), not a
  mutually-exclusive tab switcher like PathPlanner/AdvantageScope used to
  be. Any subset can be visible at once; `PaneVisibility.tsx`'s
  `WORKBENCH_PANE_KEYS` and `IDELayout.tsx`'s `WORKBENCH_COLUMN_ORDER` both
  gained a `choreo` entry. Defaults hidden, like Elastic.
- **NT4 client-name passthrough**, deferred by decision 039 as future work
  for exactly this "second NT4 client" moment, was resolved here (not by
  Choreo, which doesn't use NT4) but is worth noting as unblocked by this
  migration: `withNt4AppName()` in `apps/control/src/app/proxy.ts` lets the
  proxy identify which browser client is connecting via `?app=`, which
  Elastic (decision 041) went on to actually use.

## Consequences

- Flutter is fully out of `containers/control/Dockerfile`'s toolchain (it
  never had a Flutter stage for Choreo to begin with, unlike Elastic's
  deliberate exception — see decision 041).
- A student's Choreo edits are immediately on disk in their own container,
  with no iframe-reload staleness window the way PathPlanner's snapshot
  model had — external edits (VSCodium, lesson load, imports) are visible
  to `choreo-server` as soon as they hit the filesystem, since it's reading
  the same bind-mounted directory, not a separately-hydrated copy. A project
  swap still reloads the iframe (to reset Choreo's own in-memory UI state
  to match the new project), but the underlying data was never stale.
- `THIRD_PARTY_NOTICES.md` needs a Choreo entry (BSD-3-Clause, "Copyright
  (c) Choreo contributors") like every other vendored tool — this was
  missed when Choreo first shipped and is fixed as part of decision 043's
  drift-check mechanism, which would now catch a repeat.
