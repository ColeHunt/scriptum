# 034 — Demo mode portability on Docker Desktop

Status: **Accepted (implementation)** — 2026-08-13

Extends the demo-mode Docker/filesystem setup covered by
[`033-workspace-disk-read-limit.md`](./033-workspace-disk-read-limit.md).

## Context

Testing the out-of-the-box experience on native Windows surfaced two problems
that only appear off Linux, both traced to Docker Desktop's WSL2 backend.

**The control plane could not start at all.** It runs non-root and reaches the
Docker socket through the supplementary group in `CODERUNNER_DOCKER_GID`, whose
default assumes a Linux host with a `docker` group. Inside Docker Desktop's VM
the socket is `root:root`, so the default never matched and every start died in
`selfInspect` — with a message naming three `FRC_*` variables, none of which can
fix a permission problem.

**First boot took minutes.** Bind mounts of Windows paths are served over 9p
across the VM boundary, where cost is per filesystem operation rather than per
byte. Measured on the affected machine: streaming bandwidth was tolerable, but
each additional file cost roughly 20 ms, making the same payload split across
~2k files about 14× slower than on a VM-local volume, and metadata-only work
(`chown -R`) far worse. The workspace image seeds several thousand files of
Gradle cache and extensions into `/config` on first run and re-chowns that tree
on every start, so the editor readiness probe timed out repeatedly and the UI
showed an indefinite spinner.

## Decision

1. **`group_add` is a single entry, `${CODERUNNER_DOCKER_GID:-0}`.** The socket's
   owner differs by platform — root inside Docker Desktop's VM, the `docker`
   group on a Linux host running Docker Engine natively — but on any given host
   exactly one of those applies, so listing both would only ever add a group that
   is inert by construction. Defaulting the one entry to `0` makes Docker Desktop
   zero-config, which is where the problem was.

   Linux hosts must now always set the variable. In practice most already had to:
   the previous `1001` default did not match stock Debian/Ubuntu (`999`/`998`),
   and `deploy/cloud-init/user-data.yaml` has always written the real gid into
   prod's `.env` at boot. The failure is self-describing — `selfInspect` names
   `CODERUNNER_DOCKER_GID` and prints the `stat` command (see the last
   consequence below).

   This also keeps gid 0 off production. An audit of the control image found it
   uniquely grants access to exactly three files — `dpkg/lock`,
   `dpkg/lock-frontend`, `apt/archives/lock` — and nothing group-writable, and
   the process already holds the root-equivalent Docker socket by design, so
   granting it was never a real risk; but a Linux deployment that sets its own
   gid now simply never receives it. Supplementary groups do not affect the
   ownership of files a process creates (that follows the primary gid), so
   `./data` stays host-owned either way, which is the entire purpose of the
   non-root design in [031](./031-containerized-control-plane.md).

   Considered and rejected: a `docker-compose.demo.yml` overlay, which would
   have reversed 031's "demo mode is an env passthrough, not an override file"
   and cost every doc an extra `-f` flag. `CODERUNNER_DEMO_MODE=1 docker compose
   up` is unchanged. Also rejected: listing both gids, whether hard-coded or as a
   second variable. `group_add` is `uniqueItems`, so any arrangement that can
   produce a duplicate turns `CODERUNNER_DOCKER_GID=0` into a compose *schema*
   failure that does not name the variable — and the older troubleshooting docs
   had actively told Docker Desktop users to set exactly that.

2. **`/config` is a named volume in demo mode**, a host bind mount otherwise.
   Everything under it is regenerable (Gradle caches, extensions, editor state,
   and — per 010 — the sim project cache, so build output too), and `backup.ts`
   already excludes it. A volume lives on the VM's own filesystem, so demo
   performance stops depending on the host OS. Real deployments keep the bind
   mount, which lands the caches on `CODERUNNER_HOST_DATA_DIR` (often a
   dedicated disk) and keeps them visible to the operator.

   `project/` stays a bind mount in both modes: it is the student's actual code
   and backups read it from the host. Volume deletion is wired to workspace
   deletion only — container recycling must keep the volume, or every restart
   re-seeds.

   A mount is fixed at container create, so adoption compares the existing
   `/config` mount's type against the current mode and recreates on a mismatch.
   Without that, a workspace created before this change — i.e. exactly the
   population that hit the bug — would keep its bind mount forever, and one
   created in demo mode and later run without it would keep a volume the operator
   cannot see. The orphaned volume is left in place on a volume→bind switch;
   workspace deletion still reaps it.

3. **The disk read cap is skipped in demo mode.** Per 033 it exists to stop one
   thrashing container from saturating a shared VM's provisioned throughput. A
   single-workspace demo on someone's own machine has no such tenant, and the
   cap only throttles seeding and Gradle reads.

4. **Editor 503s distinguish "starting" from "failed"** via a response header,
   so the shell can say so instead of showing a spinner that reads as hung.

## What was deliberately not done

The per-start `lsiown -R` over `/config` is real waste — measured at ~47 s on the
affected machine, versus a fraction of a second on Linux ext4 — and the obvious
fixes were rejected:

- **Chowning at build time does not work.** `abc`'s uid is assigned at runtime
  from `PUID`/`PGID`, which the control plane derives per deployment from the
  data dir's owner. The image already chowns the Gradle cache at build time and
  it still needs the runtime pass.
- **Guarding the chown on a uid marker is not safe today.** `docker exec` runs
  as root and `start-sim.sh` does not drop privileges, so builds write
  root-owned files into the Gradle home the editor uses as `abc`. The
  unconditional chown is the repair pass that launders them on the next start;
  frequent idle-stop restarts are why this has never surfaced. Guarding it would
  convert a masked problem into a live one.

Both would be unblocked by making the exec path run as `abc`. Until then the
chown stays, and the demo-mode volume makes it cheap enough not to matter. Note
the hidden coupling: raising `IDLE_STOP_MINUTES` substantially, or making that
chown conditional, would expose the root-owned-cache problem with no obvious
connection to the change.

## Consequences

- The demo needs no configuration on Docker Desktop for macOS and native
  Windows. Linux and WSL2 set `CODERUNNER_DOCKER_GID`, as Linux generally had to
  before. Native Windows remains unsuitable for real deployments, where the
  caches sit on a host bind mount.
  *(Corrected 2026-08-17: this originally listed WSL2 integration as zero-config
  too. It is not — a WSL2 shell sees a `docker`-group-owned socket and behaves
  like a native Linux host.)*
- Resetting a demo now means clearing the volume as well as `./data`, and that
  needs `docker compose down --remove-orphans` first: workspace containers are
  labelled into the compose project but are not services, and `volume prune`
  skips a volume still attached to a stopped container.
- Demo mode no longer exercises the same storage path as production. This is a
  deliberate fidelity trade, and an argument for keeping demo's divergence to
  these settings rather than letting it grow.
- Startup socket failures now surface docker's own stderr, and a denied socket
  names `CODERUNNER_DOCKER_GID` instead of the three `FRC_*` variables that
  cannot fix it. The previous troubleshooting entry described a symptom
  (`permission denied` in the logs) that never actually appeared, because the
  inspect wrapper discarded stderr.
