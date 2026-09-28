-- Head/worker fleet scaffolding (Phase 1 of the deployment redesign). See
-- docs/decisions/048-head-worker-fleet-deployment.md. A `workers` row tracks
-- one DigitalOcean worker droplet; `workspaces` gains a nullable `worker_id`
-- recording which worker (if any) owns this workspace's container. NULL
-- means "unplaced" - either never started, or idle-stopped and free to be
-- re-placed on next start (the pack-tightest policy in 048 deliberately does
-- not pin a workspace to its previous worker once its container has
-- stopped). This is the single source of truth for placement, set as soon as
-- the scheduler decides it - deliberately NOT mirrored onto container_leases
-- too, since a workspace can be assigned to a worker before any lease exists
-- (its first ensureWorkspaceRunning call hasn't happened yet), and a second
-- copy would just be a drift risk for no benefit.
--
-- This migration adds the schema only; nothing in the running app reads or
-- writes these columns yet (no FLEET_MODE exists) - see the fleet/ module for
-- the scheduler and remote runtime provider that will use them once a real
-- worker fleet exists to test against.

CREATE TABLE workers (
  id TEXT PRIMARY KEY,
  do_droplet_id TEXT NOT NULL,
  private_ip TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('provisioning', 'ready', 'draining', 'destroying')),
  capacity INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  last_heartbeat_at TEXT
);

ALTER TABLE workspaces ADD COLUMN worker_id TEXT REFERENCES workers(id) ON DELETE SET NULL;

CREATE INDEX idx_workspaces_worker ON workspaces(worker_id);
