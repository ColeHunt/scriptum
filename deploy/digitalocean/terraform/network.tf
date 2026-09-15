# Private VPC for workers and the storage node (decision 048, design point
# #6). The head is deliberately NOT a member - see the head_public_ip_cidr
# comment in variables.tf.

resource "digitalocean_vpc" "fleet" {
  name     = "coderunner-fleet"
  region   = var.region
  ip_range = var.worker_subnet_cidr
}

# Applied by tag, not droplet_ids, so it automatically covers every worker
# the head creates dynamically after this Terraform run -
# DigitalOceanFleetProvisioner.createWorker() always tags new droplets
# "coderunner-worker" (apps/control/src/fleet/digitalocean-fleet-provisioner.ts).
resource "digitalocean_tag" "coderunner_worker" {
  name = "coderunner-worker"
}

resource "digitalocean_firewall" "workers" {
  name = "coderunner-worker-firewall"
  tags = [digitalocean_tag.coderunner_worker.name]

  # SSH from the head only - this is how the head runs Docker CLI commands
  # against each worker's daemon (decision 048, design point #2).
  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = [var.head_public_ip_cidr]
  }

  # Pull the workspace image from GHCR, reach the storage node's NFS export
  # over the private VPC - no other inbound/outbound is needed.
  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

resource "digitalocean_firewall" "storage_node" {
  name        = "coderunner-storage-firewall"
  droplet_ids = [digitalocean_droplet.storage.id]

  # NFSv4 only (a single port - no portmapper/mountd/statd to open), from
  # workers on the private VPC.
  inbound_rule {
    protocol         = "tcp"
    port_range       = "2049"
    source_addresses = [var.worker_subnet_cidr]
  }
  # Operator/admin SSH from the head only.
  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = [var.head_public_ip_cidr]
  }

  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}
