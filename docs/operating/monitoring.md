---
sidebar_position: 3
title: Monitoring
---

# Monitoring

## Control-plane logs

The control plane emits structured logs to stdout (info/debug) and stderr
(errors and fatals). The format in development is human-readable:

```
14:23:01.482 INFO  [control.runs]  run started workspaceId=alice-1 runId=run_abc
```

With `LOG_FORMAT=json`, each line is a single-line JSON object, which is easier
for log shippers to parse:

```json
{"timestamp":"2026-05-21T14:23:01.482Z","level":"info","category":"control.runs","message":"run started","workspaceId":"alice-1","runId":"run_abc"}
```

### Log verbosity

Set `LOG_LEVEL` to one of: `trace`, `debug`, `info`, `warning`, `error`,
`fatal`. The default is `debug`; `info` is quieter for production.
Log categories follow the pattern `control.<subsystem>`, for example
`control.runs`, `control.containers`, `control.auth`, `control.idle`.

ANSI colors are disabled automatically when output is not a TTY (piped to a
file or captured by Docker's log driver).

### Capturing a session

For a containerized deployment, follow the control container's logs:

```bash
docker compose logs -f control | tee coderunner-$(date +%Y%m%d).log
```

For a from-source host run, pipe `bun run dev:control` (or `bun run start`)
through `tee` the same way.

## Prometheus metrics

The control plane exposes Prometheus-format metrics at `GET /metrics`.

### Authentication

`/metrics` requires authentication. If `METRICS_TOKEN` is set, scrapers send
`Authorization: Bearer <token>`. If `METRICS_TOKEN` is not set, the endpoint
falls back to admin session auth (same gate as `/admin/*`).

```bash
# Manual probe
curl -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:4000/metrics
```

Bind the control plane to localhost or a private network interface so scrapers
reach `/metrics` over a trusted path without exposing it to the internet.

### What is exposed

The metrics fall into four categories:

**HTTP traffic**

- `http_request_duration_seconds{method, route, status_class}`: request
  latency. The `route` label is templated (e.g. `/u/:slug/api/sim/status`) to
  keep cardinality bounded.
- `http_requests_in_flight`: concurrent requests being dispatched. A spike
  here combined with rising latency indicates the event loop is saturated.
- `proxy_upstream_duration_seconds{upstream, outcome}`: latency of upstream
  HTTP fetches. Current upstreams: `vscode` (editor HTTP proxy) and `nt4`
  (the sim alive probe, capped at 500 ms by its timeout).

**Run pipeline**

- `run_build_duration_seconds`: time from run queue to first sim-ready signal
  (compile + boot).
- `run_active_duration_seconds{terminal_status}`: time spent in `running`
  state before termination.
- `runs_total{terminal_status}`: completed run counter by outcome
  (`stopped` / `failed` / `canceled`).

**Containers**

- `container_start_duration_seconds`: cold-start time to create and start a
  workspace container.
- `container_cpu_percent{workspace_id}`: per-container CPU utilization,
  sampled every 15 s from `docker stats`.
- `container_memory_percent{workspace_id}`: per-container memory usage as a
  percentage of the container limit, sampled every 15 s.
- `active_workspaces`: count of workspaces with a running container at the
  last poll.
- `idle_sweep_stops_total`: workspaces stopped by the idle sweep.

**Process / runtime**

Standard prom-client defaults: `process_cpu_seconds_total`, heap, garbage
collection, and event-loop lag gauges.

## Quick health checks

### Health endpoint

The control plane exposes an unauthenticated health endpoint:

```bash
curl http://localhost:4000/healthz
```

A healthy service responds HTTP 200 with:

```json
{"ok":true,"service":"control","version":"v2-3"}
```

### Container and system state

```bash
# See all managed containers and their state
docker ps --filter label=frc-sim.managed=true

# Per-container CPU and memory (one-shot snapshot)
docker stats --filter label=frc-sim.managed=true --no-stream

# Admin status: workspace list, container states, active build count
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:4000/admin/status | jq .
```

Signs to watch for:

- High `container_memory_percent` approaching 100% means OOM risk; consider
  raising `CODE_MEMORY_LIMIT` or reducing the concurrency cap.
- High `active_workspaces` with slow build durations means CPU headroom is low;
  check the concurrency cap against host sizing (see [Capacity](./capacity.md)).
- If `runs_total{terminal_status="failed"}` is rising, check for build timeouts
  or container OOMs in the logs.

## Dashboards

Pre-built Grafana dashboard JSON for these metrics lives in `dashboards/` in
the repo, for import into any Grafana instance that scrapes `/metrics`.
