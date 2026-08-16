# Docker and Compose

The scaffold ships a production-like local stack: an unprivileged nginx web image, a non-root LuckyStack app image, optional LuckyStack router, private database/Redis services, health gates, read-only application filesystems, and persistent named volumes.

## Start and verify

```bash
docker compose up --build -d
docker compose ps
curl -fsS http://localhost:8080/livez
curl -fsS http://localhost:8080/readyz
```

Open <http://localhost:8080>. Override the localhost-only public port with `LUCKYSTACK_PORT=8181`. The app preset is runtime-selectable:

```bash
LUCKYSTACK_PRESET=admin docker compose up --build -d
```

The image startup line reports the role, preset, and port. It never prints secret values. With the router installed, invocation uses routed HTTP/SSE while the browser retains one Socket.io connection for realtime delivery.

## Local versus remote infrastructure

Copy `.env.docker_template` to the gitignored `.env.docker`, then fill only the resources you intentionally want to use:

```bash
cp .env.docker_template .env.docker
# Start host-side tunnels first when needed.
docker compose --env-file .env.docker up --build -d
```

Use `host.docker.internal` for host tunnels; Compose supplies Linux `host-gateway`. Mongo/database and Redis are independently selectable. Remote/staging values provide normal application read/write access: never make them the default, and never run seed or migration commands automatically.

## Custom HTTP routes

Framework routes are already proxied in `docker/nginx.conf`. If `services.config.ts > customRoutes` declares additional prefixes, add those prefixes to the nginx backend location expression as part of the same change. The LuckyStack router determines their owning service by longest prefix.

## Security and persistence

- `.env.local`, `.env.docker`, keys, certificates, and secret-manager tokens are excluded from the build context.
- App/router run as the unprivileged `node` user; nginx runs unprivileged.
- Compose drops capabilities, enables `no-new-privileges`, and uses read-only root filesystems plus explicit writable mounts/tmpfs.
- `uploads_data` is suitable for one-host local operation only. Multi-host replicas require shared object storage.
- The generic Mongo initializer elects a local replica set only. It creates no users, business records, or bootstrap credentials.

Stop while preserving data with `docker compose down`. Removing volumes permanently deletes local data and should only be done deliberately.

## Production promotion

Before exposing this stack publicly: terminate TLS at a trusted edge, set `PUBLIC_URL`/`SECURE`, use orchestrator secrets, pin images by digest, add resource limits and centralized logs, configure backups, require shared object storage for replicas, and preserve Socket.io affinity/draining across router or system replicas.
