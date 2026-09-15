# The NFS storage node (decision 048, design point #5): one small always-on
# droplet, backed by a DigitalOcean Volume so student data outlives the
# droplet itself. Long-lived and Terraform-managed, unlike worker droplets.
#
# NFS uid/gid consistency: every worker mounts this export using the same
# local uid the golden image bakes in (matches docker-compose.yml's existing
# CODERUNNER_UID/CODERUNNER_GID convention - "bun"/1000:1000 by default), so
# ownership set by ensureWorkspaceFiles() (storage.ts) round-trips correctly
# without NFSv4 idmapping getting involved. Verify this against the real
# golden image's actual uid once Phase 2 testing is possible - not verifiable
# without real droplets.

resource "digitalocean_volume" "data" {
  name   = "coderunner-fleet-data"
  region = var.region
  size   = var.storage_volume_size_gb
  # No initial_filesystem_type: formatted by cloud-init instead - see the
  # mkfs guard in storage-node-user-data.yaml.tftpl, which skips reformatting
  # on reboot (unlike Terraform-driven formatting, which only ever runs once
  # at volume creation and can't express "skip if already formatted").
}

resource "digitalocean_droplet" "storage" {
  name     = "coderunner-storage"
  region   = var.region
  size     = var.storage_node_size
  image    = "ubuntu-24-04-x64"
  vpc_uuid = digitalocean_vpc.fleet.id
  ssh_keys = var.ssh_key_fingerprints
  ipv6     = false
  tags     = ["coderunner-storage"]

  user_data = templatefile("${path.module}/../storage-node-user-data.yaml.tftpl", {
    volume_name        = digitalocean_volume.data.name
    mount_point        = "/mnt/coderunner-data"
    worker_subnet_cidr = var.worker_subnet_cidr
  })
}

resource "digitalocean_volume_attachment" "data" {
  droplet_id = digitalocean_droplet.storage.id
  volume_id  = digitalocean_volume.data.id
}
