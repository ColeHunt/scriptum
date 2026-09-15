variable "do_token" {
  description = "DigitalOcean API token with Droplet/VPC/Firewall/Volume read-write scope. Pass via TF_VAR_do_token, not a checked-in value."
  type        = string
  sensitive   = true
}

variable "region" {
  description = "DigitalOcean region slug for all fleet resources (e.g. nyc3, sfo3). Should match the region the shared MARS/WARS droplet is already in, so the head isn't cross-region from its workers."
  type        = string
}

variable "ssh_key_fingerprints" {
  description = "Fingerprints of SSH keys already added to the DigitalOcean account, installed on the storage node (for operator access) and passed to every worker droplet the head creates (see digitalocean-fleet-provisioner.ts's sshKeyIds)."
  type        = list(string)

  validation {
    condition     = length(var.ssh_key_fingerprints) > 0
    error_message = "At least one SSH key fingerprint is required - a storage node or worker with no key installed would be unreachable."
  }
}

variable "storage_node_size" {
  description = "Droplet size slug for the NFS storage node. This is a lightweight always-on box (just serves NFS), not a compute-heavy one."
  type        = string
  default     = "s-1vcpu-2gb"
}

variable "storage_volume_size_gb" {
  description = "Size of the DigitalOcean Volume backing the NFS export (student data/users/<workspaceId>/{project,home}). Resizable later without recreating the storage node."
  type        = number
  default     = 100
}

variable "worker_subnet_cidr" {
  description = "CIDR for the private VPC workers and the storage node share."
  type        = string
  default     = "10.10.0.0/20"
}

# The head is NOT a resource in this Terraform tree - per decision 048 it
# lives as a new compose service on the pre-existing shared MARS/WARS
# droplet (apps-infra), which was created long before this VPC existed and
# cannot be moved into it after the fact (DigitalOcean droplets can't change
# VPC post-creation without recreating them - not something to do to a box
# already running four other production apps). So firewall rules that need
# to admit the head target its public IP specifically, the same
# break-glass-CIDR pattern deploy/terraform/variables.tf already uses for
# GCE SSH, rather than VPC membership.
variable "head_public_ip_cidr" {
  description = "The shared MARS/WARS droplet's public IP, as a /32 CIDR (e.g. 104.248.113.170/32) - the only source allowed to reach worker SSH and the storage node's NFS export/SSH."
  type        = string

  validation {
    condition     = can(cidrnetmask(var.head_public_ip_cidr))
    error_message = "head_public_ip_cidr must be a valid CIDR (e.g. 104.248.113.170/32)."
  }
}
