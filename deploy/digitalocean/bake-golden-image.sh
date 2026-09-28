#!/usr/bin/env bash
# Bakes the worker snapshot (decision 048, design point #8): a throwaway
# droplet installs Docker and the NFS client, pulls the workspace image, and
# powers itself off; it is snapshotted and destroyed. Workers the head creates
# from the snapshot start with the image already on disk.
#
# Everything on the droplet happens through cloud-init, so this needs no SSH
# access to it - it runs the same from GitHub Actions (deploy.yml) and a
# laptop. The droplet only powers off once every step succeeded; if anything
# fails it stays up, this script times out, and the droplet is destroyed
# without a snapshot.
#
#   DO_VPC_UUID=... WORKSPACE_IMAGE=ghcr.io/frc-team-4143/scriptum-workspace:ws-abc \
#   SNAPSHOT_NAME=scriptum-worker-ws-abc bash bake-golden-image.sh
#
# Requires an authenticated `doctl` and a public workspace image. Prints the
# snapshot id as the last line of stdout (`snapshot_id=<id>`). Keeps the
# newest KEEP_SNAPSHOTS worker snapshots and deletes older ones.

set -euo pipefail

: "${DO_VPC_UUID:?Set DO_VPC_UUID - the head's VPC}"
: "${WORKSPACE_IMAGE:?Set WORKSPACE_IMAGE - the workspace image reference to pre-pull}"
: "${SNAPSHOT_NAME:?Set SNAPSHOT_NAME - e.g. scriptum-worker-ws-<key>}"
DO_REGION="${DO_REGION:-nyc1}"
BUILDER_SIZE="${BUILDER_SIZE:-s-2vcpu-4gb}"
BAKE_TIMEOUT_SECONDS="${BAKE_TIMEOUT_SECONDS:-1500}"
KEEP_SNAPSHOTS="${KEEP_SNAPSHOTS:-2}"
# An SSH key on the builder stops DigitalOcean emailing a root password for
# every bake; nothing SSHes in.
: "${DO_SSH_KEY:?Set DO_SSH_KEY - id or fingerprint of an SSH key in the DO account}"
BUILDER_NAME="scriptum-builder-$(date +%s)"

if ! [[ "$WORKSPACE_IMAGE" =~ ^[a-z0-9./_-]+(:[A-Za-z0-9._-]+)?(@sha256:[a-f0-9]{64})?$ ]]; then
  echo "Refusing unexpected WORKSPACE_IMAGE: $WORKSPACE_IMAGE" >&2
  exit 1
fi
if ! [[ "$SNAPSHOT_NAME" =~ ^scriptum-worker-[A-Za-z0-9._-]+$ ]]; then
  echo "SNAPSHOT_NAME must look like scriptum-worker-<key>" >&2
  exit 1
fi

existing="$(doctl compute snapshot list --resource droplet --format ID,Name --no-header \
  | awk -v n="$SNAPSHOT_NAME" '$2==n {print $1; exit}')"
if [ -n "$existing" ]; then
  echo "==> $SNAPSHOT_NAME already exists; nothing to bake" >&2
  echo "snapshot_id=$existing"
  exit 0
fi

user_data="$(mktemp)"
trap 'rm -f "$user_data"' EXIT
cat > "$user_data" <<EOF
#cloud-config
write_files:
  - path: /root/scriptum-bake.sh
    permissions: "0700"
    content: |
      #!/usr/bin/env bash
      set -euo pipefail
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -qq
      apt-get install -y -qq ca-certificates curl nfs-common
      install -m 0755 -d /etc/apt/keyrings
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
      chmod a+r /etc/apt/keyrings/docker.asc
      . /etc/os-release
      echo "deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \$VERSION_CODENAME stable" > /etc/apt/sources.list.d/docker.list
      apt-get update -qq
      apt-get install -y -qq docker-ce docker-ce-cli containerd.io
      systemctl enable --now docker
      docker pull "$WORKSPACE_IMAGE"
      # Seal: every clone gets its own machine-id and SSH host keys.
      apt-get clean
      rm -rf /var/lib/apt/lists/*
      truncate -s 0 /etc/machine-id
      rm -f /var/lib/dbus/machine-id /etc/ssh/ssh_host_* /root/scriptum-bake.sh
      touch /var/lib/scriptum-bake-ok
runcmd:
  - [bash, /root/scriptum-bake.sh]
power_state:
  mode: poweroff
  condition: test -f /var/lib/scriptum-bake-ok
EOF

echo "==> Creating builder droplet $BUILDER_NAME" >&2
builder_id="$(doctl compute droplet create "$BUILDER_NAME" \
  --region "$DO_REGION" --size "$BUILDER_SIZE" --image ubuntu-24-04-x64 \
  --vpc-uuid "$DO_VPC_UUID" --tag-name scriptum-builder --ssh-keys "$DO_SSH_KEY" \
  --user-data-file "$user_data" --wait --format ID --no-header)"
trap 'rm -f "$user_data"; echo "==> Destroying builder $builder_id" >&2; doctl compute droplet delete "$builder_id" --force >&2 || true' EXIT

echo "==> Waiting for the builder to finish and power off (up to ${BAKE_TIMEOUT_SECONDS}s)" >&2
deadline=$((SECONDS + BAKE_TIMEOUT_SECONDS))
while true; do
  status="$(doctl compute droplet get "$builder_id" --format Status --no-header)"
  [ "$status" = "off" ] && break
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "Builder never powered off: a provisioning step failed or ran long. No snapshot taken." >&2
    exit 1
  fi
  sleep 20
done

echo "==> Snapshotting as $SNAPSHOT_NAME" >&2
doctl compute droplet-action snapshot "$builder_id" --snapshot-name "$SNAPSHOT_NAME" --wait >&2
snapshot_id="$(doctl compute snapshot list --resource droplet --format ID,Name --no-header \
  | awk -v n="$SNAPSHOT_NAME" '$2==n {print $1; exit}')"
if [ -z "$snapshot_id" ]; then
  echo "Snapshot $SNAPSHOT_NAME not found after creation." >&2
  exit 1
fi

echo "==> Pruning old worker snapshots (keeping $KEEP_SNAPSHOTS)" >&2
doctl compute snapshot list --resource droplet --format ID,Name,CreatedAt --no-header \
  | awk '$2 ~ /^scriptum-worker-/' | sort -k3 -r | tail -n +"$((KEEP_SNAPSHOTS + 1))" \
  | while read -r old_id old_name _; do
      echo "    deleting $old_name ($old_id)" >&2
      doctl compute snapshot delete "$old_id" --force >&2 || true
    done

echo "snapshot_id=$snapshot_id"
