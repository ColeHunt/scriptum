output "vpc_uuid" {
  description = "Pass as DigitalOceanFleetProvisionerOptions.vpcUuid on the head."
  value       = data.digitalocean_vpc.shared.id
}

output "vpc_ip_range" {
  description = "Pass to setup-head-nfs.sh as the CIDR allowed to mount the NFS export."
  value       = data.digitalocean_vpc.shared.ip_range
}

output "nfs_server_ip" {
  description = "The head's private IP: the worker cloud-init template's $${nfs_server_ip} and setup-head-nfs.sh's bind address."
  value       = var.head_private_ip
}

output "data_volume_name" {
  description = "Pass to setup-head-nfs.sh; the Volume appears on the head at /dev/disk/by-id/scsi-0DO_Volume_<name>."
  value       = digitalocean_volume.data.name
}

output "worker_tag" {
  description = "Tag every worker droplet must carry to be covered by the worker firewall - DigitalOceanFleetProvisioner already applies this automatically."
  value       = digitalocean_tag.scriptum_worker.name
}
