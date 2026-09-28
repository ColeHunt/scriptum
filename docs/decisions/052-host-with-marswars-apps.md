# 052 — Host with the MARS/WARS apps; remove the inherited cloud deploy

Status: **Accepted** — 2026-09-27

## Context

This repo is a fork of the upstream CodeRunner project. The fork inherited its
remote-hosting setup: Terraform for a Google Compute Engine VM with Secret
Manager and Workload Identity Federation (`deploy/terraform/`), a cloud-init
boot script that rendered `.env` and the Caddy/Alloy configs from Secret
Manager (`deploy/cloud-init/`), a `docker-compose.prod.yml` overlay for Caddy
(TLS) and Grafana Alloy that only worked with that boot script, an optional
Cloudflare Pages layer (`deploy/cloudflare/`), a manual `deploy.yml` workflow
that rolled all of it, and docs for each piece. The fork never configured any
of it: the repo has none of the GCP variables `deploy.yml` needs.

Defaults across the repo also still pointed at the upstream author's
infrastructure: container images under `ghcr.io/mathewdunne/coderunner-*`
(kept deliberately by decision 049), the upstream GitHub repo and lessons repo
in links and examples, and the docs site's GitHub Pages URL and Algolia search
index.

The fork now lives at `FRC-Team-4143/scriptum`, and the team hosts its apps
(Legion, Tempus, Munus, Merces, Virtus, Alumni, Colosseum) the same way: each
is a service in the shared `apps-infra` Docker Compose stack, behind Nginx
Proxy Manager on a `*.marswars.org` host, signed in through Legion, deployed by
a GitHub Actions workflow on merge to `main`.

## Decision

Scriptum is hosted like its siblings. The inherited GCP/Cloudflare setup is
removed outright rather than kept as an alternative: `deploy/terraform/`,
`deploy/cloud-init/`, `deploy/cloudflare/` (and its test), `deploy.yml`,
`docker-compose.prod.yml`, and the Google Cloud, Cloudflare, Seasonal Teardown,
and Grafana Cloud docs pages. The app's `/metrics` endpoint and the
`dashboards/` JSON stay; they don't depend on any host.

Upstream defaults now point at this fork: images are
`ghcr.io/frc-team-4143/scriptum-{workspace,control}` (release.yml hardcodes the
lowercase namespace, since image names can't contain the owner's uppercase
letters), links go to `FRC-Team-4143/scriptum` and
`FRC-Team-4143/scriptum-lessons`, and the docs site is configured for
`frc-team-4143.github.io/scriptum` with the upstream Algolia index removed.
This supersedes decision 049's choice to keep the `ghcr.io/mathewdunne`
default.

## Consequences

- There is no remote-hosting automation in this repo until Scriptum's
  `apps-infra` service and deploy workflow are added. Local deployment with
  `docker compose up` is unaffected.
- Scriptum needs far more memory than its siblings (see
  `docs/operating/capacity.md`): a shared host has to be sized for the number
  of students working at once.
- A zero-config `docker compose up` now pulls `ghcr.io/frc-team-4143/...`
  images, which exist only once this fork publishes a release.
- The docs site has no search until a new search index is set up.
- Earlier decision logs that describe the GCP deployment are kept unchanged
  as historical record.
