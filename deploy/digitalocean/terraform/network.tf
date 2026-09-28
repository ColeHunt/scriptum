# Workers join the shared MARS/WARS droplet's existing VPC (decision 048,
# design point #6). That droplet is the head, so the head, its NFS export, and
# every worker talk over private addresses only.
data "digitalocean_vpc" "shared" {
  name = var.vpc_name
}

# Applied by tag, not droplet_ids, so it automatically covers every worker
# the head creates dynamically after this Terraform run -
# DigitalOceanFleetProvisioner.createWorker() always tags new droplets
# "scriptum-worker" (apps/control/src/fleet/digitalocean-fleet-provisioner.ts).
resource "digitalocean_tag" "scriptum_worker" {
  name = "scriptum-worker"
}

resource "digitalocean_firewall" "workers" {
  name = "scriptum-worker-firewall"
  tags = [digitalocean_tag.scriptum_worker.name]

  # Everything inbound comes from the head's private IP: SSH for Docker over
  # SSH (decision 048, design point #2), plus the ports of workspace
  # containers the head proxies editor/simulator traffic to. Nothing on the
  # public internet can reach a worker.
  inbound_rule {
    protocol         = "tcp"
    port_range       = "1-65535"
    source_addresses = ["${var.head_private_ip}/32"]
  }

  # Image pulls from GHCR, Gradle/Maven downloads during student builds, and
  # NFS to the head.
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
