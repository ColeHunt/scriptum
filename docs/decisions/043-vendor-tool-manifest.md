# 043 — Vendor tool manifest

Status: **Accepted** — 2026-09-14

## Context

Three vendored third-party FRC tools (AdvantageScope, Choreo, Elastic
Dashboard) each got wired into the build by hand, independently, in three
genuinely different ways (see decisions 002/archive, 041, 042):
AdvantageScope and Elastic are git submodules with source patches compiled
or fetched separately; Choreo is a plain clone-at-build-time fork with no
patches. Each touches, separately: `.gitmodules` (2 of 3), `package.json`
build scripts, one or more Dockerfile stages across two Dockerfiles,
`.github/workflows/release.yml`, a `<tool>DistDir` config field + env var,
a route-serving function, and a `THIRD_PARTY_NOTICES.md` section.

Nothing caught drift between these. Concrete evidence, found while auditing
this: Choreo's repo/commit pin was duplicated as independently-hand-edited
`ARG CHOREO_REPO`/`CHOREO_COMMIT` defaults in three separate files
(`containers/control/Dockerfile`, `containers/code/Dockerfile`,
`scripts/build-choreo.ts`); eight files referenced a decision doc,
`docs/decisions/040-choreo-integration.md`, that was never actually
written (040 turned out to be `040-selinux-container-mounts.md` — an
unrelated doc that happened to claim that number first); `THIRD_PARTY_NOTICES.md`
never gained a Choreo section at all despite it shipping in both images;
and PathPlanner's full removal (decisions 039 → 042) left a stale decision
doc never marked superseded, a stale `THIRD_PARTY_NOTICES.md` section and
summary row, `.env.example`/`docs/reference/configuration.md` half-updated
with dangling `PATHPLANNER_*` references, and roughly fifteen more docs
pages describing a `/pathplanner/` route, a `fetch:pathplanner` script, and
a deploy-files API that no longer exist. None of this was caught by CI,
review, or the type system — each was a plain string that had to be kept in
sync by hand across files with no mechanical relationship to each other.

Each tool's actual *build* toolchain (emsdk/C++/wasm for AdvantageScope,
Rust+cargo for Choreo's sidecar, Dart/Flutter for Elastic) genuinely can't
be unified — they compile fundamentally different upstream projects with
disjoint dependencies. What can be unified is the *scaffolding around* each
tool: where its pin/license/dist-path/env-var/decision-doc live, and a
mechanical check that everywhere those facts are supposed to be mirrored
still agrees with a single source of truth.

## Decision

- **`vendor/tools.json`** is the single source of truth per tool: `id`,
  `displayName`, `kind` (`"submodule"` | `"clone"`), `repoUrl`, `pin`
  (tag/commit), `submodulePath`/`patchesDir` (submodule tools only),
  `license`, `distDirEnvVar`, `imageDistPath`, `buildScript`, `buildSites`
  (Dockerfiles or other files referencing this tool's pin), and
  `docsDecisionRef`. Read via `scripts/vendor-manifest.ts`'s
  `loadVendorManifest()`/`getVendorTool(id)`.
- **Deliberately dependency-free**, not zod-validated like the runtime API
  schemas in `packages/contracts`: scripts under `scripts/` run directly via
  `bun <file>.ts`, and `scripts/apply-vendor-patches.ts` in particular also
  runs inside `containers/control/Dockerfile`'s `ascope-build` stage, which
  copies in only `vendor/`, `patches/`, and that one script — no
  `bun install`, so no `node_modules`/zod available there. Both
  `vendor-manifest.ts` and `apply-vendor-patches.ts` do their own small
  hand-rolled runtime validation instead.
- **Patch runners consolidated**: `scripts/apply-ascope-patches.ts` and
  `scripts/apply-elastic-patches.ts` (previously near-line-for-line
  duplicates) are now one `scripts/apply-vendor-patches.ts --tool=<id>`,
  reading `submodulePath`/`patchesDir` from the manifest instead of having
  them hardcoded per copy. `bun run apply:ascope-patches` /
  `bun run apply:elastic-patches` are real npm scripts now (previously only
  `patches/advantagescope/README.md` claimed the former existed).
  **The idempotent-apply algorithm was NOT left unchanged, despite this
  doc originally claiming so** — consolidating it surfaced a real,
  pre-existing bug: the original per-patch "is this already applied" check
  (`git apply --reverse --check` on that one patch) silently mis-detects
  whenever a *later* patch in the series further modifies a file an
  *earlier* patch already touched (the tree is in the later patch's
  post-apply state, not the earlier one's, so the earlier patch's own
  reverse-check fails even though it genuinely is applied). This isn't
  hypothetical — it already affected AdvantageScope's real 2-patch chain
  (both patches touch `src/main/lite/main.ts`) and Choreo's real 5-patch
  chain (decision 045), silently, since nothing had ever re-run the apply
  step against an already-patched tree before. Fixed by checking the whole
  series at once — reversing the *last* patch only, which can only succeed
  if every earlier patch's preconditions already held — instead of
  per-patch; see `scripts/apply-vendor-patches.ts` and its test coverage
  for the fixed behavior.
- **Route serving generalized**: `choreoWebAssetResponse`/
  `elasticWebAssetResponse` in `apps/control/src/app/assets.ts` (previously
  structurally identical, copy-pasted functions) are now one-line wrappers
  around a new `vendorDistAssetResponse(distDir, mountPrefix, pathname,
  notBuiltMessage)` helper. `scopeResponse` stays bespoke — it also walks an
  asset manifest, a genuinely AdvantageScope-specific concern — rather than
  being forced into the same shape.
- **Choreo's pin single-sourced** (superseded by
  [decision 045](./045-choreo-submodule-migration.md), noted here for
  history only): originally via `--build-arg CHOREO_REPO=.../CHOREO_COMMIT=...`
  passed by `scripts/image.ts`, reading `vendor/tools.json`, into Dockerfile
  `ARG` defaults. Once Choreo moved to the submodule+patches pattern (045),
  this entire mechanism became unnecessary rather than wrong — a submodule's
  pin lives in `.gitmodules`/the checked-out commit, not a build arg, the
  same as AdvantageScope/Elastic always worked — so `choreoBuildArgs()` and
  both Dockerfiles' `ARG CHOREO_REPO`/`ARG CHOREO_COMMIT` lines were removed
  in that migration, not kept as dead fallback code. The dual Dockerfile
  build structure itself is still untouched (see decision 042's
  Consequences) — Choreo's web frontend and its Rust sidecar are still built
  as two genuinely separate artifacts, both now from the same submodule.
- **`scripts/check-vendor-manifest.ts`**, wired into `bun run verify`
  (`biome ci && typecheck && check:vendor-manifest && test && ...`), cross-
  validates, per tool: a submodule tool has a matching `[submodule "..."]`
  block in `.gitmodules` with the same repo URL; `THIRD_PARTY_NOTICES.md`
  mentions the tool's `displayName`; a `patches/<tool>/README.md` exists
  when `patchesDir` is set; `distDirEnvVar` is referenced in both
  `.env.example` and `apps/control/src/config.ts`; at least one `buildSite`
  references `imageDistPath`; and, for `kind: "clone"` tools specifically,
  every listed `buildSite` still contains the manifest's `pin` literally
  (the exact class of drift that hit Choreo's triplicated `ARG` defaults).
  This is the mechanism that would have caught PathPlanner's stale-doc
  aftermath and Choreo's missing `THIRD_PARTY_NOTICES.md` entry, both fixed
  by hand as part of landing this decision.
- **Decision-doc convention**: a tool's `docsDecisionRef` should point at a
  real, existing file. This alone doesn't mechanically prevent a dangling
  reference the way the checks above do for the other facts (a doc path
  string isn't verified to exist by `check-vendor-manifest.ts` today — see
  Consequences), so treat "reserve and write the decision doc" as a real
  step when vendoring a new tool, not an afterthought.

## Consequences

- `check-vendor-manifest.ts` does **not** verify a submodule's actually
  checked-out commit against `pin` (only that `.gitmodules` points at the
  right path/URL) — doing so would require the submodule to be initialized
  in whatever environment runs the check, which isn't guaranteed (a
  lightweight CI job might not run `--recurse-submodules`). This is an
  accepted gap: the check catches "wrong tool/repo wired up," not "stale
  commit checked out."
- It also doesn't verify `docsDecisionRef` points at a file that exists —
  only that the manifest *has* a non-empty value there. A future
  enhancement could add that check trivially (`readIfExists` is already the
  pattern used for every other check in the script); left out of v1 to keep
  the initial change reviewable, not because it's hard.
- Onboarding a new vendor tool is now: add one `vendor/tools.json` entry,
  write its decision doc, and let `check-vendor-manifest.ts` fail loudly
  until every mirrored fact (`.gitmodules`, `THIRD_PARTY_NOTICES.md`,
  `.env.example`, `config.ts`, the relevant Dockerfile) is actually in
  place — rather than each of those being a manual checklist item nobody
  re-derives from first principles months later.
