# Student data (decision 048, design point #5): a DigitalOcean Volume attached
# to the head, which serves its users/ directory to workers over NFSv4 (see
# ../setup-head-nfs.sh). The Volume outlives any droplet and can be resized
# without recreating anything. Attaching is a hot-plug; the head keeps
# running.
#
# NFS uid/gid consistency: the head's control container and every worker's
# workspace containers use the same uid (SCRIPTUM_UID, 1000 by default), so
# ownership set by ensureWorkspaceFiles() (storage.ts) round-trips without
# NFSv4 idmapping getting involved. Verify against the real golden image in
# Phase 2.

resource "digitalocean_volume" "data" {
  name   = "scriptum-data"
  region = var.region
  size   = var.data_volume_size_gb
  # No initial_filesystem_type: setup-head-nfs.sh formats it only if it has no
  # filesystem yet, so re-running the script never touches live data.
}

resource "digitalocean_volume_attachment" "data" {
  droplet_id = var.head_droplet_id
  volume_id  = digitalocean_volume.data.id
}
