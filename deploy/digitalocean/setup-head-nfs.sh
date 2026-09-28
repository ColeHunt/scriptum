#!/usr/bin/env bash
# Makes the head (the shared MARS/WARS droplet) the fleet's NFS server
# (decision 048, design point #5): mounts the data Volume Terraform attached
# (terraform/data-volume.tf) and exports its users/ directory over NFSv4 to
# workers in the VPC.
#
# Run once on the head as root, after `terraform apply`:
#
#   VOLUME_NAME=scriptum-data VPC_CIDR=10.116.0.0/20 BIND_IP=10.116.0.3 \
#     bash setup-head-nfs.sh
#
# (Terraform's outputs give all three values.) Safe to re-run: it only formats
# the Volume if it has no filesystem yet, and skips config that's already in
# place.
#
# The export is reachable from the VPC only: nfsd binds to the head's private
# address, and NFSv3 (and with it rpcbind/mountd/statd) is disabled, so port
# 2049 is the only NFS port and it isn't on the public interface.
#
# NOT YET RUN AGAINST THE REAL HEAD.

set -euo pipefail

: "${VOLUME_NAME:?Set VOLUME_NAME - terraform output data_volume_name}"
: "${VPC_CIDR:?Set VPC_CIDR - terraform output vpc_ip_range}"
: "${BIND_IP:?Set BIND_IP - terraform output nfs_server_ip, the head private IP}"
MOUNT_POINT="${MOUNT_POINT:-/mnt/scriptum-data}"
SCRIPTUM_UID="${SCRIPTUM_UID:-1000}"
SCRIPTUM_GID="${SCRIPTUM_GID:-1000}"
VOLUME_DEV="/dev/disk/by-id/scsi-0DO_Volume_${VOLUME_NAME}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root." >&2
  exit 1
fi
if [ ! -b "$VOLUME_DEV" ]; then
  echo "No block device at $VOLUME_DEV - is the Volume attached (terraform apply)?" >&2
  exit 1
fi
if ! ip -4 -o addr show | grep -q " ${BIND_IP}/"; then
  echo "BIND_IP $BIND_IP is not an address on this machine." >&2
  exit 1
fi

echo "==> Installing nfs-kernel-server"
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nfs-kernel-server >/dev/null

echo "==> Volume $VOLUME_DEV -> $MOUNT_POINT"
if ! blkid "$VOLUME_DEV" >/dev/null 2>&1; then
  echo "    no filesystem yet, formatting ext4"
  mkfs.ext4 -q "$VOLUME_DEV"
fi
mkdir -p "$MOUNT_POINT"
if ! grep -q " $MOUNT_POINT " /etc/fstab; then
  echo "$VOLUME_DEV $MOUNT_POINT ext4 defaults,nofail,discard 0 2" >> /etc/fstab
fi
mountpoint -q "$MOUNT_POINT" || mount "$MOUNT_POINT"
mkdir -p "$MOUNT_POINT/users"
chown "$SCRIPTUM_UID:$SCRIPTUM_GID" "$MOUNT_POINT" "$MOUNT_POINT/users"

echo "==> NFSv4 only, bound to $BIND_IP"
cat > /etc/nfs.conf.d/scriptum.conf <<EOF
[nfsd]
host=$BIND_IP
vers3=n
EOF
systemctl mask --now rpcbind.service rpcbind.socket >/dev/null 2>&1 || true

echo "==> Exporting $MOUNT_POINT/users to $VPC_CIDR"
EXPORT_LINE="$MOUNT_POINT/users $VPC_CIDR(rw,sync,no_subtree_check,no_root_squash)"
if ! grep -qF "$MOUNT_POINT/users " /etc/exports; then
  echo "$EXPORT_LINE" >> /etc/exports
fi
systemctl enable nfs-kernel-server >/dev/null
systemctl restart nfs-kernel-server
exportfs -ra

echo "==> Check"
exportfs -v
ss -tln | grep ':2049 ' || { echo "nfsd is not listening on 2049" >&2; exit 1; }
if ss -tln | grep ':2049 ' | grep -qv "$BIND_IP:2049"; then
  echo "WARNING: nfsd is listening on an address other than $BIND_IP" >&2
fi
echo "Done. Point SCRIPTUM_HOST_DATA_DIR at $MOUNT_POINT for the head's control container."
