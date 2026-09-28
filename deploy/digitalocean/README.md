# deploy/digitalocean/

**Not yet deployed.** Infrastructure-as-code for the head/worker fleet —
see [decision 048](../../docs/decisions/048-head-worker-fleet-deployment.md)
(Status: Proposed). None of this has been run against a real DigitalOcean
account yet.

The **head** is Scriptum's control plane, running as a service in the shared
MARS/WARS `apps-infra` stack on `apps-core` like the other apps. It also serves
student files over NFS. **Workers** are droplets the head creates on demand in
the same VPC to run students' workspace containers, and destroys when idle.

## What lives here

- `terraform/` — the static, one-time resources: the worker firewall (in the
  head's existing `default-nyc1` VPC; only the head's private IP may connect
  to a worker) and the data Volume, attached to the head. Worker droplets
  themselves are **not** Terraform resources — the head creates and destroys
  them at runtime via `DigitalOceanFleetProvisioner`
  (`apps/control/src/fleet/digitalocean-fleet-provisioner.ts`), per decision
  048's "Terraform is too slow/stateful for runtime autoscaling" reasoning.
  The firewall targets the `scriptum-worker` tag, not `droplet_ids`, so it
  covers every worker the head creates.
- `setup-head-nfs.sh` — run once on the head after `terraform apply`: formats
  the Volume if it's blank, mounts it at `/mnt/scriptum-data`, and exports its
  `users/` directory over NFSv4 to the VPC, bound to the head's private IP.
- `worker-user-data.yaml.tmpl` — cloud-init for worker droplets, rendered by
  **application code** (`apps/control/src/fleet/worker-user-data.ts`) once
  per new worker. Deliberately minimal: Docker and the `scriptum-workspace`
  image are already baked into the golden snapshot, so it only mounts the
  head's NFS export.
- `bake-golden-image.sh` — builds that golden snapshot: boots a throwaway
  droplet, installs Docker + the NFS client, pre-pulls the workspace image,
  seals it (unique machine-id/SSH host keys/cloud-init state per clone),
  snapshots it, and destroys the throwaway droplet. Run by hand for now.

## Order of operations (Phase 2)

1. A published `ghcr.io/frc-team-4143/scriptum-workspace` image (tag a
   Scriptum release), public so droplets can pull it.
2. A DigitalOcean API token with Droplet/VPC/Firewall/Volume scope.
3. `terraform apply` (fill in `terraform.tfvars` from the `.example`).
4. `setup-head-nfs.sh` on the head, with the values from `terraform output`.
5. `bake-golden-image.sh` to produce the worker snapshot id.
6. End-to-end test: create one worker, run one workspace container on it with
   the NFS mount, destroy it.

## What's still missing

- A remote Terraform state backend (state is local until one is chosen).
- Wiring `RemoteDockerRuntimeProvider`/`FleetManager`/
  `DigitalOceanFleetProvisioner` into `createApp()` — none of it is called
  from the running app yet (Phase 3).
- Scriptum's `apps-infra` compose service (lives in that repo, not here).
