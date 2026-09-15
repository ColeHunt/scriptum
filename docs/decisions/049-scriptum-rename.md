# 049 — Rename CodeRunner to Scriptum

Status: **Accepted** — 2026-09-15

## Context

CodeRunner's visual palette already matched the shared MARS/WARS "kiosk"
family (Legion, Munus, Tempus, Virtus) as of the retheme earlier this
session, but the product still read as a separate, differently-branded
project rather than a genuine member of that family — every sibling app
uses a Latin name (Legion, Munus "duty", Tempus "time", Virtus "virtue",
Merces "wages", Colosseum, Consilium "counsel"). The user asked for a name
that fits that convention and confirmed a full technical rename, not just
user-facing text.

## Decision

**New name: Scriptum** — Latin for "workshop/forge," evoking building and
crafting robot code. Applied as a full technical rename, not a cosmetic
skin:

- Package names (`frc-coderunner` → `frc-scriptum`, `@frc-coderunner/*` →
  `@frc-scriptum/*`) and every import of them.
- The `CODERUNNER_*` env var prefix → `SCRIPTUM_*`, everywhere it's
  live/current.
- Docker/container/network naming, the `coderunner` CLI dispatcher → `scriptum`,
  the per-student workspace container name prefix (`CODE_NAME_PREFIX`), the
  `coderunner-admin` Legion group name → `scriptum-admin`, the `app=coderunner`
  query param sent to Legion's SSO authorize/step-up endpoints, localStorage/
  Zustand persist keys, the `x-coderunner-editor-state` proxy header, the
  favicon asset (`coderunner-icon.png` → `scriptum-icon.png`).
- `README.md`, `AGENTS.md`/`CLAUDE.md`.

**Deliberately kept as `coderunner-workspace`/`coderunner-control`**: the
*default* GHCR image reference in `docker-compose.yml` and
`scripts/image.ts` (`${SCRIPTUM_IMAGE_NS:-ghcr.io/mathewdunne}/coderunner-<kind>`).
That string is the literal name of images actually published today under
the upstream maintainer's GHCR account — renaming it would point every
zero-config install (`bun run demo:docker`, the quick-start guide) at an
image that doesn't exist, a real breakage rather than a cosmetic one. This
fork's own `release.yml`/`deploy.yml`, by contrast, publish under
`github.repository_owner`'s own namespace and had never published anything
as `coderunner-*` that anyone depends on, so those were renamed freely to
`scriptum-workspace`/`scriptum-control`.

**Deliberately not touched**: the 48 existing decision logs (001–048) and
`docs/decisions/README.md`'s existing summary bullets — they're historical
record of what was named CodeRunner at the time each decision was made, the
same policy already used when PathPlanner was removed but its decision log
(039) kept unchanged. Also not touched: `docs/superpowers/` (a frozen
planning archive) and `graphify-out/` (generated — regenerate via
`graphify update .`).

**Explicitly deferred, needs a separate go-ahead when it actually happens,
not bundled into this rename**: renaming the live GitHub repository itself
(`ColeHunt/CodeRunner`) and any change to what gets published where in CI.
Both touch shared/external identity — clone URLs, published image
references — that a code-level rename alone doesn't and shouldn't silently
change.

## Consequences

- Anyone with a saved browser preference under the old localStorage/Zustand
  keys (`coderunner:pane-visibility`, `frc-coderunner-ui`) loses it once —
  falls back to defaults, not a data-loss concern.
- `docs/using-coderunner.md` and other doc *filenames* still say
  "coderunner" — renaming filenames (and every cross-reference/sidebar entry
  to them) was judged not essential to the rebrand's user-visible effect and
  left out of this pass to bound its size; only the prose inside them changes.
- `sso.test.ts`'s `PYTHON_TOKEN` fixture — a real token minted once by actual
  Python `itsdangerous` — still decodes to `groups: ["coderunner-admin"]`,
  since that's cryptographically baked into a frozen signature and can't be
  renamed; the test's expected claims were reverted to match, with a comment
  explaining why.
- If CodeRunner/Scriptum is ever actually registered as a Legion SSO consumer
  app, it needs to be registered under `scriptum`, not `coderunner` — nothing
  in this rename touches Legion's own configuration, since no live Legion
  instance was found to have this app registered under either name.
