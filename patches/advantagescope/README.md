# AdvantageScope Patches

Patch files in this directory are applied to the vendored `vendor/AdvantageScope`
submodule before building AdvantageScope Lite.

- `001-lite-nt4-endpoint-injection.patch` adds embedded-mode NT4 endpoint
  injection. `/scope/?frcEndpoint=postMessage` waits for the parent page to
  send `frc-sim:set-nt4-endpoint`, acknowledges with
  `frc-sim:nt4-endpoint-ready`, and starts the live NT4 connection with the
  injected alive probe and WebSocket URL.
- `002-lite-log-url-injection.patch` adds embedded-mode log opening. The
  parent page can `postMessage` `{type: "frc-sim:open-log", url}` to fetch and
  open a log file by same-origin URL, instead of requiring the browser's local
  file picker (which can't see files inside a workspace container). Reuses the
  existing `open-files`/`historical-start` remote-log plumbing under a fixed
  sentinel path, and acknowledges with `frc-sim:log-ready` or
  `frc-sim:log-error`.

Run `bun run apply:ascope-patches` (or `bun scripts/apply-vendor-patches.ts
--tool=advantagescope` directly) to apply patches without rebuilding, or
`bun run build:ascope` to apply patches, rebuild the Lite bundle, and stage it
under `dist/advantagescope/`.
