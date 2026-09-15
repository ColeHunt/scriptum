# 041 — Elastic Dashboard integration

Status: **Accepted** — 2026-09-13

## Context

Students should be able to view live NT4 telemetry in
[Elastic Dashboard](https://github.com/Gold872/elastic_dashboard), a
Flutter-based FRC dashboard, alongside AdvantageScope. Two established
patterns already exist in this repo for embedding a third-party dashboard:

- **AdvantageScope Lite**: vendored as a git submodule
  (`vendor/AdvantageScope`), source-patched (`patches/advantagescope/`) to
  accept an injected NT4 endpoint, and built inside this repo's own Docker
  image via a dedicated emsdk build stage.
- **PathPlanner** (decision 039, later reverted — see `git log --oneline --
  docs/decisions/039-pathplanner-integration.md`): forked into a separate
  repo (`mathewdunne/pathplanner-web`) that shipped **prebuilt** web dist
  tarballs, keeping Flutter out of this repo's toolchain entirely. It was
  fully replaced by Choreo (a plain Vite/React/TS fork, built inline in this
  repo's Dockerfile) specifically to remove that Flutter dependency — see
  `scripts/build-choreo.ts` and the "Replace PathPlanner with Choreo" commits.

Elastic can't be rewritten onto a JS/TS stack the way Choreo was (it isn't a
thin wrapper around a swappable frontend), so the AdvantageScope pattern is
the closer fit — but reintroducing a Flutter build stage into
`containers/control/Dockerfile` would be exactly the toolchain weight this
repo already removed once. This decision keeps the *source-level vendoring
and patch* half of the AdvantageScope pattern (so the diff is reviewable and
lives in this repo's history) while keeping the *build* half out of this
repo's own Docker/CI, matching PathPlanner's original artifact-fetch
philosophy instead.

## Decision

- **Vendoring**: `vendor/elastic_dashboard` is a git submodule pinned to
  `v2026.1.2`. `patches/elastic/001-coderunner-integration.patch` adds a new
  `lib/services/coderunner_embed.dart` and wires it into `nt4_client.dart`
  (NT4 endpoint override) and `dashboard_page.dart` /
  `dashboard_page_layouts.dart` (layout load/save). See
  `patches/elastic/README.md` for the exact patch points.
- **Embedding, no `postMessage` handshake needed**: Elastic is iframed as
  `/elastic/?ws=<slug>` — the same `?ws=` convention Choreo already uses,
  rather than AdvantageScope Lite's `postMessage` handshake. Elastic's NT4
  client has no "wait for a hub iframe" concept to race against (unlike AS
  Lite's Electron-derived hub/popup split), so the patch just reads
  `Uri.base.queryParameters['ws']` once at connect time and computes the
  proxied endpoint directly — no injection race, no timeout banner needed.
- **NT4 proxy client-name passthrough**: the control plane's `/sim/nt4`
  proxy previously pinned every upstream connection's identity to
  `/nt/AdvantageScopeLite` regardless of which browser client asked (flagged
  as deferred tech debt in decision 039, for exactly this "second client"
  moment). `withNt4AppName()` (`apps/control/src/app/proxy.ts`) now
  substitutes the trailing `/nt/<name>` segment from a validated `?app=`
  query param, defaulting to `AdvantageScopeLite` for backward
  compatibility. Elastic connects as `/u/<slug>/sim/nt4?app=Elastic`.
- **Layout persistence**: the dashboard layout is mirrored to
  `src/main/deploy/elastic-layout.json` in the student's project via a new
  `GET`/`PUT /u/:slug/api/elastic-layout` (ownership-checked like every other
  `/u/:slug/*` route, capped at 2 MB, validated as a JSON object), so it
  rides along with the robot project in git like a real competition deploy.
  The browser's own SharedPreferences copy is kept as a local
  cache/fallback if the request fails — this is a single fixed file, not the
  general multi-file "deploy-files" tree API decision 039 once proposed for
  PathPlanner, which was never built.
- **Build, deliberately outside this repo's Docker/CI**: `scripts/build-
  elastic.ts` (`bun run build:elastic`) applies patches and runs `flutter
  build web --release`, staging `dist/elastic/`. It requires the Flutter SDK
  on whatever machine runs it — never inside `containers/control/Dockerfile`,
  which instead has a `FROM scratch AS elastic-dist` stage that copies a
  pre-populated `dist/elastic/` from the build context (or a CI-supplied
  `--build-context elastic-dist=<dir>`, mirroring how the arm64 control
  build already reuses the amd64 job's `ascope-dist`). `bun run build` (the
  from-source release path) does **not** depend on `build:elastic` — a new
  `build-elastic` job in `.github/workflows/release.yml` builds it on a
  Flutter-equipped runner and uploads `elastic-dist.tar.gz` to the same
  GitHub release as `ascope-dist.tar.gz`/`web-dist.tar.gz`. `bun run
  fetch:dist` (the demo/quick-start path) downloads it as an **optional**
  artifact, matching PathPlanner's original "optional for demo/recovery
  paths" framing — a missing or failed fetch just leaves `/elastic/` serving
  a 503, and everything else is unaffected.
- **UI**: Elastic joins the independently-toggleable pane row (editor /
  AdvantageScope / Choreo / Elastic / Driver Station) added when the tab
  model was replaced — any subset can be visible at once. It defaults to
  hidden, like Choreo. `PaneVisibility.tsx`'s `WORKBENCH_PANE_KEYS` and
  `IDELayout.tsx`'s `WORKBENCH_COLUMN_ORDER` both gained a fourth entry.

## Consequences

- `containers/control/Dockerfile` never gains a Flutter/Dart toolchain
  stage. The tradeoff is that a **local** `docker build`/`docker:build:control`
  now needs `dist/elastic/` populated ahead of time (via `fetch:dist` or
  `build:elastic`) or the image ships without Elastic — this is the same
  precondition the AdvantageScope submodule/emsdk setup already imposes on
  local builds, not a new class of fragility.
- The Settings dialog's IP-address field is not disabled when embedded; it
  has no effect once `coderunnerNt4Endpoint()` is set, since the override
  always wins. Left as a known rough edge for v1 rather than patching
  Elastic's settings UI, matching how PathPlanner's original v1 accepted
  known gaps (NT4 sync deferred) rather than gold-plating.
- **Update**: the Dart patch has since been compiled and verified for real
  (a Flutter SDK turned out to be available after all — `bun run build:elastic`
  succeeds, producing a working `dist/elastic/` whose compiled
  `main.dart.js` contains the expected injected behavior:
  `sim/nt4?app=Elastic` and `api/elastic-layout` as literal strings, which
  survive release-build minification since they're runtime string literals,
  not Dart symbols). `scripts/verify-elastic.ts` (`bun run verify:elastic`,
  mirroring `verify-ascope.ts`) checks this on demand: patch applicability,
  the staged bundle's presence and injected-behavior strings, and
  `/elastic/` static serving. The `pubspec.lock`/`analysis_options.yaml`
  changes a local build produces alongside the four patched source files
  are normal `flutter pub get`/tooling side effects (dependency-resolution
  drift and an automatic "upgrading analysis_options.yaml" migration,
  respectively) — not something the patch itself needs to capture.
- Manual layout imports/exports (Elastic's local file-picker flow) are
  already hidden on web builds upstream and are untouched by this patch;
  only the SharedPreferences-backed autosave/autoload path is intercepted.
