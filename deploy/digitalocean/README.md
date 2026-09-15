# deploy/digitalocean/

**Not yet deployed.** Infrastructure-as-code for the head/worker fleet
redesign — see [decision 048](../../docs/decisions/048-head-worker-fleet-deployment.md)
(Status: Proposed). None of this has been run against a real DigitalOcean
account; it exists so implementation can proceed the moment that account is
available, per decision 048's phased roadmap.

## What lives here

- `terraform/` — the static, one-time DigitalOcean resources: a private VPC,
  firewall rules (worker SSH and storage-node NFS/SSH, both restricted to
  the head's own public IP — see `variables.tf`'s `head_public_ip_cidr`
  comment for why that's an IP allowlist rather than VPC membership), and the
  NFS storage node (droplet + attached Volume). Worker droplets themselves
  are **not** Terraform resources — they're created and destroyed at runtime
  by the head via `DigitalOceanFleetProvisioner`
  (`apps/control/src/fleet/digitalocean-fleet-provisioner.ts`), matching
  decision 048's "Terraform is too slow/stateful for runtime autoscaling"
  reasoning. The worker firewall rule targets the `coderunner-worker` tag,
  not `droplet_ids`, so it automatically covers every worker the head
  creates after `terraform apply` runs once.
- `storage-node-user-data.yaml.tftpl` — cloud-init for the storage node,
  rendered once by Terraform (`storage.tf`'s `templatefile()` call): installs
  `nfs-kernel-server`, formats/mounts the attached Volume, exports it over
  NFSv4 to the worker subnet.
- `worker-user-data.yaml.tmpl` — cloud-init for worker droplets. Despite the
  similar name, this is rendered by **application code**
  (`apps/control/src/fleet/worker-user-data.ts`), not Terraform — it runs
  once per newly created worker (dynamic, at fleet-scaling time), not once
  ever like the storage node's. Deliberately minimal: Docker and the
  `coderunner-workspace` image are already baked into the golden snapshot a
  worker boots from, so this only needs to mount the shared NFS export.
- `bake-golden-image.sh` — builds that golden snapshot: boots a throwaway
  droplet from a stock Ubuntu image, installs Docker + the NFS client,
  pre-pulls the workspace image, seals it (unique machine-id/SSH host
  keys/cloud-init state per clone), snapshots it, and destroys the throwaway
  droplet. Run by hand for now; decision 048 proposes appending this as a
  step to `.github/workflows/release.yml` once real DO infrastructure
  exists, so the golden image stays current with each release.

## What's still missing before this can actually be deployed

- A real DigitalOcean account, API token, and SSH key.
- Running `bake-golden-image.sh` at least once to produce a real snapshot id.
- `terraform apply` against a throwaway DO project first (not the shared
  droplet), per decision 048's Phase 2.
- Wiring `RemoteDockerRuntimeProvider`/`FleetManager`/
  `DigitalOceanFleetProvisioner` into `createApp()` — none of this is called
  from the running app yet (Phase 3).
- Adding `coderunner-head` as a new compose service on the shared MARS/WARS
  droplet (`/prj/frc/apps/apps-infra`), following that repo's existing
  per-app pattern — not part of this directory, since the head isn't
  DigitalOcean-provisioned infrastructure of its own.
