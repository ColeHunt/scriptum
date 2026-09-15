# 048 — Head/worker fleet deployment redesign

Status: **Proposed** — 2026-09-15 (design/roadmap; Phase 1 scaffolding
implemented, no DigitalOcean infrastructure exists yet)

## Context

CodeRunner today deploys as one dedicated, always-on Google Compute Engine VM
(`c4-standard-4`, Terraform-provisioned — `deploy/terraform/`), sized for peak
classroom load and billed 24/7 regardless of how many students are actually
active. Every sibling MARS/WARS app (Legion, Munus, Tempus, Virtus, Merces)
instead runs as a lightweight `docker compose` service on one shared
DigitalOcean droplet (repo `apps-infra`), fronted by one Nginx Proxy Manager
instance, paying for one small box regardless of app count.

The goal is to fold CodeRunner into that model at the front door — a small
**head** service living on the shared droplet alongside the other apps —
while keeping the actually-expensive part (per-student Docker workspace
containers, each up to 4 GB RAM) on a **fleet of separate worker droplets
that the head creates and destroys based on real-time demand**, so CodeRunner
stops paying for peak-sized always-on compute and instead pays only for the
compute actually in use.

This is forward design work: no DigitalOcean droplets exist for this yet.
This decision records the target architecture so implementation can proceed
in phases, starting with what's buildable without any real infrastructure.

## Decision

| Question | Decision |
|---|---|
| Where does control/orchestration logic live? | **Centralized head** — the head is the sole control plane (auth, sessions, DB, orchestration, proxying). Worker droplets carry no CodeRunner code; they are bare Docker capacity the head manages remotely. |
| How are sessions packed onto workers? | **Bin-packed with a capacity cap** — each worker hosts up to N concurrent students (N derived from the worker's RAM ÷ `CODE_MEMORY_LIMIT`). The head fills existing workers before booting a new one. |
| How does student data survive a worker being destroyed? | **Central network filesystem** — all workers (and the head) mount one shared network filesystem for `data/users/<workspaceId>/{project,home}`; destroying a worker droplet never touches student data. |
| How are workers created/destroyed? | **Direct DigitalOcean API calls from the head**, not Terraform — `apply`/`destroy` is too slow/stateful for runtime autoscaling; Terraform (if used at all) is limited to the one-time static pieces. |

### Target architecture

```text
Browser
   │  HTTPS/WSS (one port, unchanged)
   ▼
Shared droplet — apps-infra compose stack
   rev-proxy (NPM) ──▶ coderunner-head (new compose service)
                         - Legion SSO (unchanged)
                         - SQLite: workspaces/leases/audit + NEW workers table
                         - Fleet manager (DO API client)
                         - RemoteDockerRuntimeProvider
                              │  private DO VPC (new)
                ┌─────────────┼─────────────┐
                ▼             ▼             ▼
          worker droplet worker droplet  storage droplet
          (Docker only,  (Docker only,   (NFS server + DO
           bin-packed)    bin-packed)     Volume, persistent)
                └─────────────┴─────────────┘
                NFS-mounted data/users/<id>/{project,home}
```

Workers run nothing but Docker Engine, an SSH server, and an NFS client
mount — no CodeRunner code is ever deployed to them.

### Key design points

1. **Head packaging**: extends the existing `coderunner-control`
   codebase/image (a fleet-mode config flag switches on the fleet manager and
   `RemoteDockerRuntimeProvider`), not a new codebase — everything else
   (Legion auth, admin portal, lesson assignment, audit log, run pipeline,
   Choreo/Elastic proxying) already routes through `WorkspaceRuntimeProvider`
   rather than assuming local Docker, per
   [decision 020](020-workspace-runtime-provider.md).
2. **Worker transport**: SSH-based Docker CLI context
   (`DOCKER_HOST=ssh://user@worker-private-ip`) per worker, not a TCP+TLS
   remote daemon — reuses `docker-client.ts`'s existing
   `Bun.spawn([dockerPath, ...args])` shelling pattern with a per-call env
   override, no cert infrastructure needed.
3. **`RemoteDockerRuntimeProvider`** implements `WorkspaceRuntimeProvider` by
   routing each call to whichever worker owns a workspace (`worker_id`),
   delegating to a per-worker `LocalDockerRuntimeProvider` instance rather
   than reimplementing Docker command construction. Relies on every worker
   being provisioned identically from one golden image (so
   `storage.config`'s network/host-data-dir/disk-limit settings stay
   fleet-wide constants) and on the head mounting the same shared filesystem
   workers do (so `LocalDockerRuntimeProvider`'s own host-filesystem calls
   land on storage every worker also sees).
4. **Data model**: a new `workers` table (`id`, `do_droplet_id`,
   `private_ip`, `status`, `capacity`, `created_at`, `last_heartbeat_at`);
   `workspaces` gains a nullable `worker_id` FK (`ON DELETE SET NULL`) — the
   single source of truth for placement, set as soon as the scheduler decides
   it, deliberately **not** mirrored onto `container_leases` (a workspace can
   be assigned before any lease exists; a second copy is only a drift risk).
5. **Persistence**: a small dedicated storage droplet running an NFS server
   backed by a resizable DO Volume, on the private VPC, mounted by every
   worker and the head.
6. **Networking**: a new DigitalOcean VPC spanning the head, storage node,
   and workers; firewall rules restrict worker SSH (22) and the storage
   node's NFS port (2049) to only the head's/storage node's private IPs —
   workers never get a public CodeRunner-facing port, matching the shared
   droplet's existing convention that nothing but `rev-proxy` touches the
   public internet.
7. **Provisioning**: the head calls the DigitalOcean REST API directly to
   create workers (from a pre-baked custom image) and destroy them once
   idle. The DO API token is a scoped credential in a manually-managed
   `.env` secret, matching this app family's existing paired-secret
   convention rather than introducing new secrets infrastructure.
8. **Worker cold-start**: a periodically-refreshed DigitalOcean Custom
   Image/snapshot with Docker pre-installed and the current
   `coderunner-workspace` image pre-pulled, refreshed as a new step appended
   to `.github/workflows/release.yml` after it publishes
   `coderunner-workspace`.
9. **Idle/scale-down**: extends the existing per-container idle-stop concept
   (`IDLE_STOP_MINUTES`) one level up — once a worker's last workspace is
   unplaced, the fleet manager waits a grace period, then destroys the
   droplet via the DO API. Destroy/recreate churn is a latency and
   reliability concern, not a cost or data-safety one: DigitalOcean bills
   per-second (thrashing doesn't inflate the bill) and workers hold no state
   that matters (destroying one is always safe). The grace period debounces
   repeated destroy-then-immediately-recreate cycles when usage oscillates
   at a worker's capacity boundary. Every scale-up re-runs the worker's
   first-boot path (unlike today's single VM, which only boots once, ever),
   so that path should do as little as possible beyond what the golden
   snapshot already bakes in. SSH host-key churn (every fresh droplet has a
   new host key) needs a decision at implementation time: disable strict
   host-key checking (workers sit on a head-only-reachable private VPC, so
   the MITM risk this protects against doesn't really apply) or have each
   worker report its key back to the head at creation to pre-seed
   `known_hosts`.
10. **Placement policy**: pack-tightest (always place on the *fullest*
    worker with room, never spread load evenly — spreading creates more
    thinly-loaded workers, worse fragmentation) and re-derived on every
    (re)start rather than sticky for a workspace's lifetime. A workspace's
    `worker_id` is only binding while its container is actually running;
    once idle-stopped, it's treated as unplaced again and re-placed fresh
    next time it starts. This bounds the fragmentation cost of bin-packing
    (a worker stays up only while it has at least one *actively running*
    session; an empty one is always destroyed after the grace period) and
    works cleanly because project files live on shared NFS — "relocating" an
    idle workspace is just picking a different worker next time, no live
    session is ever disrupted.

### Phased roadmap

- **Phase 1 (this commit)** — buildable with no DigitalOcean account: the
  `workers` table and `worker_id` FK (migration `015_worker_fleet.sql`), the
  scheduler's pure placement/destroy-eligibility/capacity-derivation
  functions (`fleet/scheduler.ts`), and `RemoteDockerRuntimeProvider`
  (`fleet/remote-docker-runtime-provider.ts`), unit-tested against fake
  per-worker Docker daemons — not wired into `createApp()`'s default path.
- **Phase 2** — needs a DigitalOcean account + API token, not yet the shared
  droplet: build the golden worker-image baking step; prove real
  droplet-create → SSH docker-context → NFS-mount → run-one-container →
  droplet-destroy end to end against a throwaway DO project.
- **Phase 3** — needs the shared droplet: add `coderunner-head` as a new
  apps-infra compose service, wire an NPM subdomain, confirm/resize the
  droplet, cut real traffic over, decommission the GCP Terraform/cloud-init
  path.

## Consequences

- `deploy/terraform/` (the GCP single-VM tree), `deploy/cloud-init/`, and
  `.github/workflows/deploy.yml`'s GCE SCP/SSH flow become obsolete once
  cutover is verified — kept until then.
- Legion SSO verification, the single front-door principle, the admin
  portal, lesson assignment, audit log, the run pipeline, and Choreo/Elastic
  proxying are all unaffected — they already depend on
  `WorkspaceRuntimeProvider`, not on co-located Docker.
- The shared droplet is documented (in `apps-infra`) as 1 vCPU/1 GB RAM,
  sized for today's lightweight FastAPI apps — a head that also fleet-manages
  N remote Docker daemons will likely need that box resized before it can
  live there, a shared-infra cost decision affecting every sibling app, to
  confirm at actual deploy time.
- Worker failure mid-session (network partition, DO incident, OOM) has no
  reschedule/failover logic yet — for v1, treated like today's Run semantics
  (state isn't preserved across a crash); revisit once real usage data
  exists.
- Exact capacity-cap numbers, idle grace-period tuning, real cold-start
  timing, and DO API token scoping are deploy-time decisions, not resolved
  here.
- `LocalDockerRuntimeProvider` is reused as-is per worker rather than
  rewritten — but `app.ts` and some call sites (e.g. tests using
  `app.containers.ensureCodeContainer` directly) currently assume the runtime
  provider concretely *is* a `LocalDockerRuntimeProvider`; reconciling that is
  Phase 3 work when the head is actually wired to use
  `RemoteDockerRuntimeProvider` in `createApp()`, not part of this pass.
