# deploy/

Deployment assets for running Scriptum somewhere other than a single local
machine. There are none on `main` right now: the Google Cloud and Cloudflare
setup inherited from the upstream CodeRunner project was removed (decision
052) because this fork never used it.

For a local deployment, `docker-compose.yml` at the repo root is all you need;
see [Local Deployment](../docs/deploying/local.md).
