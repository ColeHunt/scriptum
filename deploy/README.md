# deploy/

Terraform, cloud-init, and Cloudflare deployment assets for the GCE-based production deployment.

Full instructions live in the docs site:

- [Deploying to Google Cloud](../docs/deploying/gcloud.md) — one-VM GCE setup with Terraform, Caddy, and Workload Identity Federation.
- [Cloudflare Pages](../docs/deploying/cloudflare.md) — optional CDN layer for the web shell with graceful offline handling.
- [Seasonal Teardown & Restore](../docs/operating/seasonal-teardown.md) — snapshot-based off-season teardown to near-zero cost and fall restore.

## Subdirectories

- `terraform/` — Infrastructure as code: VM, persistent disk, IAM, secrets, network, outputs.
- `cloud-init/` — First-boot provisioning script (`user-data.yaml`): installs Docker + the compose plugin, fetches the compose files, and renders `/opt/coderunner/.env` and the Alloy config from Secret Manager. The control plane, Caddy, and Alloy run as compose services (`docker-compose.yml` + `docker-compose.prod.yml`); see [decision 031](../docs/decisions/031-containerized-control-plane.md).
- `cloudflare/` — Cloudflare Pages config and catch-all Pages Function for backend proxying.
- `digitalocean/` — **Not yet deployed.** Infrastructure-as-code for a proposed replacement of this whole GCE deployment: a small head co-located on the shared MARS/WARS droplet, fleet-managing dynamically scaled DigitalOcean worker droplets. See [decision 048](../docs/decisions/048-head-worker-fleet-deployment.md) and [`digitalocean/README.md`](digitalocean/README.md).
