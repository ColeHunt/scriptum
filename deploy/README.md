# deploy/

Deployment assets for running Scriptum somewhere other than a single local
machine. The Google Cloud and Cloudflare setup inherited from the upstream
CodeRunner project was removed (decision 052) because this fork never used it.

For a local deployment, `docker-compose.yml` at the repo root is all you need;
see [Local Deployment](../docs/deploying/local.md).

## Subdirectories

- `digitalocean/` — **Not yet deployed.** Infrastructure-as-code for the
  proposed worker fleet (decision 048): the Scriptum head runs as a service in
  the shared MARS/WARS `apps-infra` stack like the other apps, and student
  workspace containers run on dynamically scaled DigitalOcean worker droplets.
  See [`digitalocean/README.md`](digitalocean/README.md).
