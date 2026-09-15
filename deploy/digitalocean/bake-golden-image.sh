#!/usr/bin/env bash
# Bakes the golden worker snapshot (decision 048, design point #8): boots a
# throwaway droplet from a stock Ubuntu image, installs Docker + the NFS
# client and pre-pulls the coderunner-workspace image, seals it (clears
# machine-id/SSH host keys/cloud-init state so every droplet cloned from the
# resulting snapshot gets its own unique identity), snapshots it, and
# destroys the throwaway droplet. Prints the resulting snapshot id - set that
# as DigitalOceanFleetProvisionerOptions.imageId on the head.
#
# Run this once to produce the first golden image, and again whenever
# CODERUNNER_TAG changes (re-run it as a step appended to
# .github/workflows/release.yml once real DO infrastructure exists - not
# wired up yet, this script is meant to be run by hand for now).
#
# NOT YET RUN AGAINST A REAL DIGITALOCEAN ACCOUNT. Requires `doctl`
# authenticated (`doctl auth init`) and an SSH key already added to the
# account (DO_SSH_KEY_FINGERPRINT below).

set -euo pipefail

: "${DO_REGION:?Set DO_REGION (e.g. nyc3) - match deploy/digitalocean/terraform's var.region}"
: "${DO_SSH_KEY_FINGERPRINT:?Set DO_SSH_KEY_FINGERPRINT - fingerprint of a key already in your DO account}"
: "${DO_VPC_UUID:?Set DO_VPC_UUID - output of terraform apply in deploy/digitalocean/terraform}"
CODERUNNER_IMAGE_NS="${CODERUNNER_IMAGE_NS:-ghcr.io/mathewdunne}"
CODERUNNER_TAG="${CODERUNNER_TAG:-latest}"
BUILDER_SIZE="${BUILDER_SIZE:-s-2vcpu-4gb}"
BUILDER_NAME="coderunner-golden-image-builder-$(date +%s)"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)

echo "==> Creating throwaway builder droplet ($BUILDER_NAME)"
doctl compute droplet create "$BUILDER_NAME" \
  --region "$DO_REGION" \
  --size "$BUILDER_SIZE" \
  --image ubuntu-24-04-x64 \
  --vpc-uuid "$DO_VPC_UUID" \
  --ssh-keys "$DO_SSH_KEY_FINGERPRINT" \
  --wait \
  --format ID --no-header > /tmp/coderunner-builder-id

BUILDER_ID="$(cat /tmp/coderunner-builder-id)"
trap 'echo "==> Cleaning up builder droplet $BUILDER_ID"; doctl compute droplet delete "$BUILDER_ID" --force || true' EXIT

BUILDER_IP="$(doctl compute droplet get "$BUILDER_ID" --format PublicIPv4 --no-header)"
echo "==> Builder droplet at $BUILDER_IP - waiting for SSH"
for _ in $(seq 1 30); do
  if ssh "${SSH_OPTS[@]}" "root@$BUILDER_IP" true 2>/dev/null; then
    break
  fi
  sleep 5
done

echo "==> Provisioning: Docker Engine + NFS client + pre-pulled workspace image"
# Mirrors deploy/cloud-init/user-data.yaml's bootstrap.sh Docker install step
# (Docker's official apt repo), plus nfs-common for the worker mount and a
# pull of the workspace image so a fresh worker never waits on a
# multi-gigabyte GHCR download.
ssh "${SSH_OPTS[@]}" "root@$BUILDER_IP" bash -s <<EOF
set -euo pipefail
apt-get update
apt-get install -y ca-certificates curl gnupg nfs-common

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \$(. /etc/os-release && echo \"\$VERSION_CODENAME\") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker

docker pull "$CODERUNNER_IMAGE_NS/coderunner-workspace:$CODERUNNER_TAG"
EOF

echo "==> Sealing the image (unique machine-id/host keys/cloud-init state per clone)"
ssh "${SSH_OPTS[@]}" "root@$BUILDER_IP" bash -s <<'EOF'
set -euo pipefail
cloud-init clean --logs --seed
truncate -s 0 /etc/machine-id
rm -f /var/lib/dbus/machine-id
rm -f /etc/ssh/ssh_host_*_key /etc/ssh/ssh_host_*_key.pub
apt-get clean
rm -rf /var/lib/apt/lists/*
history -c || true
EOF

echo "==> Powering off before snapshotting"
doctl compute droplet-action power-off "$BUILDER_ID" --wait

SNAPSHOT_NAME="coderunner-worker-golden-$(date +%Y%m%d-%H%M%S)"
echo "==> Taking snapshot: $SNAPSHOT_NAME"
doctl compute droplet-action snapshot "$BUILDER_ID" --snapshot-name "$SNAPSHOT_NAME" --wait

SNAPSHOT_ID="$(doctl compute snapshot list --format ID,Name --no-header | awk -v n="$SNAPSHOT_NAME" '$2==n {print $1}')"
echo "==> Golden image ready: $SNAPSHOT_NAME (id $SNAPSHOT_ID)"
echo "Set this as DigitalOceanFleetProvisionerOptions.imageId on the head."

# The trap above destroys $BUILDER_ID on exit - the snapshot survives independently.
