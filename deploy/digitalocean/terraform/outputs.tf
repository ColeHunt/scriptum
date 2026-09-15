output "vpc_uuid" {
  description = "Pass as DigitalOceanFleetProvisionerOptions.vpcUuid on the head."
  value       = digitalocean_vpc.fleet.id
}

output "storage_node_private_ip" {
  description = "NFS server address for the worker cloud-init template's $${storage_private_ip} placeholder (see worker-user-data.yaml.tmpl)."
  value       = digitalocean_droplet.storage.ipv4_address_private
}

output "storage_node_public_ip" {
  description = "For operator SSH from the head (allowed by the storage firewall's head_public_ip_cidr rule)."
  value       = digitalocean_droplet.storage.ipv4_address
}

output "worker_tag" {
  description = "Tag every worker droplet must carry to be covered by the worker firewall - DigitalOceanFleetProvisioner already applies this automatically."
  value       = digitalocean_tag.coderunner_worker.name
}
