---
sidebar_position: 2
title: Legion Setup
---

# Legion Setup

CodeRunner does not store passwords and has no sign-in system of its own.
Sign-in is delegated entirely to **Legion**, your team's own Slack-native
member-management and single-sign-on service. CodeRunner verifies Legion's
shared `mw_sso` cookie locally — there is no callback, no OAuth app to
register, and no third-party identity provider involved.

If you don't already run a Legion instance for your team, set one up first;
CodeRunner is one of several sibling apps (alongside Munus, Tempus, Virtus)
that all share it.

This page covers wiring an existing Legion instance to a CodeRunner
deployment. The values here are used the same way whether you deploy
[locally](./local.md) or to [Google Cloud](./gcloud.md); only the URLs
differ (`http://localhost:4000` vs `https://<your-domain>`).

## Deploy-topology prerequisite: a shared parent domain

The browser must send the `mw_sso` cookie to both CodeRunner and Legion, so
they need to share a parent domain — e.g. `coderunner.yourteam.org` and
`legion.yourteam.org` both under `yourteam.org`, with Legion's own
`SSO_COOKIE_DOMAIN` set to `.yourteam.org`. Two independent domains with no
common parent cannot share the cookie; sign-in will never complete. For a
`localhost`-only local evaluation, run Legion on the same host and both apps
will share the `localhost` cookie domain automatically.

## Wire the credentials into CodeRunner

CodeRunner reads these from environment variables (see
`apps/control/src/config.ts` and [Configuration](../reference/configuration.md)):

| Variable | Purpose |
| --- | --- |
| `SSO_SECRET` | Shared secret for verifying Legion's `mw_sso` cookie. **Must be the exact same value as Legion's own `SSO_SECRET`.** Required for any non-demo deployment. |
| `SSO_SESSION_TTL` | How long (seconds) a verified session is trusted. **Must match Legion's own `SSO_SESSION_TTL`** (Legion's default is 43200 — 12 hours). |
| `LEGION_BASE_URL` | Legion's own origin, e.g. `https://legion.yourteam.org`. Used to build the "Sign in via Legion" and admin step-up redirects. |
| `FABRICA_BASE_URL` | This deployment's own public base URL. Defaults to `http://localhost:4000`. |

Where these values live depends on the deployment:

- **Local:** in your `.env` file. See [Local Deployment](./local.md).
- **Cloud VM:** in Google Secret Manager, materialized into the VM's `.env` by
  `render-env.sh` at boot. See [Google Cloud Deployment](./gcloud.md).

## Bootstrapping the first admin

There is nothing to bootstrap on CodeRunner's side — admin access is entirely
a Legion group membership, recomputed live on every request from the signed
`mw_sso` cookie. **In Legion's own admin panel** (`/admin/groups`), create a
group named `fabrica-admin` (if it doesn't already exist) and add whoever
should reach CodeRunner's `/admin` to it. That's the whole bootstrap — no
CodeRunner-side commands, no restart required, no local allowlist to seed.

Anyone who can sign in through Legion at all can use CodeRunner — Legion
membership alone is the access gate. There is no separate CodeRunner-side
allowlist of who may sign in.

> Admins also get a break-glass option: setting the `ADMIN_TOKEN` env var lets
> you call the `/admin/*` API with a bearer token even if Legion is
> misconfigured. See [Configuration](../reference/configuration.md).
