# Decision 021: Testing suite implementation — deviations from TESTING-PLAN.md

**Date:** 2026-05-15
**Status:** Accepted; Docker-smoke scope superseded by decisions 022 and 038.
**Context:** `TESTING-PLAN.md` proposed a three-phase test suite (property + security unit tests, E2E mocked + frontend unit tests, Docker smoke + security browser tests). The plan was AI-drafted and reviewed; while implementing it, a handful of details warranted deviation. This log captures those decisions so future work doesn't reintroduce them by reading the plan and assuming it was followed verbatim.

## Summary

The suite was implemented end-to-end across all three phases, but with two deliberate departures from the plan (originally four; the other two were specific to Better Auth's testing surface, removed along with Better Auth itself by decision 046):

1. **Browser-heavy E2E specs that depend on missing `data-testid` attributes are marked `test.fixme(...)`** instead of being deleted or silently failing.
2. **Most regression coverage flows through the control plane's HTTP surface, not the React UI.** Spec mix is HTTP-driven where the regression is server-side, browser-driven only where the bug class needs a DOM.

## 1. Browser-heavy specs use `test.fixme`, not deletion

Many catalog entries (T9.x WS proxy, T12–T16 run lifecycle, T17–T19 driver-station UI, T20–T24 gamepad, T34 ASCope iframe) require `data-testid` attributes on components that don't exist yet (run button, run-status pill, DS enable/disable, keyboard tile, controller select, audit-log table). Two options:

- **Delete the specs** until the testids land.
- **Stub them with `test.fixme(true, "...")`**, including a one-line note saying what's needed.

We chose the second. `test.fixme` is *visible* in Playwright reports as an expected-not-implemented marker, so it doubles as a checklist for the next iteration. Deletion would have lost the catalog entirely. The HTTP-driven counterparts for each fixme (where one exists) are implemented and run today.

## 2. HTTP-driven specs preferred over DOM-driven specs where possible

The mocked tier specs lean heavily on Playwright's `request`-style usage by calling `app.fetch(new Request(...))` directly through the in-process `ControlApp` instance. The fixture exposes `app` precisely so specs can:

- inject session cookies without page navigation,
- inspect the response body/status directly,
- run in parallel without a real browser,
- avoid coupling to UI markup that changes shape.

Reserved for browser-driven specs: anything where the regression is in the React state machine, the iframe boundary, or browser-visible side effects (XSS rendering, cookie attributes seen by `document.cookie`, multi-tab sync via storage events). That mix produces a fast, mostly-server-side suite that catches the highest-value regressions (proxy hop-by-hop strip, default-deny gating, admin role enforcement, SSRF URL validation, CSRF cookie scoping).

## 3. Decisions on smaller details

- **`fast-check` for property tests.** Adopted as planned. Property tests live in `apps/control/src/__tests__/property/`, `apps/web/src/lib/*.property.test.ts`, and `packages/contracts/src/__tests__/property/`. Tunable run count via `FAST_CHECK_NUM_RUNS`.
- **Vitest for frontend unit tests, alongside Bun for the `keyboard-mapping.test.ts` file.** That one test was written before this work in `bun:test`-style and runs under `bun test`; the Vitest config excludes it to avoid double-runs. New frontend tests go in Vitest.
- **No tsconfig coverage of `e2e/`.** `scripts/typecheck.ts` enumerates tsconfig projects and `e2e/` is not one. Adding it would require a fourth tsconfig and is unnecessary for a test directory that Playwright transforms with its own pipeline. If a future tsconfig project is added for `e2e/`, the contracts/control-plane imports in fixtures will already resolve via the workspace's package layout.
- **The original Docker smoke scaffold skipped cleanly when `DOCKER_E2E` was
  unset.** Decision 022 removed that broad lane; decision 038 later added the
  narrower `e2e:workspace-java` command for real Java tooling acceptance.
- **Property-test count default = 200.** Plan suggested 100. 200 is still under a second per property; the cost is negligible, the bug-surfacing benefit is real. Override via `FAST_CHECK_NUM_RUNS` for CI-time tradeoffs.

## Files Touched

- `package.json` — new scripts: `test:web`, `e2e`, `e2e:ui`, `e2e:debug`, `e2e:docker`, `e2e:security`, `e2e:report`. Added `fast-check` and `@playwright/test` dev deps.
- `apps/web/package.json` — new scripts: `test`, `test:watch`, `test:coverage`. Added `vitest`, `@vitest/coverage-v8`, `jsdom`, `@testing-library/{react,jest-dom,user-event}`.
- `apps/web/vitest.config.ts`, `apps/web/src/test/setup.ts` — new Vitest configuration.
- `apps/control/src/__tests__/property/*.ts` — property tests for URL/branch/slug/contracts.
- `apps/control/src/__tests__/security/*.ts` — SSRF, path-traversal, command-injection, session/admin, hop-by-hop header tests.
- `apps/web/src/{lib,hooks,state}/**/*.test.{ts,tsx}` — frontend unit + hook tests.
- `packages/contracts/src/__tests__/property/schemas.property.test.ts` — JSON round-trip + bound enforcement.
- `playwright.config.ts`, `e2e/global-setup.ts` — Playwright configuration.
- `e2e/fixtures/{app,auth,runtime,fake-vscode,fake-halsim,types}.ts` — Playwright fixtures.
- `e2e/page-objects/*.po.ts` — Page-object skeletons.
- `e2e/specs/**/*.spec.ts` — Mocked, Docker, and security spec files.

## Future Work (Deferred)

- `data-testid` attributes on the components listed in the fixmed specs, plus filling in those specs.
- A second runtime provider mock helper for `simulateRuntimeFailure`, `injectGradleLockError`, etc. — the current `MockWorkspaceRuntimeProvider` covers basic state seeding but does not yet model crash transitions or per-call exec failures.
- Wire the suite into CI. The mocked tier is designed to drop into a GitHub Actions job with `bun + chromium`; the Docker tier requires a runner with the Docker socket. Out of scope for this pass.
