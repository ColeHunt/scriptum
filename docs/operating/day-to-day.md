---
sidebar_position: 1
title: Day-to-Day Operations
---

# Day-to-Day Operations

This page covers the routine tasks a mentor performs during an active season:
starting and stopping the app, managing admin access, and keeping an eye on
what the system is doing.

::::note[Running ops commands]

The maintenance commands in this page (`users`, `audit-prune`, `backup`,
`restore`) run **inside the control container** via the `coderunner` CLI:

```bash
docker compose exec control coderunner <subcommand> <args>
```

Use `docker compose run --rm control <subcommand> <args>` instead for a
one-off command while the control plane is stopped (e.g. `restore`). On the
Google Cloud VM the compose project lives in `/opt/coderunner` and needs
`sudo` (`cd /opt/coderunner && sudo docker compose exec -T control …`). On a
from-source host checkout with Bun you can instead use the `bun run <name>`
aliases shown in `package.json`. The examples below use the `bun run` short form;
substitute the `docker compose exec control coderunner <subcommand>` form for a
containerized deployment.

::::

## Starting and stopping

Both the local and Google Cloud deployments run the control plane as a docker
compose service. From the compose directory (the repo root locally, or
`/opt/coderunner` on the VM):

```bash
docker compose up -d        # start (runs DB migrations first, then serves)
docker compose stop         # stop the control plane
docker compose restart control
docker compose ps           # status — control should be "healthy"
docker compose logs -f control
```

Students connect to `http://<host-ip>:4000/` (or `https://<your-domain>/` behind
Caddy on the VM). Student workspace containers keep running after the control
plane stops and are reconciled automatically when it starts again. `restart:
unless-stopped` brings the stack back after a host reboot.

### Stopping workspace containers

Containers are not stopped when the control plane stops. To stop all running
student workspace containers:

```bash
# Stop and remove only stopped/exited managed containers
bun run docker:cleanup

# Force-stop all currently running managed containers
docker stop $(docker ps -q --filter label=frc-sim.managed=true)
```

You can also stop a single workspace's container via the admin API (see
[Admin API break-glass](#admin-api-break-glass) below).

### Between sessions

You do not need to stop containers manually between class sessions. The idle
sweep stops containers automatically after students have been inactive for the
configured timeout. The default is 30 minutes (`IDLE_STOP_MINUTES`); the cloud
VM deployment uses 10 minutes. Containers are reconciled on the next session
without any student-visible data loss.

---

## Managing who can sign in and who is an admin

Anyone who can sign in through Legion can use CodeRunner — there is no
separate local allowlist. Both "who can sign in" and "who is an admin" are
managed entirely in **Legion's own `/admin/groups`**, not here:

- Sign-in access: whether the person exists in Legion's roster at all.
- Admin access: whether they're in the `coderunner-admin` Legion group.

Role is recomputed live from that group membership on every request — there
is no local promote/demote step, and no restart is needed after a group
change takes effect on the next request.

```bash
# List users CodeRunner has seen (name, username, role, workspace slug) —
# read-only, does not affect access.
bun run users:list
```

---

## Container concurrency cap

The system limits how many workspace containers can run simultaneously to
prevent the host from being overloaded when many students sign in at once. The
default cap is **10** (`MAX_ACTIVE_CONTAINERS`).

When a student tries to open their workspace and the cap has been reached, they
see a toast: "Server at capacity. Your coach has been notified. Please try
again in a few minutes." Students with already-running containers are
unaffected.

### Checking and adjusting the cap at runtime

You can read and change the cap without restarting the control plane:

```bash
# Read current effective cap
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:4000/admin/config/max-active-containers

# Set cap to 15
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  -X POST -H "Content-Type: application/json" \
  -d '{"value": 15}' \
  http://localhost:4000/admin/config/max-active-containers
```

The runtime override is stored in the database and takes precedence over the
environment variable until changed again. The admin panel also shows the current
cap and active container count with an inline editor.

---

## Audit log

All admin actions (stopping containers, deleting a workspace, changing the
concurrency cap, lesson assignment) are recorded in the audit log. Role
changes themselves are not — role isn't a local mutation anymore, it's
recomputed live from Legion group membership, which is audited in Legion's
own admin panel instead.

### What is logged

| Action | Trigger |
|---|---|
| `workspace.delete` | Deleting a user's workspace (their Legion access is unaffected) |
| `container.stop` | Stopping a workspace's containers |
| `container.restart-code` | Restarting a workspace's code container |
| `workspace.backup` | Creating an operator workspace backup |
| `workspace.restore` | Restoring a workspace from a backup |
| `lesson-assignment.add` | Assigning a lesson module or track to a user/group |
| `lesson-assignment.remove` | Removing a lesson/track assignment |
| `config.max-active-containers` | Changing the container concurrency cap |

Each entry records the timestamp, the acting user (ID and username), the
action, the target (kind and ID), and optional metadata.

### Viewing the audit log

The admin panel has an "Audit Log" tab with filters by actor, action, and time
range.

Via the API:

```bash
# Latest entries
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:4000/admin/audit-log

# Filter by action prefix
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:4000/admin/audit-log?action=user&limit=50"

# Filter by actor email (substring match)
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:4000/admin/audit-log?actor=coach"

# Paginate using the smallest id from the previous page as cursor
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:4000/admin/audit-log?before=42&limit=25"
```

### Pruning old entries

Audit entries accumulate indefinitely. Prune them periodically:

```bash
# Remove all entries before a date
bun run audit:prune -- --before 2026-01-01

# Preview without deleting
bun run audit:prune -- --before 2026-01-01 --dry-run
```

Running this monthly is a reasonable cadence for a classroom deployment.

---

## Admin API break-glass

If `ADMIN_TOKEN` is set in your environment, you can call admin endpoints
directly with a bearer token. This is useful for scripting and for
bootstrapping before the first admin user has signed in.

```bash
# Overall system status: workspaces, container states, active builds
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:4000/admin/status | jq .

# Stop one workspace's containers
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  -X POST \
  http://localhost:4000/admin/workspaces/<workspaceId>/stop-containers

# Restart one workspace's code container
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  -X POST \
  http://localhost:4000/admin/workspaces/<workspaceId>/restart-code
```

If `ADMIN_TOKEN` is not set, admin endpoints require a signed-in admin session
cookie. The token is optional and intended as a break-glass mechanism, not as
the primary admin interface.
