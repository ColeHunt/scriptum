# CodeRunner control plane
#
# Multi-stage build that produces a self-contained image: Bun runtime, control
# plane source, production node_modules, web shell dist, AdvantageScope Lite
# dist, Choreo web dist, bundled lesson catalog, migrations, and ops scripts.
# The emscripten (emsdk) toolchain needed to compile AdvantageScope's wasm
# lives only in a build stage — neither CI runners nor operators install it.
#
# Build context is the repo root (like containers/code/Dockerfile) and needs
# the vendor/AdvantageScope and vendor/Choreo submodules initialized:
#   bun run docker:build:control
#
# Choreo's frontend (served at /choreo/, talking to the choreo-server sidecar
# containers/code/Dockerfile bakes into the workspace image) is built from
# the pinned vendor/Choreo submodule, patched the same way AdvantageScope is
# - see docs/decisions/045-choreo-submodule-migration.md (which superseded
# 042's original clone-at-build-time approach).
#
# Elastic Dashboard (served at /elastic/) is Flutter-built OUTSIDE this image
# entirely - unlike AdvantageScope's emsdk stage below, no Flutter SDK enters
# this Dockerfile. dist/elastic/ is supplied as a prebuilt directory in the
# build context (fetched by `bun run fetch:dist`, or produced locally by
# `bun run build:elastic`, which needs Flutter installed on the host) or via
# `--build-context elastic-dist=<dir>` in CI - see the build-elastic job in
# .github/workflows/release.yml and docs/decisions/041-elastic-dashboard-integration.md.
#
# See docs/decisions/031-containerized-control-plane.md.

ARG BUN_VERSION=1.3.13

# ── Stage 1: web shell build ───────────────────────────────────────────
FROM oven/bun:${BUN_VERSION} AS web-build
WORKDIR /repo

# Workspace manifests first so the install layer caches across src changes.
COPY package.json bun.lock tsconfig.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/control/package.json apps/control/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN bun install --frozen-lockfile

COPY packages/ packages/
COPY apps/web/ apps/web/
RUN bun run build:web

# ── Stage 2: AdvantageScope Lite build (emsdk) ─────────────────────────
# emscripten/emsdk ships the pinned wasm toolchain with EMSDK/EM_CONFIG
# preset. AdvantageScope's compile tooling wants a modern Node, so install
# Node 24 (matching CI) ahead of emsdk's bundled runtime on PATH, plus a
# pinned Bun for the build scripts.
FROM emscripten/emsdk:4.0.12 AS ascope-build
ARG BUN_VERSION
RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends curl ca-certificates unzip \
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" \
    && ln -s /root/.bun/bin/bun /usr/local/bin/bun

WORKDIR /repo
# build-ascope-lite.ts resolves checked-in symlinks from git blobs and
# apply-ascope-patches.ts runs `git apply`, both via `git -C
# vendor/AdvantageScope`. The submodule worktree carries a gitfile pointing at
# .git/modules/vendor/AdvantageScope, so copy that gitdir alongside it (and
# only it — copying all of .git would bust this layer's cache on every
# commit).
COPY .git/modules/vendor/AdvantageScope/ .git/modules/vendor/AdvantageScope/
COPY vendor/ vendor/
COPY patches/ patches/
# Only the two scripts this stage runs — copying all of scripts/ would rerun
# the expensive wasm compile whenever any unrelated ops script changes.
COPY scripts/build-ascope-lite.ts scripts/apply-vendor-patches.ts scripts/
RUN git config --global --add safe.directory '*'
# /usr/bin first so the nodesource node/npm win over emsdk's bundled runtime;
# the wasm step re-prepends the emsdk paths itself (envWithEmsdk).
RUN PATH="/usr/bin:${PATH}" bun scripts/build-ascope-lite.ts

# ── Stage 3: ascope dist hand-off ──────────────────────────────────────
# Filesystem-only stage holding the built AdvantageScope Lite dist. Downstream
# stages copy from here instead of ascope-build so CI can substitute a prebuilt
# dist via a named build context (`--build-context ascope-dist=<dir>`), which
# skips the emsdk stage entirely. That's how the arm64 image build reuses the
# amd64 job's wasm output — emscripten/emsdk publishes no arm64 image, and the
# wasm/JS output is architecture-independent anyway.
FROM scratch AS ascope-dist
COPY --from=ascope-build /repo/dist/advantagescope /

# ── Stage 3b: Choreo web build ──────────────────────────────────────────
# Choreo's frontend (plain Vite/React/TS - this repo's own stack, unlike
# PathPlanner's Flutter, which had to stay out of the toolchain entirely -
# decision 039) is built from the pinned vendor/Choreo submodule, patched
# the same way AdvantageScope is (decision 045). Built from the same
# submodule/pin as containers/code/Dockerfile's choreo-builder stage, which
# builds the Rust sidecar that serves this frontend's API.
FROM oven/bun:${BUN_VERSION} AS choreo-web-build
# The base bun image doesn't ship git; apply-vendor-patches.ts needs it for
# `git apply`/`git -C`.
RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
# Same reasoning as ascope-build's gitdir copy above: the submodule worktree
# carries a gitfile pointing at .git/modules/vendor/Choreo, needed for
# apply-vendor-patches.ts's `git apply` calls.
COPY .git/modules/vendor/Choreo/ .git/modules/vendor/Choreo/
COPY vendor/ vendor/
COPY patches/ patches/
COPY scripts/build-choreo.ts scripts/apply-vendor-patches.ts scripts/vendor-manifest.ts scripts/
RUN git config --global --add safe.directory '*'
RUN bun scripts/build-choreo.ts

# ── Stage 3c: Choreo web dist hand-off ──────────────────────────────────
# Filesystem-only stage, same reasoning as ascope-dist above: lets CI
# harvest the dist via `--target dist-export` without loading the runtime
# image, and gives future multi-arch jobs a substitution point (the build
# above is architecture-independent, so there's never a reason to redo it
# per arch - but the pattern stays consistent with ascope-dist either way).
FROM scratch AS choreo-web-dist
COPY --from=choreo-web-build /repo/dist/choreo /

# ── Stage 3d: Elastic dist hand-off (no in-image Flutter build) ─────────
# Unlike ascope-dist/choreo-web-dist above, there is no Flutter build stage
# feeding this one - dist/elastic/ must already exist in the build context
# (see the file header comment) by the time this stage runs. CI always
# substitutes it via `--build-context elastic-dist=<dir>` (the build-elastic
# job's output), which skips evaluating this stage's COPY entirely; a local
# `docker build`/`docker:build:control` needs dist/elastic/ populated first
# via `bun run fetch:dist` or `bun run build:elastic`.
FROM scratch AS elastic-dist
COPY dist/elastic/ /

# ── Stage 4: dist export (CI only) ─────────────────────────────────────
# A filesystem-only stage holding just the built web shell + AdvantageScope
# Lite dists. CI builds this with `--target dist-export --output type=local`
# to harvest the release tarballs (web-dist/ascope-dist) straight from the
# build cache — no need to load the full runtime image into the daemon. It
# shares every upstream layer with the runtime stage, so with a warm cache it
# costs ~nothing. Not referenced by a plain `docker build` (runtime is the
# default last stage), so local builds are unaffected.
FROM scratch AS dist-export
COPY --from=web-build /repo/apps/web/dist /web-dist
COPY --from=ascope-dist / /ascope-dist
COPY --from=choreo-web-dist / /choreo-dist
COPY --from=elastic-dist / /elastic-dist

# ── Stage 5: runtime (default build target) ────────────────────────────
FROM oven/bun:${BUN_VERSION}

# Docker CLI only — the daemon is the host's, reached through the bind-mounted
# /var/run/docker.sock (docker-out-of-docker; workspace containers are
# siblings). curl serves the compose healthcheck.
COPY --from=docker:27.5.1-cli /usr/local/bin/docker /usr/local/bin/docker
RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Manifests before the install so the production node_modules layer caches
# across source changes. Every workspace's package.json must be present —
# bun's isolated linker creates the per-workspace node_modules (e.g.
# apps/control/node_modules) that the control plane resolves dependencies
# through. --production drops the dev toolchain.
COPY package.json bun.lock tsconfig.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/control/package.json apps/control/package.json
COPY packages/ packages/
RUN bun install --frozen-lockfile --production
COPY apps/control/ apps/control/
COPY scripts/ scripts/
COPY catalog/ catalog/
COPY --from=web-build /repo/apps/web/dist apps/web/dist
COPY --from=ascope-dist / dist/advantagescope
COPY --from=choreo-web-dist / dist/choreo
COPY --from=elastic-dist / dist/elastic

# License texts travel with the image, not just the repo: this image ships a
# patched AdvantageScope build, and BSD-3-Clause requires the notice to
# accompany the binary distribution. Last of the COPY layers so editing the
# notices doesn't invalidate the install or dist layers above.
COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/fabrica/

# /data is the bind-mounted host data directory (SQLite DB + per-student
# projects). The ops scripts' relative "data" fallbacks rely on these being
# set, so keep them even though compose usually repeats them.
ENV FRC_DATA_DIR=/data \
    FRC_DB_PATH=/data/app.db \
    NODE_ENV=production

EXPOSE 4000

# `fabrica` is a dispatching CLI (containers/control/entrypoint.sh) so ops
# commands read as `fabrica <subcommand>` instead of exposing the script
# paths. With CMD=["serve"] the default `docker compose up` migrates then
# execs the server as PID 1, so it receives docker stop's SIGTERM directly;
# `docker compose run --rm control <subcommand>` (allowlist, backup, restore,
# ...) reuses the same entrypoint, and `docker compose exec control fabrica
# <subcommand>` reaches it directly on PATH since `exec` bypasses ENTRYPOINT.
COPY containers/control/entrypoint.sh /usr/local/bin/fabrica
RUN chmod +x /usr/local/bin/fabrica

# Non-root by default; compose overrides the uid:gid to the data-dir owner.
# HOME must be writable by whatever uid runs us (bun runtime cache, etc.), so
# use a world-writable dir rather than the base image's /root. No chown of /app
# is needed — the earlier COPY/install layers are world-readable (umask 0022).
# USER bun (uid 1000) matches the base image's stock user and the typical
# single-host dev user; compose overrides it per deployment.
RUN install -d -m 0777 /home/app
ENV HOME=/home/app
USER bun

ENTRYPOINT ["fabrica"]
CMD ["serve"]
