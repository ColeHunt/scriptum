# 048 — Head/worker fleet deployment redesign

Status: **Accepted** — implemented 2026-09-28 (see Implementation notes);
not yet run against real DigitalOcean infrastructure

> **Update 2026-09-27:** the Google Compute Engine deployment described in
> Context below was inherited from upstream and never used by this fork; it
> was removed by decision 052, which also settles that Scriptum is hosted like
> the other MARS/WARS apps. This design now only covers where student
> workspaces run: the head is Scriptum's `apps-infra` service, and workers
> carry the per-student containers the shared droplet can't hold. There is no
> GCE cutover. The same day, the storage droplet and the separate VPC were
> dropped in favour of the head serving NFS inside its existing VPC (design
> points 5 and 6).

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
   rev-proxy (NPM) ──▶ scriptum-head (new compose service)
                         - Legion SSO (unchanged)
                         - SQLite: workspaces/leases/audit + NEW workers table
                         - Fleet manager (DO API client)
                         - RemoteDockerRuntimeProvider
                       host: NFS server for an attached DO Volume
                              │  the droplet's existing private VPC
                       ┌──────┴──────┐
                       ▼             ▼
                 worker droplet worker droplet
                 (Docker only,  (Docker only,
                  bin-packed)    bin-packed)
                       └──────┬──────┘
                NFS-mounted data/users/<id>/{project,home}
```

Workers run nothing but Docker Engine, an SSH server, and an NFS client
mount — no CodeRunner code is ever deployed to them.

### Key design points

1. **Head packaging**: extends the existing `scriptum-control`
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
5. **Persistence**: a resizable DO Volume attached to the head, which serves
   its `users/` directory over NFSv4 to every worker
   (`deploy/digitalocean/setup-head-nfs.sh`). *Revised 2026-09-27: originally
   a separate always-on storage droplet; the head can serve NFS now that it
   shares a VPC with the workers, which saves a droplet (the team's droplet
   cap is small) and its cost.*
6. **Networking**: workers join the shared droplet's existing VPC
   (`default-nyc1`). A tag-based firewall admits only the head's private IP
   into workers, and the head's nfsd binds to that private IP with NFSv3/
   rpcbind disabled — workers never get a public Scriptum-facing port,
   matching the shared droplet's convention that nothing but `rev-proxy`
   touches the public internet. *Revised 2026-09-27: originally a new VPC
   with the head outside it and allowlisted by public IP, because the old
   shared droplet predated any VPC; the rebuilt droplet is already in one.*
7. **Provisioning**: the head calls the DigitalOcean REST API directly to
   create workers (from a pre-baked custom image) and destroy them once
   idle. The DO API token is a scoped credential in a manually-managed
   `.env` secret, matching this app family's existing paired-secret
   convention rather than introducing new secrets infrastructure.
8. **Worker cold-start**: a periodically-refreshed DigitalOcean Custom
   Image/snapshot with Docker pre-installed and the current
   `scriptum-workspace` image pre-pulled, refreshed as a new step appended
   to `.github/workflows/release.yml` after it publishes
   `scriptum-workspace`.
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
- **Phase 3** — needs the shared droplet: add `scriptum-head` as a new
  apps-infra compose service, wire an NPM subdomain, confirm/resize the
  droplet, cut real traffic over.

## Consequences

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

## Implementation notes (2026-09-28)

Phases 2 and 3 were built together, behind `SCRIPTUM_FLEET=1`
(operator guide: `docs/deploying/fleet.md`). Where the build departed from
or filled in the design above:

- **Non-blocking placement.** Creating a worker takes a minute or two, so
  `FleetManager.placeWorkspace` returns immediately: the workspace is
  reserved against the in-flight droplet and reports `starting` until a poll
  finds its worker ready. Readiness is an SSH probe (first-boot marker, NFS
  mounted, `docker info`), not a heartbeat.
- **Cost guards.** A hard `SCRIPTUM_MAX_WORKERS` (booting workers included);
  a two-minute backoff after a failed create instead of retrying on every
  poll; destroy of any `scriptum-worker`-tagged droplet the head has no row
  for once it is 15 minutes old; and release of worker slots held by
  workspaces idle past `IDLE_STOP_MINUTES` even when they never got a
  running container (IdleManager only stops running ones).
- **Proxy target.** Port-mode containers publish on the worker's private IP
  and the head proxies there (`publishHost`); loopback publishing only works
  when the daemon is local. Build/run exec streams go to the worker too.
- **Shared path.** The head exports `<data>/users` and workers mount it at
  the identical path, so every bind-mount path the head computes is valid on
  the worker.
- **No Docker socket on the head.** Fleet mode skips self-inspection and
  takes its data dir and container user from settings, so the shared droplet
  never hands Scriptum control of the other apps' containers.
