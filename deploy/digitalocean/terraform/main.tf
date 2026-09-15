# Static, one-time DigitalOcean infrastructure for the head/worker fleet
# redesign (docs/decisions/048) - NOT YET DEPLOYED. This provisions only the
# pieces that don't change per-session: the private VPC, firewall rules, and
# the NFS storage node. Worker droplets themselves are dynamic and created
# directly via the DigitalOcean API by the head's fleet manager
# (apps/control/src/fleet/digitalocean-fleet-provisioner.ts), not by
# Terraform - see decision 048's "Provisioning" design point for why
# apply/destroy per session doesn't fit runtime autoscaling.
#
# The head itself is NOT a resource here either: per decision 048 it lives as
# a new compose service on the existing shared MARS/WARS droplet
# (/prj/frc/apps/apps-infra), following that repo's own deploy pattern, not
# as GCE/DO infrastructure of its own.

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }

  # Reuses the same GCS state bucket as deploy/terraform/ (the GCE
  # deployment) under a different prefix, rather than standing up a second
  # state backend for one more cloud:
  #   terraform init -backend-config="bucket=$PROJECT_ID-tf-state"
  backend "gcs" {
    prefix = "do-fleet"
  }
}

provider "digitalocean" {
  token = var.do_token
}
