# Choreo Patches

Patch files in this directory are applied to the vendored `vendor/Choreo`
submodule before building Choreo's web frontend and `choreo-server` sidecar.
Ported from the `ColeHunt/Choreo` fork's own commit history when Choreo moved
to the same submodule-plus-patches pattern AdvantageScope/Elastic use — see
[decision 045](../../docs/decisions/045-choreo-submodule-migration.md). Apply
in order; each depends on the files the previous one adds.

- `001-choreo-server-sidecar.patch` adds the entire `src-server/` crate: a
  Rust/axum HTTP+WS sidecar wrapping `choreo-core` directly, replacing
  Choreo's native Tauri IPC boundary. Ports the file-management, generation,
  and codegen commands from `src-tauri/src/api.rs`; skips desktop-only ones
  (native file dialogs, "open in explorer") and `set/get_deploy_root` (the
  sidecar's deploy root is fixed per-process via `CHOREO_DEPLOY_ROOT`, since
  each instance serves one student). Live solver progress streams to browser
  clients over a `/ws/progress` WebSocket.
- `002-frontend-tauri-to-http.patch` replaces every `invoke()` call in
  `tauriCommands.ts` with `fetch()` against the sidecar, and the desktop
  build's Tauri event listener for live solver progress with a WebSocket
  (`progressSocket.ts`) to `/ws/progress`. Desktop-only features with no
  browser equivalent (native file dialogs, save-as, codegen folder picker,
  diagnostic zip export) are stubbed to reject with a clear "not supported"
  message instead of silently hanging.
- `003-vite-base-path.patch` sets `base: /choreo/` in `vite.config.ts` so
  built asset URLs match where CodeRunner serves this build — without it,
  asset URLs collide with CodeRunner's own `/assets/*` and the iframe renders
  blank. Tauri desktop builds still get root-relative paths (branches on
  `TAURI_PLATFORM`).
- `004-auto-discover-project.patch` adds `GET /project/discover`, scanning
  the fixed per-student deploy root for an existing `.chor` file, and wires
  `openProjectFile()` to try it as a last resort — the only way left to open
  a project once the desktop-era checks (CLI arg, localStorage) are dead in
  the browser IDE and the native Open dialog is correctly stubbed as
  unsupported.
- `005-bind-0.0.0.0.patch` binds the sidecar to `0.0.0.0` instead of
  loopback — required for the control plane to reach it over the Docker
  bridge network by container name; loopback-only passes every same-container
  check (curl from inside, the s6 readiness probe) while being completely
  unreachable from outside it.

Run `bun run apply:choreo-patches` (or
`bun scripts/apply-vendor-patches.ts --tool=choreo` directly) to apply
patches without building, or `bun run build:choreo` to apply patches and
build both the web frontend and `choreo-server`.

## Maintaining these against upstream

Unlike a plain fork, patch-apply failure is a loud, specific signal that
upstream touched a file these patches also touch — check
`git apply --check` output (or `apply-vendor-patches.ts`'s own error) for
exactly which file and hunk conflicts, rather than discovering silent drift
later. To check whether upstream has moved since the current `vendor/tools.json`
pin, and whether that's likely to conflict, without bumping anything yet:

```bash
gh api repos/SleipnirGroup/Choreo/compare/<current-pin>...main --jq '.commits[] | .commit.message'
gh api repos/SleipnirGroup/Choreo/compare/<current-pin>...main --jq '.files[].filename'
```

Cross-reference the second command's file list against the files these
patches touch (see each patch's own `diff --git` headers) — if there's no
overlap, bumping the pin is very likely a clean `git apply`.
