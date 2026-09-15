# 044 — Remote catalog checkpoint verification

Status: **Accepted** — 2026-09-14

## Context

Checkpoint verification (`CheckpointManager` in `apps/control/src/checkpoints.ts`)
was hard-wired to only work for the bundled catalog: `stateForModule()` returned
`available: false` whenever `catalogSource.kind !== "bundled"`, and `checkScript()`
resolved every verifier script path against `IMAGE_CATALOG_DIR`
(`/opt/frc-catalog`, baked into the control image at build time). A remote
catalog's `checkpoints/<id>/verify/*.sh` scripts have no equivalent baked-in
location, so they could never pass — and since `module.requires` (the actual
prerequisite gate; `track` is purely cosmetic) is satisfied by
`isModuleComplete()`, which checks that every required checkpoint has
`status: "passed"`, this meant any `requires` chain on an externally-hosted
module was permanently locked. Tracks and hard prerequisite locking, real
features already shipping for the bundled catalog, were effectively dead for
anything loaded from `LESSONS_CATALOG_REPO`.

The user has decided the external lessons repo should be allowed to ship its
own verifier scripts, run by the control plane at the same trust level as the
bundled catalog — not sandboxed further, since the same person authors both
the CodeRunner deployment and the lessons repo it points at. This decision is
about *how* those scripts get from the repo into a place `checkScript()` can
run them, not about further restricting what they're allowed to do once
fetched (matching the existing bundled behavior exactly: `runtimeProvider.exec`
inside the student's own container, non-root `abc` user, 15s timeout).

## Decision

- **Verify-time fetch, not load-time.** The obvious first design — fetch
  `checkpoints/<id>/` once when the lesson loads (alongside the module
  content `imports.ts` already fetches) and leave it at a fixed path for
  `checkScript()` to find later — turns out to be unsound: workspace
  containers are periodically **removed**, not just stopped, by
  `cleanupStoppedContainers()` (confirmed in
  `apps/control/src/containers/lifecycle.ts`), and recreated fresh from the
  image on next use. Only the bind-mounted `project`/`home` dirs survive
  that. A script cached at load time could vanish by the time a student
  actually clicks Verify (they loaded the lesson, went idle, came back
  later) — silently breaking verification in a way that would look like a
  transient bug, not a design limitation. `verify()` instead fetches
  `checkpoints/<moduleId>/` fresh, every time, via the same sparse shallow
  clone technique `imports.ts` already uses for module content
  (`git clone --depth 1 --filter=blob:none --sparse --branch <branch> --
  <cloneUrl> <dir>` then `sparse-checkout set checkpoints/<moduleId>`), into a
  throwaway per-verify-call staging dir (`/workspace/.checkpoint-fetch-<ts>-<rand>/`),
  cleaned up in a `finally` block after the checkpoint batch runs. This is
  correct regardless of container lifecycle state, at the cost of a small
  fetch (a handful of shell scripts) on each Verify click for a remote
  catalog — fetched **once per `verify()` call**, not once per checkpoint,
  and **only** when the batch being verified actually includes a `"script"`
  verifier (a batch of pure `"nt4-value"` checkpoints, e.g. `elastic-intro`'s
  live-telemetry checks, never touches the filesystem or the network).
- **`setupScript` is the one exception, fetched at load time.** Unlike verify
  scripts, a module's `setupScript` (e.g. `git-basics/setup.sh`, which builds
  real git history into the five scenario repos) runs exactly once,
  immediately after the module content is swapped into `/workspace/project`
  during `executeCatalogLoad()` — it mutates project content as a one-time
  step, not a repeatable check, so load-time fetching is correct for it and
  the container-recreation problem above doesn't apply (it's consumed
  synchronously within the same load operation, before that load's own
  staging dir is cleaned up). `apps/control/src/imports.ts`'s remote branch
  now sparse-checks-out `checkpoints/<moduleId>` alongside the module
  `subdir` in the *same* clone (no extra network round trip) whenever
  `ctx.setupScript` is set, and resolves `ctx.setupScript` against that
  fetched source dir instead of unconditionally building an
  `IMAGE_CATALOG_DIR`-rooted path.
- **`CatalogSource` interface grows two optional fields**, `cloneUrl` and
  `branchName` (`apps/control/src/catalog.ts`) — `RemoteCatalogSource`
  already exposed both as getters (used by `imports.ts`/`websocket.ts`); they
  just needed to be on the shared interface so `checkpoints.ts` can read them
  without downcasting. `BundledCatalogSource` leaves them undefined.
- **No new trust boundary.** `checkScript()`'s remote path runs the fetched
  script exactly the way the bundled path always has — same `exec()` call,
  same `WORKSPACE_USER`/`PROJECT_DIR`/`SCRIPT_TIMEOUT_MS`. The only thing
  that changed is *where the script file comes from* before that exec call,
  not what's allowed to happen once it runs.

## Consequences

- A remote catalog's `requires` chains and checkpoint-gated tracks now work
  identically to the bundled catalog's.
- Each Verify click against a remote-sourced module with `"script"`
  checkpoints costs one small sparse clone (typically a handful of shell
  scripts, occasionally a supporting `.java` check class — see
  `catalog/checkpoints/hello-world/verify/HelloWorldCheck.java` for the
  bundled precedent) in addition to the exec calls it already made. This was
  judged an acceptable, bounded cost against the alternative of a
  load-time-cached path that would be silently wrong after a container
  recycle.
- `checkScript()` no longer references `IMAGE_CATALOG_DIR` unconditionally —
  callers must pass a `scriptRoot` (`IMAGE_CATALOG_DIR` for bundled, the
  freshly-cloned staging dir for remote), computed once per `verify()` call
  rather than once per checkpoint.
- The external lessons repo scaffolded alongside this decision
  (`coderunner-lessons`, mirroring `catalog/`'s shape) ports `hello-world`
  (checkpoint-free) and `git-basics` (checkpoints + `setupScript`) from the
  bundled catalog as the worked proof that both paths — verify-time fetch and
  load-time `setupScript` fetch — work end to end against a real remote repo.
