# 045 — Choreo submodule migration

Status: **Accepted** — 2026-09-15 (supersedes 042's "fork, not a submodule"
decision)

## Context

Decision 042 (as originally written) chose a plain `git clone` of a pinned
commit of a fork (`ColeHunt/Choreo`) at Docker build time, on the claim that
Choreo needed no source patches. That claim was wrong — verified directly
against GitHub (`gh api repos/ColeHunt/Choreo/compare/SleipnirGroup:main...ColeHunt:<pin>`):
the fork carried 5 real commits of CodeRunner-specific integration work (the
entire `choreo-server` sidecar, the frontend's port off Tauri IPC, a Vite
base-path fix, project auto-discovery, and a bind-address fix — see 042's
correction for the full list) and was already 3 commits behind upstream
`SleipnirGroup/Choreo` main, invisibly, since nothing had ever diffed the
fork against upstream before.

A fork carrying real modifications as ordinary commits, with no periodic
diff against upstream, has no visible signal when it drifts — the only way
to notice is to go looking, the way this decision's Context section just
did. AdvantageScope's and Elastic's submodule-plus-`.patch`-files pattern
gives that signal for free: bumping the pin and re-running
`apply-vendor-patches.ts` either applies cleanly (nothing to do) or fails
loudly with the exact file/hunk that conflicts (something upstream changed
that needs attention) — "as easy as possible to maintain with the other
external apps constantly having updates" was the explicit goal driving this
migration.

## Decision

- **`vendor/Choreo` is now a git submodule** pointing at real upstream
  [`SleipnirGroup/Choreo`](https://github.com/SleipnirGroup/Choreo) (not the
  `ColeHunt/Choreo` fork, which is no longer referenced anywhere in this
  repo and can be archived/left alone), pinned to
  `6eccc5afc978d2fce36125f476cea85ecbfd3052` — chosen as upstream's current
  `main` tip at migration time, not the fork's original, staler base, since
  the 3 commits the fork was missing (`trajoptlib`/`choreolib` internals,
  confirmed via `gh api` to touch zero files in common with the patches)
  cost nothing to pick up while already doing this migration.
- **The fork's 5 commits became `patches/choreo/001` through `005`**, one
  patch per original commit, generated as `git diff <parent>..<commit>` from
  a clone of the fork and verified to apply cleanly, in sequence, against
  the new pin before committing to this approach (see `patches/choreo/README.md`
  for what each one does and how to check for future conflicts). Applied via
  the same `scripts/apply-vendor-patches.ts --tool=choreo` every other
  patched vendor tool uses — no new mechanism.
- **`vendor/tools.json`'s `choreo` entry changes `kind` from `"clone"` to
  `"submodule"`**, gains `submodulePath`/`patchesDir`, and `repoUrl` changes
  from the fork to upstream. `check-vendor-manifest.ts` needed no code
  changes — `checkSubmodule`'s `.gitmodules` check and `checkSubmodule`'s
  drift-checking already covered this shape, it just wasn't exercised for
  Choreo before.
- **Both Dockerfiles rewired**: `containers/control/Dockerfile`'s
  `choreo-web-build` stage now copies the submodule (gitdir + worktree +
  `patches/`) and runs `scripts/build-choreo.ts` (rewritten to call
  `applyVendorPatches("choreo")` + `bun install`/`vite build` inside
  `vendor/Choreo`, matching `build-ascope-lite.ts`'s shape), instead of
  cloning the fork at build time. `containers/code/Dockerfile`'s
  `choreo-builder` stage (the Rust sidecar) copies the same submodule
  content and applies patches via plain `git apply` in a `RUN` step rather
  than `apply-vendor-patches.ts` — this stage has no Bun/Node toolchain
  (Rust/GCC only), so invoking the shared TS tool isn't an option here; the
  patch files themselves are the shared artifact, not the runner. Both
  stages' `ARG CHOREO_REPO`/`ARG CHOREO_COMMIT` lines are gone — the
  submodule pin is the only source of truth now, so `scripts/image.ts`'s
  `choreoBuildArgs()` (added in decision 043 specifically to keep those args
  in sync with the manifest) is also gone, having become unnecessary rather
  than wrong.
- **A real, pre-existing bug in `apply-vendor-patches.ts`'s idempotency
  check surfaced and got fixed as part of this migration**: the original
  per-patch "is this already applied" check (`git apply --reverse --check`
  on that one patch alone) silently misdetects whenever a later patch
  further modifies a file an earlier patch already touched — which is
  exactly Choreo's `main.rs`/`handlers.rs` (created by patch 001, further
  modified by 002/004/005) and, it turns out, already true of
  AdvantageScope's own 2-patch chain too (`src/main/lite/main.ts`, touched
  by both). Fixed by checking the *whole series* at once (reversing only
  the last patch, which can only succeed if every earlier patch's
  preconditions already held) instead of per-patch — see
  `scripts/apply-vendor-patches.ts` and its test coverage. This was a
  correctness bug, not scope creep from this migration: it would have
  caused a real build failure the next time anyone re-ran the apply step
  against an already-patched `vendor/AdvantageScope`.

## Consequences

- Bumping Choreo's pin going forward is the same three-step motion as
  AdvantageScope/Elastic: update `vendor/tools.json`'s `pin`, `cd vendor/Choreo
  && git fetch && git checkout <new-pin>`, run `bun run apply:choreo-patches`
  (or `build:choreo`) and see whether it's clean or which file/hunk
  conflicts. `patches/choreo/README.md` documents the `gh api compare`
  one-liner to check for likely conflicts before even attempting the bump.
- The `ColeHunt/Choreo` fork is no longer referenced by this repo at all.
  Not deleted (GitHub forks aren't typically deleted casually, and it's
  harmless sitting unreferenced), just no longer the source of truth for
  anything here.
- `containers/code/Dockerfile`'s `choreo-builder` stage now depends on
  `patches/choreo/*.patch` applying via plain `git apply` with no
  `apply-vendor-patches.ts`-level validation (no whole-series idempotency
  check, no friendly error formatting) — acceptable since this stage always
  starts from a freshly-COPYed, unpatched submodule checkout (never re-run
  against an already-patched tree the way a local `bun run build:choreo`
  might be), so the idempotency concern that motivated the TS runner's fix
  above doesn't apply here.
