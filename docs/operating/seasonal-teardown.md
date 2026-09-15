---
sidebar_position: 5
title: Seasonal Teardown
---

# Seasonal Teardown

This page covers how to take the Google Cloud VM deployment down to near-zero
cost over the off-season (for example, summer break) and how to bring it back
in the fall. This is the "we are done meeting for the year" procedure; it is
distinct from a throwaway `terraform destroy`.

The guiding principle is that **the boot disk is disposable and the data disk
is precious.** The boot disk is just Ubuntu plus cloud-init plus a Docker image
pull, fully rebuilt by `terraform apply`. The data disk holds the SQLite
database and every student's project files; it must be captured in a manual
snapshot before deletion.

:::note[Local deployments]

This procedure is for the Google Cloud VM. For a local classroom machine,
simply stop the stack (`docker compose stop`) and optionally archive student
work with `docker compose exec control coderunner backup`.

:::

## Why stopping the VM is not enough

A `TERMINATED` VM still bills for attached disks and reserved addresses:

| Resource | Billed while stopped? | Rough cost |
|---|---|---|
| Boot disk (50 GB hyperdisk-balanced) | Yes | ~$5/mo |
| Data disk (50 GB hyperdisk-balanced) | Yes | ~$5/mo |
| Reserved static IP (`google_compute_address.coderunner`) | Yes; reserved IPv4 bills even when unattached | ~$3/mo |
| Daily auto-snapshots (7-day retention) | Yes, tiny | &lt;$1/mo |
| VM compute, network, subnet, firewall, IAM, secrets | No / ~$0 | n/a |

Leaving the VM stopped costs roughly **$13/mo**. Full teardown reduces that to
under **~$1/mo**, just the manual snapshot billed on used data.

To stop paying for the boot disk you must delete the VM. The boot disk is
created inside `initialize_params` in `vm.tf`, so it cannot exist without the
instance.

## Teardown

Use `gcloud`, not `terraform destroy`. The data disk has `prevent_destroy = true`
in `disk.tf`; that is a deliberate guard against destroying student data.
It only blocks Terraform; `gcloud` commands are not affected.

### Step 1. Take a manual snapshot of the data disk

The daily auto-snapshots have 7-day retention (`max_retention_days = 7`) and
will expire long before fall. Do not rely on them. Take a manual snapshot now;
manual snapshots never auto-expire:

```bash
gcloud compute snapshots create coderunner-data-eoy2026 \
  --source-disk=coderunner-data \
  --source-disk-zone=northamerica-northeast2-a \
  --storage-location=northamerica-northeast2
```

The boot disk does not need a snapshot. It is rebuilt from scratch by
`terraform apply`.

### Step 2. Verify the snapshot is READY before deleting anything

```bash
gcloud compute snapshots describe coderunner-data-eoy2026 \
  --format="value(status,diskSizeGb)"
```

The output must show `READY` and the disk size in GB. **Do not proceed until
this says `READY`.**

### Step 3. Delete the VM (this also deletes the boot disk)

The attached data disk survives because additional attached disks default to
`auto_delete = false` and `vm.tf` does not override that.

```bash
gcloud compute instances delete coderunner --zone=northamerica-northeast2-a
```

### Step 4. Delete the data disk (now safely captured in the snapshot)

```bash
gcloud compute disks delete coderunner-data --zone=northamerica-northeast2-a
```

### Step 5. Decide on the static IP

A reserved static IPv4 costs roughly $3/mo even when nothing is attached.

**Keep it**: do nothing. The DNS A record stays valid and fall startup needs
no DNS change.

**Release it**: saves that cost, but you get a new IP in the fall and must
update the DNS A record (`coderunner.wiredcats5885.ca` → new IP) and wait for
propagation before TLS and Legion sign-in work.

```bash
# Only if you choose to release the IP
gcloud compute addresses delete coderunner --region=northamerica-northeast2
```

### What remains after teardown (~$0)

- The manual snapshot, billed on used data only (roughly 7 GB → cents/mo).
- Secret Manager (pennies), network, subnet, firewall, IAM, and
  Cloudflare Pages, all free or negligible. The snapshot resource policy stays
  but does nothing with no disk attached.

**Terraform state note.** Deleting via `gcloud` leaves Terraform state showing
a VM and data disk that no longer exist. That is fine; the fall `terraform apply`
reconciles by recreating them. If you prefer truthful state in the meantime:

```bash
terraform state rm google_compute_instance.coderunner google_compute_disk.data
```

This is not required.

---

## Restore in the fall

Most of the restore is a single `terraform apply` because the snapshot-seeding
path is already wired into `disk.tf`.

### Step 1. Point the data disk at your snapshot

In `deploy/terraform/disk.tf`, add the `snapshot` argument to
`google_compute_disk.data`:

```hcl
resource "google_compute_disk" "data" {
  name     = "coderunner-data"
  type     = var.data_disk_type
  zone     = var.zone
  size     = var.data_disk_size_gb
  snapshot = "coderunner-data-eoy2026"   # seed from the off-season snapshot

  # provisioned_iops / provisioned_throughput / lifecycle stay as-is.
  # lifecycle.ignore_changes = [snapshot] already absorbs post-restore drift.
}
```

### Step 2. Apply

```bash
cd deploy/terraform
terraform apply
```

This recreates everything:

- **Data disk**: created from the snapshot, restoring the DB and all student
  projects, at the baseline 3000 IOPS / 140 MiB/s pinned in the config.
- **VM and boot disk**: rebuilt from the Ubuntu image; cloud-init
  re-bootstraps, pulls the workspace image from GHCR, and re-renders `.env`
  from Secret Manager.
- **Static IP**: re-attached if kept, or freshly allocated if released.

### Step 3. If you released the static IP

Update the DNS A record `coderunner.wiredcats5885.ca` to the new IP
(`terraform output -raw static_ip`) and wait for propagation before relying on
TLS or Legion sign-in.

### Step 4. Deploy a release

A freshly rebuilt VM has an empty `apps/web/dist` until the first deploy:
`/` returns 404, though `/healthz` works. Run a deploy from `main` against your
latest release tag:

```bash
gh workflow run "Deploy" --ref main -f tag=vX.Y.Z
```

### Step 5. Verify, then clean up

- Confirm `https://coderunner.wiredcats5885.ca/healthz` returns 200 with a
  valid TLS certificate.
- Sign in, confirm a student workspace and the lesson catalog load, and run a
  simulation end-to-end with telemetry flowing.
- Once verified, remove the `snapshot =` line from `disk.tf`. The
  `ignore_changes = [snapshot]` directive already suppresses a forced-replace,
  so removing the line is safe and prevents a stale reference:

  ```bash
  gcloud compute snapshots delete coderunner-data-eoy2026
  ```

---

## Summary

1. Take a manual snapshot of `coderunner-data` (auto-snapshots expire in
   7 days; do not rely on them).
2. Verify snapshot is `READY`, then delete the VM (takes the boot disk with
   it), then delete the data disk.
3. Keep or release the static IP (a DNS update trade-off).
4. In the fall: add `snapshot =` to `disk.tf`, run `terraform apply`, deploy a
   release tag, verify end-to-end, then remove the snapshot line and delete the
   snapshot.
