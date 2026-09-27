---
sidebar_position: 1
title: Deployment Overview
---

# Deployment Overview

Scriptum is self-hosted. You run the control plane and the per-student
workspace containers on a machine you control; there is no managed SaaS.

## Local Deployment

Run Scriptum on a lab PC, spare laptop, or mini PC. Students connect over the
same trusted local network. Setup is a small `.env` file followed by
`docker compose up`.

See [Local Deployment](./local.md).

## Hosting with the MARS/WARS apps

For remote access, Scriptum is hosted the same way as the other MARS/WARS apps
(Legion, Tempus, Munus, ...): as a service in the team's shared `apps-infra`
Docker Compose stack, behind Nginx Proxy Manager at `scriptum.marswars.org`, deployed by a
GitHub Actions workflow on merge to `main`.

Scriptum is much heavier than its siblings: every active student runs their own
workspace container (editor, Java, and simulator), so the host needs memory for
each student working at once. See [Capacity](../operating/capacity.md) before
choosing a machine.

## What every deployment needs

Every non-demo deployment needs:

- **A Legion instance.** Sign-in is delegated entirely to Legion, your team's
  own SSO service; Scriptum needs its base URL and shared `SSO_SECRET`. See
  [Legion Setup](./legion-setup.md).
- **Docker.** Each active student runs in a per-student workspace container
  (sim + editor), so the host needs a working Docker Engine.
