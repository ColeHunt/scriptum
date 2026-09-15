# Elastic Dashboard Patches

Patch files in this directory are applied to the vendored
`vendor/elastic_dashboard` submodule before building Elastic's web bundle.

- `001-coderunner-integration.patch` adds a new `lib/services/coderunner_embed.dart`
  and wires it into two places:
  - `nt4_client.dart`: when loaded as `/elastic/?ws=<slug>`, the NT4 client
    connects to the control plane's proxied WebSocket
    (`/u/<slug>/sim/nt4?app=Elastic`) instead of a LAN robot address. Unlike
    the AdvantageScope Lite patch, this needs no `postMessage` handshake —
    Elastic's NT4 client has no "wait for hub" concept to race against, so the
    endpoint is just computed once from the URL at connect time.
  - `dashboard_page.dart` / `dashboard_page_layouts.dart`: the dashboard
    layout is hydrated from and mirrored to
    `src/main/deploy/elastic-layout.json` in the student's project (via
    `/u/<slug>/api/elastic-layout`) instead of only living in browser
    SharedPreferences, so it rides along with the robot project in git like a
    real competition deploy. The SharedPreferences copy is kept too, as a
    local cache/fallback if the request fails.

Run `bun run apply:elastic-patches` (or `bun scripts/apply-vendor-patches.ts
--tool=elastic` directly) to apply patches without building, or
`bun run build:elastic` to apply patches, run `flutter build web`, and
stage the result under `dist/elastic/`. `build:elastic` requires the Flutter
SDK (unlike `build:ascope`/`build:choreo`, it is deliberately **not** part of
`bun run build`; see docs/decisions/041-elastic-dashboard-integration.md) —
`bun run fetch:dist` instead downloads a prebuilt `elastic-dist.tar.gz` from
this repo's GitHub releases, built by the `build-elastic` job in
`.github/workflows/release.yml`.
