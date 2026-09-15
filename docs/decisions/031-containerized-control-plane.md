# 031 — Containerized Control Plane

## Status

Accepted.

## Context

The control plane historically ran as a **bare-metal Bun process** on the GCE
VM, supervised by systemd. Two recurring pains motivated this change:

1. **The deploy was convoluted.** A release SSHed into the VM and ran
   `git fetch`/`git checkout`, `bun install`, downloaded two prebuilt dist
   tarballs from the GitHub release, `docker pull`ed the workspace image, then
   `systemctl restart`ed the unit. Five moving parts, none of them "pull the
   new image."
2. **AdvantageScope Lite needs emsdk to build.** AS Lite compiles a wasm
   bundle, so anyone building from source needs the emscripten SDK 4.0.12 and
   the `vendor/AdvantageScope` submodule. To spare operators and demo users
   that, the project shipped prebuilt `web-dist`/`ascope-dist` tarballs on each
   release and a `setup:demo`/`fetch-dist.ts` path to download them — extra
   surface to maintain.

Containerizing the control plane collapses the deploy to "pull the newest
image" and moves the emsdk build inside `docker build`, so neither CI runners
nor operators ever install it. The development loop (`bun run dev:control` +
`bun run dev:web` on the host) is unchanged.

## Decision

### One image, built once

`containers/control/Dockerfile` is a multi-stage build (context = repo root):

- **web-build** (`oven/bun`) — `bun run build:web`.
- **ascope-build** (`emscripten/emsdk:4.0.12`, which carries node/npm/git and a
  preset `EMSDK`) — installs a pinned Bun and runs `scripts/build-ascope-lite.ts`,
  including the wasm compile. This stage needs git metadata for the
  AdvantageScope submodule, because the build resolves checked-in symlinks from
  git blobs (`git -C vendor/AdvantageScope ls-files`/`cat-file`) and applies
  patches with `git apply`. The submodule worktree's `.git` is a gitfile
  pointing at `.git/modules/vendor/AdvantageScope`, so the build copies **only
  that gitdir** (`COPY .git/modules/vendor/AdvantageScope/`), not the whole
  `.git`, to keep the layer cache stable across commits.
- **runtime** (`oven/bun`) — copies the workspace source, runs
  `bun install --frozen-lockfile --production`, then layers in the web/ascope
  dists, bundled `catalog/`, migrations, and `scripts/`. The Docker CLI is
  copied from `docker:27.5.1-cli`; the daemon is the host's, reached over the
  bind-mounted socket. Entrypoint is migrate-then-serve.

The CI publish job (`.github/workflows/deploy.yml`) builds and pushes
`ghcr.io/<owner>/coderunner-control` alongside the workspace image (distinct GHA
cache scopes), and **extracts the release tarballs from the built control image**
(`docker create` + `docker cp` of `/app/apps/web/dist` and
`/app/dist/advantagescope`). The tarballs survive for the `deploy-cloudflare`
job and for `scripts/fetch-dist.ts`, but they are a by-product of the single
image build — the runner no longer installs emsdk.

> **Why install in the runtime stage, with full source present, not a
> manifests-only deps stage.** This repo uses Bun's *isolated* linker:
> dependencies live in `node_modules/.bun/` and resolve through per-workspace
> `apps/control/node_modules/` symlinks. A manifests-only install populates the
> store but never creates those workspace links, so the runtime cannot resolve
> `@logtape`/`prom-client`. Installing with the workspace source
> in place is what creates the links. (Discovered the hard way — the first build
> booted to `Cannot find module '@logtape/logtape'`.)

### Networking: a shared Docker network, not host ports

The control plane manages per-student workspace containers through the Docker
CLI. On the host it published each container's ports on `127.0.0.1` and proxied
to `localhost:<port>`. That doesn't work cleanly from inside a container, so a
**dual-mode runtime provider** was added (`apps/control/src/containers/`):

- **Port mode** (default; `FRC_CONTAINER_NETWORK` unset) — unchanged. Used by
  the host dev loop.
- **Network mode** (`FRC_CONTAINER_NETWORK=<name>`) — workspace containers join
  a shared user-defined bridge network and publish **no** host ports; the
  control plane proxies to `<container-name>:3000/5810/3300` (the fixed internal
  ports) via Docker's embedded DNS. Port leases are stored NULL (no schema
  change — the `container_leases` unique indexes are already partial on
  non-NULL). Adoption requires the container to be attached to the network and
  to publish no ports, so a leftover from the other mode is recreated rather
  than adopted (self-healing cutover). Inside a container `FRC_CONTAINER_NETWORK`
  is normally derived automatically rather than set — see **Self-inspection**
  below.

Upstream URLs are built in one place (`converters.ts:upstreamEndpoints`, also
used by `app/websocket.ts`), branching on the mode.

### Bind-mount path translation

The control plane writes to `/data` (the host data dir bind-mounted into the
container), but `docker run --mount src=` is resolved by the daemon against the
**host** filesystem. `FRC_HOST_DATA_DIR` gives the host-side path, and
`containers/paths.ts:toHostPath` rewrites mount sources (a no-op when unset).
Persisted `workspaces.project_path` rows are re-rooted under the current
`dataDir` at startup (`storage.ts`), which also self-heals restored backups and
host↔container moves. Inside a container `FRC_HOST_DATA_DIR` is normally
derived automatically rather than set — see **Self-inspection** below.

### Self-inspection: zero-config containerized mode

`FRC_HOST_DATA_DIR`, `FRC_CONTAINER_NETWORK`, and `FRC_CONTAINER_USER` were
originally required env plumbing that `docker-compose.yml` supplied
(`CODERUNNER_WORKSPACE_UID`/`GID` for the user, `${PWD}/data` interpolated into
both the bind-mount source and `FRC_HOST_DATA_DIR`). All three are things the
control plane can determine about itself, because it already has the host
Docker socket bind-mounted. `apps/control/src/containers/self-inspect.ts`
`docker inspect`s its own container (`docker inspect $(hostname)` — compose's
default hostname is the container ID) and derives:

- **hostDataDir** — the `Source` of the `Mounts[]` entry whose `Destination`
  matches the resolved data dir (`/data` in the image). This is *more* correct
  than a hand-supplied path on Docker Desktop/WSL2, since inspect reports the
  daemon-side path directly rather than whatever path is visible inside a
  WSL2/dev-container shell.
- **containerNetwork** — the single non-default (`bridge`/`host`/`none`) key
  under `NetworkSettings.Networks`. Zero or more than one user-defined network
  is a hard error naming `FRC_CONTAINER_NETWORK`.
- **containerUser** — `uid:gid` from `stat()`ing the data dir. A `0:0` stat
  (root-owned) is deliberately **not** derived — see the root-guard
  interaction in Consequences.

**Env always wins; inspection only fills gaps.** Each field is resolved
independently: an explicit `FRC_HOST_DATA_DIR` / `FRC_CONTAINER_NETWORK` /
`FRC_CONTAINER_USER` (or `FRC_UID`+`FRC_GID`) is used as-is and that field is
never inspected. `main.ts` reads the env value for each field first, calls
`selfInspect()` with those as input, and passes its output (env-or-derived) as
the `ControlAppOptions` given to `loadControlConfig`. This ordering matters:
`loadControlConfig` resolves `input.X ?? Bun.env.X`, so passing a derived value
straight through as `Bun.env` would look like it, but passing it as `input`
*before* checking `Bun.env` would let a derived value silently outrank an
explicit env override — the merge has to happen in `main.ts`, ahead of config,
not inside `loadControlConfig` itself.

**Activation is `/.dockerenv`-gated, and there is no fallback to port mode.**
On the host (`/.dockerenv` absent — the dev loop) `selfInspect` returns
immediately having made zero Docker calls, so `bun run dev:control` stays
byte-identical to before this branch: port mode, no new log lines. Inside a
container, every failure to derive a still-needed field (inspect fails, no
matching mount, zero or multiple user-defined networks) is a hard startup
error naming the env var that fixes it — silently falling back to port mode
would boot a deployment that publishes host loopback ports the containerized
control plane can't reach.

The startup config log (`main.ts`) tags each of the three values with
`(auto-detected)` when it came from inspection, so `docker compose logs
control` shows at a glance whether a setting was derived or came from an
explicit override.

### docker compose is the run surface

- `docker-compose.yml` — base stack: the control service (socket + `/data`
  mounts, the `coderunner` network with an explicit name so it matches
  `docker run --network`, loopback `:4000`) plus a pull-only
  `workspace-template` stub so `docker compose pull` fetches both images. The `environment:` block
  is down to `CODE_IMAGE` and a `CODERUNNER_DEMO_MODE` passthrough — the
  `FRC_HOST_DATA_DIR`/`FRC_CONTAINER_NETWORK`/`FRC_CONTAINER_USER` plumbing is
  gone now that self-inspection derives it (see above). The volume mount is
  `${CODERUNNER_HOST_DATA_DIR:-./data}:/data`; compose resolves `./` against
  the project directory, so the old `${CODERUNNER_HOST_DATA_DIR:-${PWD}/data}`
  double-interpolation is gone too.
- `docker-compose.prod.yml` — adds **Caddy** (TLS, `reverse_proxy control:4000`)
  and **Grafana Alloy** as containers. Alloy scrapes `control:4000/metrics`,
  reads host metrics through bind-mounted `/proc`/`/sys`/`/`, and ships the
  control plane's stdout logs via the Docker API (`discovery.docker` +
  `loki.source.docker`) — replacing the old journald pipeline. The control
  plane still logs NDJSON, so the `level`/`category` label extraction is
  unchanged.
- Demo mode is a plain env-var passthrough, not an override file:
  `docker-compose.yml` passes `CODERUNNER_DEMO_MODE: ${CODERUNNER_DEMO_MODE:-}`
  into the control service, so `CODERUNNER_DEMO_MODE=1 docker compose up` (or a
  `.env` entry) flips it with no extra `-f`. This needed a bug fix first:
  `parseBoolean` (`config.ts`) treated `""` as truthy — only `0`/`false`/`no`/
  `off` were in the falsy list — and `${VAR:-}` renders as an empty string
  (not "absent") when the variable is unset, so every deployment without the
  var set would have silently booted into demo mode. Fixed by normalizing and
  returning `fallback` for the empty string before the falsy-list check.
  `docker-compose.demo.yml` is deleted.

On the VM, `/opt/coderunner/.env` sets
`COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml` so a plain
`docker compose up -d` runs the prod stack. cloud-init now installs only Docker
+ the compose plugin, fetches the compose files, and renders `.env` (preserving
`CODERUNNER_TAG` across reboots) plus the Alloy config. The bare-metal
bun/systemd/host-Caddy/host-Alloy path is gone.

### `coderunner` — a dispatching CLI, not raw scripts

Ops commands used to read `docker compose exec control bun scripts/<name>.ts`,
exposing script filenames as the operator-facing interface.
`containers/control/entrypoint.sh` is now installed at
`/usr/local/bin/coderunner` and set as the image `ENTRYPOINT` (`CMD ["serve"]`),
dispatching by subcommand to the same underlying scripts (which are still
baked into the image and inherit `FRC_DATA_DIR=/data`): `serve` (default;
migrate then exec the server, unchanged PID-1/SIGTERM semantics), `backup`,
`restore` (takes a backup directory **inside** `/data`), `users`,
`audit-prune`, `rebuild-workspaces`, `cleanup`, `migrate`, `help`, and a
passthrough for anything else (e.g. `coderunner bash` for a shell).

Two invocation styles both work from this one script, for different reasons:

- `docker compose run --rm control <subcommand>` — `run` replaces `CMD`, so
  the entrypoint dispatches; the one-off container still shares the socket and
  `/data` mounts from the service definition. This is the form to use while
  the control plane itself is stopped (e.g. `restore`).
- `docker compose exec control coderunner <subcommand>` — `exec` bypasses the
  image `ENTRYPOINT` entirely and runs a command inside the *already-running*
  container, so this form only works because `coderunner` is also installed
  as a normal executable on `PATH` — not because it's the entrypoint.

The `bun run <name>` aliases in `package.json` remain the equivalent for a
from-source host checkout.

## Consequences

- **Deploy is "pull and up."** `docker compose pull && docker compose up -d`,
  then recycle student containers with `coderunner rebuild-workspaces`. No
  checkout, no bun install, no tarball juggling. Reaching the admin panel is
  entirely a Legion-side step (grant the `coderunner-admin` group) rather
  than anything done here.
- **The compose file's `environment:` block is down to `CODE_IMAGE` and the
  demo passthrough.** The workspace network name, host data path, and
  workspace uid:gid are derived at container startup instead of hand-wired;
  the matching `FRC_*` env vars are now overrides for setups self-inspection
  can't resolve (multiple user-defined networks, an unusual bind-mount
  layout), not required configuration. `CODERUNNER_WORKSPACE_UID`/`GID` no
  longer exist anywhere — the workspace user comes from `stat()`ing `/data`.
- **No emsdk anywhere but the build stage.** `fetch-dist.ts`/`setup:demo`
  remain for emsdk-free host development, fed by tarballs extracted from the
  image.
- **The control container runs as a non-root uid:gid (the data-dir owner) and
  mounts the Docker socket.** See the [non-root addendum](#addendum--non-root-control-container)
  below for the mechanics. The socket is still the only writable host mount
  besides `/data`, so a control-plane RCE remains a serious escape surface —
  running non-root narrows the blast radius but does not eliminate it (the same
  trust level as the prior bare-metal setup, where the `coderunner` host user
  was in the `docker` group). The **workspace** user is still derived
  independently by `stat()`ing the data dir, and **network mode still refuses
  to start without a resolvable non-root workspace user** — either an explicit
  `FRC_CONTAINER_USER` or a non-root `stat()` of the data dir — so workspace
  containers (and the student files they create on the host) can't be
  root-owned. That guard is now defense-in-depth rather than the reason the
  control process itself isn't root. This is also why `data/.gitkeep` is tracked
  (`.gitignore` keeps `data/*` ignored but excepts `data/.gitkeep`): if Docker
  created a missing `./data` on first `up` it would be root-owned, which both
  trips the workspace-user guard and leaves the now-non-root control process
  unable to write it — a tracked placeholder means a fresh `git clone` already
  owns `./data` as the cloning user, so the common path never hits either
  failure.
- **First cutover on the live VM** must recreate the existing port-mode
  containers (they fail network-mode adoption and are recreated lazily;
  `rebuild-workspaces` does it eagerly). The Alloy log pipeline changes from
  journald to the Docker API — verify logs still flow after cutover (metrics
  failing is obvious; logs silently stopping is not).
- **WSL2 / Docker Desktop:** self-inspection derives `hostDataDir` from
  `docker inspect`'s own report of the bind-mount source, which is more
  reliable than a hand-supplied `FRC_HOST_DATA_DIR` in these environments (the
  daemon's view of host paths doesn't always match what a WSL2 shell sees).
  `FRC_HOST_DATA_DIR` remains available as an override when inspection can't
  resolve it. The dev loop is untouched.

## Addendum — non-root control container

The control container originally ran as **root** (the image had no `USER`
directive). Every file it wrote to the bind-mounted `./data` (`app.db`,
`users/…`) landed `root:root` on the host, so dropping into
the host dev loop (`bun run dev:control`, uid 1000) hit `SQLITE_READONLY` on the
first write to `app.db` — and, per the consequence above, a control-plane RCE
was container-escape-trivial.

The image now defaults to **`USER bun`** (uid 1000, the base image's stock user)
with a world-writable `HOME=/home/app` so any override uid can write its runtime
cache. `docker-compose.yml` overrides the identity per deployment:

```yaml
user: "${CODERUNNER_UID:-1000}:${CODERUNNER_GID:-1000}"
group_add:
  - "${CODERUNNER_DOCKER_GID:-1001}"
```

`CODERUNNER_UID`/`GID` are the owner of the data dir (so `./data` stays
host-owned across the container↔host handoff), and `CODERUNNER_DOCKER_GID` is
the host `docker` group gid — added as a supplementary group so the non-root
process can still reach the bind-mounted socket (the docker CLI is how the
control plane drives the daemon). The numeric gid works even without a matching
named group inside the container, and the same `user:`/`group_add:` pair applies
to `docker compose run --rm control <subcommand>`, so the ops CLI runs non-root
too. These vars are distinct from the `FRC_*` vars that govern the workspace
siblings. On the VM, `render-env.sh` (fresh boot) and the cutover runbook emit
all three from the `APP_USER` that already owns the data disk, so no host is
hardcoded to uid 1000.

The `stat()`-based **workspace**-user derivation and the network-mode root-guard
are unchanged — they guard the derived workspace user, independent of the
control process's own uid, and now stand as defense-in-depth. See
[security model → control plane container privileges](../about/security-model.md#control-plane-container-privileges).
