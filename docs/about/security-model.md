---
sidebar_position: 4
title: Security Model
---

# Security Model

This page describes how CodeRunner gates access, isolates students from each
other, and limits what a container can do. It is written for operators who need
to evaluate whether CodeRunner is safe to deploy on their network.

## Authentication

Sign-in is delegated entirely to **Legion**, the operator's own Slack-native
SSO service (also used by the sibling MARS/WARS apps). CodeRunner stores no
passwords and never talks to a third-party identity provider — Legion mints a
signed `mw_sso` cookie after authenticating the person over Slack, and
CodeRunner verifies that cookie locally on every request using a shared
secret (`SSO_SECRET`, must match Legion's own value exactly). There is no
OAuth, no callback route, and no local session table: every request
re-verifies the cookie fresh, and the verified session is trusted for up to
`SSO_SESSION_TTL` seconds (must also match Legion's own setting).

A weak, Slack-magic-link-issued session (Legion's `via:"link"` marker) is
accepted for the student portal but is never treated as an admin session,
even for someone who holds the admin group — an admin route redirects such a
session to Legion's own step-up flow rather than granting access outright.

## Access control

There is no local allowlist. Anyone who can sign in through Legion at all can
use CodeRunner — access control lives entirely on Legion's side (its own
roster of active members). CodeRunner never receives or stores an email
address; the local `user.email` field is populated with Legion's `username`.

## Admin role

Admin access is a Legion **group membership** (`scriptum-admin`), not a
locally stored field — it's recomputed fresh from the `mw_sso` cookie's
`groups` claim on every request, so revoking it in Legion's `/admin/groups`
takes effect on the very next request, with no CodeRunner-side action needed.
Admin-only routes require that group. An operator can also use a static
break-glass token (`ADMIN_TOKEN`) by passing it as a `Bearer` token in the
`Authorization` header. This is intended for automated tooling and one-off
operator commands, not for day-to-day use, and is independent of Legion (it
still works even if Legion is unreachable).

## Single entry point

The control plane is the only process that listens on a public port (default
`4000`, set by `PORT`). Web shell, AdvantageScope, Choreo, and Elastic
Dashboard static assets are public. Workspace-specific editor traffic,
commands, telemetry, the Choreo proxy, the Elastic layout API, gamepad input,
and file requests require a session and enter through that same port.

How workspace container ports are exposed depends on deployment mode. In
**port mode** (the host dev loop, `bun run dev:control`) each container's
ports are bound to `127.0.0.1` only. In **network mode** (the default for
`docker compose` deployments) workspace containers publish no host ports at
all — they join a private Docker network and the control plane reaches them
by container name over Docker's internal DNS. Either way, no container port is
reachable from outside the host, even if the host firewall is misconfigured,
and there is no way for a student to connect to another student's container
directly from a browser. See
[decision 031](https://github.com/mathewdunne/CodeRunner/blob/main/docs/decisions/031-containerized-control-plane.md) for the two
modes.

## Control plane container privileges

In the standard `docker compose` deployment, the control plane runs as a
container and needs the host Docker socket bind-mounted so it can manage
per-student containers as siblings. That container runs as a **non-root**
uid:gid — the user that owns the bind-mounted data directory (`SCRIPTUM_UID`
/ `SCRIPTUM_GID`, defaulting to `1000:1000`), with the host `docker` group
gid added as a supplementary group (`SCRIPTUM_DOCKER_GID`) so the non-root
process can still reach the socket. Running non-root keeps the data directory
host-owned rather than root-owned and reduces the blast radius of a compromise.

It does **not** eliminate it: the mounted socket still grants full control of
the host's Docker daemon, so a remote-code-execution bug in the control plane
remains effectively a container escape — the socket is the primary privilege
surface and the only writable host mount besides the data directory. This is
the same trust level as the pre-containerized deployment (the host user running
the control plane process was a member of the `docker` group), just repackaged.
Operators evaluating CodeRunner for a shared network should weigh this alongside
the [demo mode](#demo-mode) warning below. See
[decision 031](https://github.com/mathewdunne/CodeRunner/blob/main/docs/decisions/031-containerized-control-plane.md) for the full
rationale.

## Per-workspace access enforcement

All workspace routes are under `/u/<slug>/...`. Before serving any request
under that prefix the control plane:

1. Resolves the session from the signed cookie.
2. Looks up the workspace record by slug.
3. Confirms that the workspace's `user_id` matches the authenticated user's ID.

A student whose session is valid but whose slug does not match the URL receives
a `403`. An unauthenticated request is redirected to the login page for browser
requests or returns `401` for API requests. There is no mechanism for a student
to reach another student's editor, simulator, or files through normal routes.

Choreo's and Elastic Dashboard's app files (`/choreo/`, `/elastic/`) contain
no student data and are served publicly, like AdvantageScope's `/scope/`
assets. Their per-student traffic sits under the same ownership-checked
`/u/<slug>/` prefix as everything else:

- Choreo's `/u/<slug>/api/choreo/**` is a reverse proxy to `choreo-server`
  running inside that student's own workspace container — the sidecar reads
  and writes `src/main/deploy/choreo/**` directly on that container's local
  filesystem, so there is no separate file-access API surface to reason
  about beyond the container isolation described below.
- Elastic's `/u/<slug>/api/elastic-layout` is a small `GET`/`PUT` API,
  ownership-checked like the rest of `/u/<slug>/*`, capped at 2 MB, and
  validated as a JSON object before being written to
  `src/main/deploy/elastic-layout.json`.

## Container isolation

Each student's container:

- Runs under a non-root host UID/GID, so container files are owned by a real
  user rather than root. On the host dev loop this is the control plane
  process's own UID/GID; in containerized (`docker compose`) deployments the
  control plane derives it by `stat()`ing the bind-mounted data directory
  (or an explicit `FRC_CONTAINER_USER` override) and refuses to start if that
  resolves to root — see [decision 031](https://github.com/mathewdunne/CodeRunner/blob/main/docs/decisions/031-containerized-control-plane.md).
- Has a hard memory cap enforced by Docker's cgroup limit (default `4096m`,
  set by `CODE_MEMORY_LIMIT`). A runaway robot program cannot exhaust host
  memory. Disk reads are likewise throttled per device (default `64mb`, set
  by `CODE_DISK_READ_LIMIT`) so a single container cannot monopolize host
  disk throughput.
- Has its three ports bound on `127.0.0.1` only in port mode, or published
  nowhere at all in network mode; either way it has no inbound network
  exposure beyond what the control plane itself proxies.

The `MAX_ACTIVE_CONTAINERS` limit (default `10`) prevents a single deployment
from spinning up more containers than the host can sustain, reducing the blast
radius of an unusually large concurrent session spike.

## Audit log

Significant actions (sign-in, workspace creation, run start/stop, project
loads, and admin operations) are written to an `audit_log` table in the
SQLite database. Each entry records the actor's user ID and email, the action,
an optional target, and a millisecond timestamp. Admins can query the log
through the admin API.

## WebSocket origin validation

Before upgrading any WebSocket connection the control plane validates the
`Origin` header against the configured `SCRIPTUM_BASE_URL`. Cross-origin
WebSocket upgrades are rejected with `403`. Loopback aliases
(`localhost` / `127.0.0.1`) are treated as equivalent to support local
development, but production deployments served over a real hostname are not
affected by that exception.

## Demo mode

Starting the control plane with `--demo` (or `SCRIPTUM_DEMO_MODE=1`) bypasses
Legion entirely: every request is treated as a single synthetic admin session,
and `SSO_SECRET` doesn't need to be set at all. This is designed for
zero-configuration local evaluation only.

**Demo mode must never be deployed publicly.** There is no privacy boundary
between concurrent visitors in demo mode: all requests resolve to the same
user. The control plane prints a multi-line warning banner at startup and the
workspace shell displays a yellow banner to make this visible. See
[Deploying](../deploying/overview.md) for how to configure Legion for a real
deployment.

## What CodeRunner does not provide

Operators should be aware of the following boundaries:

- **No network egress restriction on containers.** A robot program running
  inside a container can make outbound network requests. If your environment
  requires egress filtering, that must be applied at the host or network level.
- **No code scanning.** Student code is compiled and executed as-is. CodeRunner
  does not scan or sandbox the robot program's behavior beyond the container's
  cgroup memory limit.
- **TLS termination is the operator's responsibility.** CodeRunner speaks plain
  HTTP on its single port. A reverse proxy (nginx, Caddy, or a cloud load
  balancer) must provide TLS. See [Deploying](../deploying/overview.md).
