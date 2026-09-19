# 051 — Split the catalog manifest into an index plus per-module files

Status: **Accepted** — 2026-09-19

## Context

`modules.json` held every module's full definition inline: title,
description, `subdir`, `kind`, `requires`, `setupScript`, and its entire
`checkpoints` array, all in one file at the repo root. In the external
lessons repo this grew past 900 lines across 13 modules, and every edit to
any single lesson - adding a checkpoint, fixing a description, tweaking a
verifier - touched the same file every other lesson's edits also touch.
Nothing about a lesson's own data lived anywhere near that lesson's own
directory.

## Decision

Split the manifest across two kinds of file:

- **`modules.json`** stays at the repo root, but only carries the
  curriculum-sequence index: `id`, `order`, `track` per module - just enough
  to sort and group the Switch Project picker. It remains the authoritative
  list of which module ids exist.
- **`modules-meta/<id>.json`** carries everything else: `title`,
  `description`, `subdir`, `kind`, `requires`, `setupScript`, `checkpoints`,
  etc. (`lessonModuleDetailSchema` - `lessonModuleSchema` minus `id`/`order`/
  `track`). `id` isn't repeated in it; the catalog source already knows it
  from the index entry that pointed here.

`CatalogSource.getManifest()` reads the index, then reads (bundled) or
fetches (remote, one raw-content request per module, in parallel) each
entry's `modules-meta/<id>.json` and merges `{ ...detail, id, order, track }`
back into the full `LessonModule` shape everything downstream already
expects. Nothing past `getManifest()` changed - `/api/lessons`, lock-state
resolution, checkpoint verification, and the frontend picker all still see
one flat `LessonModule[]`.

### `modules-meta/`, not `modules/<id>/module.json`

The obvious-looking alternative - nesting `module.json` inside the module's
own `modules/<id>/` directory, right next to its `README.md` and source
files - is wrong: that directory (`subdir`) is `cp -a`'d byte-for-byte into
the student's workspace on load (`imports.ts`'s `swapProject()`). A
`module.json` living there would land in the student's Explorer alongside
their real files, visible and confusing, and leaking checkpoint ids/titles/
verify-script paths the same way an exposed verify script already would -
exactly the thing `checkpoints/<id>/` already exists to avoid for scripts.
`modules-meta/` is a sibling of `modules/` and `checkpoints/`, not nested in
either, so it's structurally impossible for it to get copied.

### Module `id` gets a real charset constraint

`id` was `z.string().min(1)` - unconstrained, because it had only ever been
used as an object key/array-`find` value. This split makes it a path and URL
segment for the first time (`modules-meta/<id>.json`, and already
`modules/<id>/`, `checkpoints/<id>/`), so it now carries the same
lowercase-kebab-case regex a checkpoint id already has. Every id in both the
bundled and external catalogs already happened to comply.

### Why per-module fetches, not a repo clone, for the remote source

`RemoteCatalogSource` already does the cheapest thing available for a
manifest that has to answer instantly and refresh every 60 seconds: an
unauthenticated `fetch` of a raw-content URL. Splitting the manifest turns
that into 1 + N such fetches (N = module count, today 13) instead of 1. Two
alternatives were considered and rejected:

- **A tarball/zipball download** (`codeload.github.com/.../tar.gz/<branch>`)
  keeps it to one request, but trades a few-KB JSON fetch for the whole
  repo's bytes on every cache refresh, and needs an in-process tar/gzip
  reader the control plane doesn't otherwise have.
- **The sparse-checkout git clone** `checkpoints.ts`/`imports.ts` already use
  for fetching a single module's `checkpoints/<id>/` tree on demand runs
  *inside a workspace container* via `runtimeProvider.exec` - it needs a
  running container. Listing the catalog has to work with none running yet
  (a student who has never started one, or is just browsing lessons), so
  that mechanism isn't available to `getManifest()` at all.

N parallel `fetch()` calls to the same raw-content CDN is one wall-clock
round trip in practice, reuses the exact primitive already in place, and
needs no new dependency. At the catalog sizes this project runs (low tens of
modules), the added requests are cheap; revisit if a catalog ever grows into
the hundreds.

## Consequences

- A partial failure is now possible: the index fetch can succeed while one
  module's detail fetch 404s or returns malformed JSON. `mergeModule()`
  wraps every failure with the offending module id and rethrows, so the
  whole `getManifest()` call fails the same way a corrupt `modules.json`
  already did - falling back to the last-good cached manifest, or an empty
  list with an error string if there's no cache yet. A single bad module
  cannot silently vanish from the catalog.
- `scripts/catalog-integrity.test.ts` now loads the bundled catalog through
  the real `BundledCatalogSource` instead of hand-parsing `modules.json`, so
  it actually exercises the split/merge path end to end, not just the
  merged schema's shape.
- Test fixtures across `apps/control/src/__tests__/` still define modules in
  the old flat shape (id/title/description/... all on one object); only how
  they're written to disk changed, via a shared `writeCatalogDir()` helper
  in `__tests__/helpers.ts` that does the index/detail split for them.
