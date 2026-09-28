variable "do_token" {
  description = "DigitalOcean API token with Droplet/VPC/Firewall/Volume read-write scope. Pass via TF_VAR_do_token, not a checked-in value."
  type        = string
  sensitive   = true
}

variable "region" {
  description = "DigitalOcean region slug. Must be the head's region: a VPC, and so every worker in it, is confined to one region."
  type        = string
  default     = "nyc1"
}

variable "vpc_name" {
  description = "Name of the head droplet's existing VPC, which workers join."
  type        = string
  default     = "default-nyc1"
}

variable "head_droplet_id" {
  description = "Numeric id of the shared MARS/WARS droplet (the head), to attach the data Volume to. On the droplet: curl -s http://169.254.169.254/metadata/v1/id"
  type        = number
}

variable "head_private_ip" {
  description = "The head's private IP in the VPC: the only source allowed into workers, and the NFS server they mount. On the droplet: curl -s http://169.254.169.254/metadata/v1/interfaces/private/0/ipv4/address"
  type        = string

  validation {
    condition     = can(cidrnetmask("${var.head_private_ip}/32"))
    error_message = "head_private_ip must be a single IPv4 address (e.g. 10.116.0.3)."
  }
}

variable "data_volume_size_gb" {
  description = "Size of the Volume holding student data (users/<workspaceId>/{project,home}) and the control plane's database. Resizable later without recreating anything."
  type        = number
  default     = 100
}
