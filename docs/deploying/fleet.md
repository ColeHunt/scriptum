---
sidebar_position: 5
title: Worker Fleet (DigitalOcean)
---

# Worker Fleet (DigitalOcean)

In fleet mode the control plane (the **head**) runs on the shared MARS/WARS
droplet like the team's other apps, and every student's workspace container
runs on a **worker** droplet. The head creates workers when students need
them and destroys them once they have been empty for a while, so nothing is
spent on compute when nobody is using Scriptum. Design: decision 048.

## How it behaves

- The first student to open a workspace when no worker has room waits about
  one to two minutes while a worker boots. The editor shows "starting"
  meanwhile; everyone after that lands on the running worker immediately.
- Each worker takes `SCRIPTUM_WORKER_MEMORY_MB ÷ CODE_MEMORY_LIMIT` students
  (8 GB ÷ 3 GB = 2). Workers are filled before a new one is created.
- A workspace idle for `IDLE_STOP_MINUTES` is stopped and gives up its slot.
  A worker with no workspaces for `SCRIPTUM_WORKER_IDLE_MINUTES` is destroyed.
- Past `SCRIPTUM_MAX_WORKERS` workers, students get the usual "Server at
  capacity" message; the head never creates more.
- Student files live on a Volume attached to the head, shared with workers
  over NFS, so destroying a worker never loses work.
- The head also destroys any `scriptum-worker`-tagged droplet it has no
  record of (older than 15 minutes), and drops records of workers deleted
  from the DigitalOcean console.

## One-time setup

1. **Release.** Tag a Scriptum release so `scriptum-control` and
   `scriptum-workspace` are published, then make both GHCR packages public.
2. **Static resources** (`deploy/digitalocean/terraform`): the worker
   firewall (only the head's private IP may connect) and the data Volume
   attached to the head.
3. **NFS** on the head: `setup-head-nfs.sh` mounts the Volume at
   `/mnt/scriptum-data` and exports `/mnt/scriptum-data/users` to the VPC.
4. **Worker image**: `bake-golden-image.sh` → a snapshot id.
5. **Head SSH key**: generate an ed25519 key for the head, add its public key
   to the DigitalOcean account (its id goes in `SCRIPTUM_WORKER_SSH_KEYS`),
   and install the private key plus `head-ssh.conf` in the head's container
   (see apps-infra).
6. **Head service**: the `scriptum` service in apps-infra, with the settings
   below, and an NPM proxy host for `scriptum.marswars.org` → `scriptum:4000`
   with websockets on.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `SCRIPTUM_FLEET` | off | `1` turns fleet mode on. |
| `SCRIPTUM_DO_TOKEN` | required | DigitalOcean token scoped to create/delete droplets and read tags, images, VPCs and SSH keys. |
| `SCRIPTUM_WORKER_IMAGE` | required | Golden snapshot id. |
| `SCRIPTUM_WORKER_VPC_UUID` | required | The head's VPC. |
| `SCRIPTUM_WORKER_SSH_KEYS` | required | Comma-separated DO SSH key ids/fingerprints (the head's key). |
| `SCRIPTUM_NFS_SERVER_IP` | required | The head's private IP. |
| `FRC_HOST_DATA_DIR` | required | Host path of the head's data mount (`/mnt/scriptum-data`). |
| `FRC_CONTAINER_USER` | required | `uid:gid` owning that mount (`1000:1000`). |
| `SCRIPTUM_WORKER_SIZE` | `s-4vcpu-8gb` | Droplet size for workers. |
| `SCRIPTUM_WORKER_MEMORY_MB` | `8192` | Must match the size's RAM. |
| `SCRIPTUM_WORKER_REGION` | `nyc1` | Must be the head's region. |
| `SCRIPTUM_MAX_WORKERS` | `3` | Hard ceiling on workers, booting ones included. |
| `SCRIPTUM_WORKER_IDLE_MINUTES` | `20` | How long a worker may sit empty before it is destroyed. |
| `SCRIPTUM_WORKER_SSH_USER` | `root` | SSH user on workers. |
| `SCRIPTUM_WORKER_BLOCK_DEVICES` | `/dev/vda` | Worker disks for `CODE_DISK_READ_LIMIT`. |

Set `CODE_MEMORY_LIMIT=3072m` for 8 GB workers. The head gets **no** Docker
socket in fleet mode: it only drives worker daemons over SSH.

## Operating

- Watch the head's log for `fleet` entries: worker created, ready (with boot
  time), destroyed, and any create failures. A failed create is retried after
  two minutes, not on every poll.
- `doctl compute droplet list --tag-name scriptum-worker` shows the workers
  that exist right now. Outside use there should be none.
- After a new release, re-bake the worker image and update
  `SCRIPTUM_WORKER_IMAGE`, or new workers pull the workspace image on first
  use (several minutes).
