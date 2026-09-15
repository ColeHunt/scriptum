---
sidebar_position: 6
title: Troubleshooting
---

# Troubleshooting

## Container won't start

**Symptom.** A student's workspace shows "starting" indefinitely, or the
container status is "error". The admin panel shows no running container for
that workspace.

**Cause.** Docker is not running, or the workspace image is missing.

**Fix.**

```bash
# Confirm Docker is running
docker info

# Check whether the workspace image exists
docker images | grep coderunner-workspace

# If missing, pull both images (control + workspace)
docker compose pull

# From-source host checkout: pull or build the workspace image directly
bun run docker:pull:workspace    # or docker:build:workspace to build locally
```

In **port mode** (the host dev loop, or a `docker compose` deployment with
`FRC_CONTAINER_NETWORK` explicitly unset), check for port conflicts: if all
ports in `SIM_PORT_RANGE` or `VSCODE_PORT_RANGE` are in use, container startup
fails. Verify the ranges are not overlapping with other services on the host.
Defaults are `25810–25899` (sim NT4) and `33000–33099` (codium-server).
This does not apply to **network mode** — the default for `docker compose`
deployments — where workspace containers publish no host ports at all; see
[decision 031](https://github.com/mathewdunne/CodeRunner/blob/main/docs/decisions/031-containerized-control-plane.md).

After the image is present and Docker is healthy, the student's container will
start on their next workspace open.

---

## Control plane can't reach the Docker socket (permission denied)

**Symptom.** The `control` container crash-loops. The logs show
`permission denied` while connecting to `/var/run/docker.sock`, and no workspace
containers ever start.

**Cause.** The control container runs as a non-root user and needs the group
that owns the socket added as a supplementary group to reach it.
`FABRICA_DOCKER_GID` does not match that group. This is a Linux and WSL2
problem: the `0` default matches Docker Desktop's root-owned socket on macOS and
native Windows, but Linux and WSL2 own the socket by their `docker` group
instead — including under Docker Desktop's WSL2 integration.

**Fix.** Look up the host's real `docker` group gid and set it in `.env`:

```bash
stat -c '%g' /var/run/docker.sock     # e.g. 999
```

```bash
# in .env
FABRICA_DOCKER_GID=999
```

Then recreate the container to pick up the corrected `group_add`:

```bash
docker compose up -d control
```

---

## Control plane can't write /data (SQLITE_READONLY / read-only data dir)

**Symptom.** The `control` container fails at startup (or on the first write)
with `SQLITE_READONLY: attempt to write a readonly database`, or logs an error
about being unable to write under `/data`.

**Cause.** The bind-mounted `./data` (or files inside it) is not owned by the
`FABRICA_UID:FABRICA_GID` the control container runs as. This is typically
leftover `root:root` files from a pre-non-root deployment that ran the control
plane as root, or a `./data` that Docker recreated root-owned after the
directory was deleted.

**Fix.** Confirm the ownership matches the configured uid:gid (default
`1000:1000`), then reclaim it on the host:

```bash
ls -ln data                           # check the owner uid/gid
stat -c '%g' /var/run/docker.sock     # (for the docker gid, if also affected)

# Reclaim the data dir for the control container's uid:gid (adjust to yours)
sudo chown -R 1000:1000 data
```

Then restart the control plane (`docker compose up -d control`). Never delete
the `./data` directory itself — Docker would recreate it root-owned and this
failure would return.

---

## Build times out

**Symptom.** A run shows "failed" after approximately 90 seconds with no
obvious error. The problem typically occurs on the student's first build of a
new project.

**Cause.** The Gradle build exceeded `RUN_BUILD_TIMEOUT_MS` (default: 90000 ms,
i.e. 90 seconds). Cold-cache first builds can legitimately take 2–3 minutes on
slower hosts.

**Fix.** Increase the timeout in your `.env`:

```bash
RUN_BUILD_TIMEOUT_MS=180000
```

Restart the control plane for the change to take effect. Subsequent builds are
much faster because Gradle's incremental cache (in `data/users/*/home/`) is
warm.

---

## Sim doesn't start after a successful build

**Symptom.** The build succeeds (the console shows Gradle output), but the run
stays in "building" for 30 seconds and then fails.

**Cause.** The WPILib simulator process did not report readiness within
`SIM_STARTUP_TIMEOUT_MS` (default: 30000 ms).

**Fix.** Increase the startup timeout:

```bash
SIM_STARTUP_TIMEOUT_MS=60000
```

If this happens consistently for one student, check the container logs:

```bash
docker logs coderunner-workspace-<hex> --tail 100
```

(The container name is `coderunner-workspace-` followed by the workspace id's
hex suffix, with the `ws_` prefix dropped.)

Look for the simulator failing to bind its HALSim port. If `HALSIM_PORT_RANGE`
ports are exhausted, restart the control plane or stop idle containers to free
leases. This only applies in port mode — network-mode deployments don't lease
host ports for workspace containers, so exhaustion here means
`MAX_ACTIVE_CONTAINERS` instead (see below).

---

## Choreo or Elastic Dashboard does not load

**Choreo shows a 503 with "Choreo is not running" or "Choreo upstream did not
become ready."** The `choreo-server` sidecar inside that student's workspace
container either isn't running yet or didn't answer `/healthz` within 30
seconds of the control plane probing it. Restarting the workspace container
(**Admin → Workspaces → Restart Code**) is usually enough; if it recurs for
every student, check that the workspace image actually has `choreo-server`
built in (`bun run docker:build:workspace`, or pull the published image).

**Elastic Dashboard shows a 503: "Elastic Dashboard has not been built yet."**
Its web dist is missing. In a source checkout, run `bun run build:elastic`
(needs a local Flutter SDK) or `bun run fetch:dist` (downloads a prebuilt
`elastic-dist.tar.gz` if one exists for that release, and just warns if it
doesn't — Elastic is optional, unlike AdvantageScope/Choreo). For a Compose
deployment, this means the image it pulled or built doesn't include Elastic;
rebuild with `dist/elastic` populated first, or pull a release image built
with the `build-elastic` CI job.

**An edit made in VSCodium does not appear in Choreo.** Reload the page.
External file changes are not synchronized into an open Choreo session — it
only re-reads the project on load.

---

## Legion sign-in fails

**Symptom.** Students land back on `/login` after clicking "Sign in via
Legion", or the browser never picks up a session after completing Legion's
own sign-in flow.

**Cause: `SSO_SECRET` mismatch.** CodeRunner's `SSO_SECRET` must be the exact
same value as Legion's own `SSO_SECRET` — if they differ, CodeRunner silently
rejects every `mw_sso` cookie as invalid (logged at `trace` level, not visible
by default). Compare both `.env` files directly.

**Cause: cookie domain mismatch.** CodeRunner and Legion must share a parent
domain (Legion's own `SSO_COOKIE_DOMAIN`) for the browser to send the
`mw_sso` cookie to both. Two hosts with no common parent domain can never
share the cookie, even with identical secrets. See
[Legion Setup](../deploying/legion-setup.md).

**Cause: `SSO_SESSION_TTL` mismatch.** If CodeRunner's `SSO_SESSION_TTL`
differs from Legion's own, a session that's still valid by one app's clock
can be rejected by the other's. Keep them identical.

**Cause: Legion itself is unreachable.** `LEGION_BASE_URL` must be the
externally reachable base URL of your Legion instance — check it resolves
and is not blocked by a firewall between the student's browser and Legion.

There is no local allowlist to check — if a student can sign in through
Legion at all, CodeRunner lets them in. If they can't reach CodeRunner's
`/admin`, that's a Legion `coderunner-admin` group membership question, not
a CodeRunner-side setting.

---

## Port range exhausted

This applies to **port mode** only (the host dev loop, or a `docker compose`
deployment with `FRC_CONTAINER_NETWORK` explicitly unset). Network mode — the
default for `docker compose` deployments — never leases host ports for
workspace containers, so it can't hit this failure; its concurrency limit is
`MAX_ACTIVE_CONTAINERS` alone (see [Capacity](./capacity.md)).

**Symptom.** Container startup fails with a log message about no free ports, or
many students get "server at capacity" even when the concurrency cap has not
been reached.

**Cause.** All ports in `SIM_PORT_RANGE`, `VSCODE_PORT_RANGE`, or
`HALSIM_PORT_RANGE` are leased (or stale leases were not cleaned up).

**Fix.** Each range supports 90 concurrent leases by default (e.g.
`25810–25899`). If you have more than 90 simultaneous students, expand the
ranges:

```bash
SIM_PORT_RANGE=25810-25999
VSCODE_PORT_RANGE=33000-33199
HALSIM_PORT_RANGE=34000-34199
```

Stale leases can accumulate if containers were stopped without the control
plane running. Restart the control plane; startup reconciles Docker container
state against the database and releases stale leases.

---

## Disk full

**Symptom.** File saves fail, builds fail with I/O errors, or container startup
fails. `df -h /` shows the data partition at or near 100%.

**Cause.** Gradle caches, run logs, and Docker image layers have grown to fill
the disk.

**Fix.** Free space in order of safety:

```bash
# 1. Prune run logs (safest, often largest single contributor)
find data/users/*/logs/runs -name "*.log" -delete

# 2. Prune stopped managed containers and their layers
bun run docker:cleanup
docker system prune -f
docker builder prune -f

# 3. Prune Gradle caches for all workspaces (stop containers first)
for dir in data/users/*/; do
  rm -rf "$dir/home"
  mkdir -p "$dir/home"
done
```

Never delete `data/users/*/project/`; that is student source code. If space
is critically low, back up project files first:

```bash
bun run backup
```

---

## Control plane crashes or becomes unresponsive

**Symptom.** The browser shows disconnected. `docker compose ps` shows the
`control` container unhealthy or restarting, or its logs show a fatal error.

**Cause.** An unhandled exception, OOM on the host, or a corrupt database.

**Fix.** Restart the control plane and check its logs (prefix with
`cd /opt/coderunner && sudo` on the VM):

```bash
docker compose restart control
docker compose logs --tail 100 control
```

On startup the control plane reconnects to existing containers via Docker
labels, reconciles container state with the database, and resumes the idle
sweep. Student files and running containers are preserved across restarts.

---

## Student workspace is at capacity (503)

**Symptom.** A student sees a "Server at capacity" toast when
opening their workspace. Other students with running containers are unaffected.

**Cause.** The active container count has reached `MAX_ACTIVE_CONTAINERS`.

**Fix.** Check the admin panel or the admin API for current vs. maximum
container count. If idle containers have not yet been stopped, wait for the
idle sweep (or reduce `IDLE_STOP_MINUTES`). If the load is legitimate and the
host has headroom, raise the cap at runtime without restarting:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  -X POST -H "Content-Type: application/json" \
  -d '{"value": 15}' \
  http://localhost:4000/admin/config/max-active-containers
```

Verify host memory and CPU before raising the cap further; see
[Capacity](./capacity.md) for sizing guidance.
