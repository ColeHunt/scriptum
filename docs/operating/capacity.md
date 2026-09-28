---
sidebar_position: 4
title: Capacity and Sizing
---

# Capacity and Sizing

## Per-student resource usage

Each active student runs one workspace container. Approximate resource
consumption per active student:

| Resource | Steady-state | Peak (during build) |
|---|---|---|
| RAM | ~1.0–1.5 GB | ~1.5–2.5 GB |
| CPU | minimal (idle) | 1–2 cores |
| Disk (project files) | ~50 MB | ~50 MB |
| Disk (Gradle/editor caches) | ~500 MB | ~500 MB |

Reserve roughly 4 GB for the OS, Docker daemon, and browser overhead on the
host itself.

## Container memory cap

Each container is hard-limited to `CODE_MEMORY_LIMIT` (default: `4096m`). If a
container exceeds its limit, the Linux OOM killer terminates a process inside it.
The student typically sees a failed run; the container itself keeps running.

Be careful lowering this: a cold Gradle build plus the Java language server and
codium-server together approach 4 GB. A container pinned at its limit does
not always OOM — when most of its memory is reclaimable page cache, the kernel
evicts and re-reads the container's files (jars, class files) in a loop
instead. That thrashing generates sustained disk reads that can saturate the
host's disk throughput and stall the whole VM. `CODE_DISK_READ_LIMIT` (below)
bounds the blast radius, but the right fix is a limit the workload actually
fits in.

Adjust in your `.env`:

```bash
# Tighter cap for a memory-constrained host (expect slower cold builds and
# occasional language-server OOMs)
CODE_MEMORY_LIMIT=3072m
```

Changing `CODE_MEMORY_LIMIT` requires a control-plane restart to take effect for
newly started containers. Already-running containers are not affected until they
are next restarted.

## Container disk read cap

Each workspace container's disk reads are throttled to `CODE_DISK_READ_LIMIT`
per physical block device (default: `64mb`, via Docker `--device-read-bps`).
This keeps one container that is thrashing, indexing, or scanning from
monopolizing the host's provisioned disk throughput — on cloud VMs that
budget is often small (on the order of 150 MiB/s) and a single unthrottled
container can freeze the entire host, including SSH.

Devices are auto-detected from `/sys/block` when the control plane runs
containerized (compose deployments). Host/dev runs apply no limit, because a
VM-backed Docker daemon (Docker Desktop) exposes different devices than the
host. Set `CODE_DISK_READ_LIMIT=0` to disable. Like the memory cap, changes
apply to newly started containers after a control-plane restart.

## Host sizing guidance

| Students | RAM | CPU | Disk | Notes |
|---|---|---|---|---|
| 1–3 | 16 GB | 4 cores | 30 GB | Development or testing |
| 4–6 | 16–24 GB | 4–6 cores | 40 GB | Small classroom; consider lowering `CODE_MEMORY_LIMIT` to `3072m` |
| 7–10 | 32 GB | 6+ cores | 50 GB | Full classroom; preferred target |
| 10+ | 48+ GB | 8+ cores | 80 GB | Large classroom; increase `CODE_MEMORY_LIMIT` and cap |

## Concurrency cap

`MAX_ACTIVE_CONTAINERS` (default: `10`) is an admission-control gate: when a
student tries to open their workspace and the cap is already reached, the server
returns HTTP 503 and the browser shows a "Server at capacity" toast. Students
with already-running containers are not affected.

The cap can be changed at runtime without a restart; see
[Day-to-Day Operations](./day-to-day.md#container-concurrency-cap).

Set a conservative cap relative to available RAM. A rough rule: multiply
available RAM (after the 4 GB OS reserve) by 0.6 and divide by
`CODE_MEMORY_LIMIT` in GB:

```
available_for_containers = total_RAM - 4 GB
safe_cap ≈ available_for_containers × 0.6 ÷ CODE_MEMORY_LIMIT_GB
```

For a 32 GB host with `CODE_MEMORY_LIMIT=4096m`:
`(32 - 4) × 0.6 ÷ 4 ≈ 4 containers` with comfortable headroom for
simultaneous builds. Idle editors use far less than their cap, so a higher
`MAX_ACTIVE_CONTAINERS` usually works in practice — but expect OOM kills if
many students build at once.

## Measuring actual usage

```bash
# Per-container CPU and memory (one-shot)
docker stats --filter label=frc-sim.managed=true --no-stream
```

The `container_cpu_percent` and `container_memory_percent` metrics (per
workspace, sampled every 15 s) are exposed as Prometheus metrics at `/metrics`
(see [Monitoring](./monitoring.md)). Use those to confirm that your memory cap and
concurrency limit are well-matched to actual student behaviour.

## Disk growth

Student caches grow over time. The main contributors are:

- **Gradle cache** (`data/users/*/home/`): grows per workspace as new
  dependencies are downloaded. Typically reaches 300–500 MB per student after a
  few builds.
- **Run logs** (`data/users/*/logs/`): appended on every build and run.
- **Docker layer cache** on the host: grows when you rebuild or update the
  workspace image.

### Checking disk usage

```bash
# Overall free space
df -h /

# Size of the data directory
du -sh data/

# Per-workspace breakdown (approximate)
du -sh data/users/*/
```

### Cleaning up

Remove stopped managed containers (does not affect running containers or
student files):

```bash
bun run docker:cleanup

# Preview first
bun run docker:cleanup -- --dry-run
```

Prune Gradle caches and run logs for a specific student (stop their container
first):

```bash
rm -rf data/users/<workspaceId>/home/
mkdir -p data/users/<workspaceId>/home
rm -rf data/users/<workspaceId>/logs/runs/*
```

Prune all regenerable data across all workspaces (containers must be stopped):

```bash
for dir in data/users/*/; do
  rm -rf "$dir/home" "$dir/logs"
  mkdir -p "$dir/home" "$dir/logs/runs"
done
```

Clean up dangling Docker images and build cache:

```bash
docker system prune -f
docker builder prune -f
```

Never delete `data/users/*/project/`; that is the student's source code.
Back it up first if you are unsure (see [Backups](./backups.md)).
