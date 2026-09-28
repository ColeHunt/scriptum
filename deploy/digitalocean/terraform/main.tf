# Static, one-time DigitalOcean infrastructure for the head/worker fleet
# redesign (docs/decisions/048) - NOT YET DEPLOYED. This provisions only the
# pieces that don't change per-session: the worker firewall (in the head's
# existing VPC) and the data Volume attached to the head, which serves it to
# workers over NFS (../setup-head-nfs.sh). Worker droplets themselves are dynamic and created
# directly via the DigitalOcean API by the head's fleet manager
# (apps/control/src/fleet/digitalocean-fleet-provisioner.ts), not by
# Terraform - see decision 048's "Provisioning" design point for why
# apply/destroy per session doesn't fit runtime autoscaling.
#
# The head itself is NOT a resource here either: per decision 048 it lives as
# a new compose service on the existing shared MARS/WARS droplet
# (apps-infra), following that repo's own deploy pattern, not as
# infrastructure of its own.

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }

  # Local state for now: this tree has never been applied. Before a real
  # apply, pick a shared remote backend (for example an S3-compatible
  # DigitalOcean Spaces bucket) so state isn't tied to one laptop.
}

provider "digitalocean" {
  token = var.do_token
}
