# Docker deployment guidance

The local stack is a production-like verification environment, not evidence that a deployment is secure. Inspect Compose, Dockerfiles and nginx configuration for actual services, ports, mounts and routing.

## Start and verify

Run `docker compose up --build -d`, inspect `docker compose ps`, then check `/livez` and `/readyz` on the published web URL. Readiness must prove usable dependencies, not just a listening process. For an intentional remote-resource setup, copy `.env.docker_template` to ignored `.env.docker`, supply only authorized connections and use `docker compose --env-file .env.docker up --build -d`. Host tunnels must exist first; use the supported host gateway rather than a container's loopback.

Remote/staging resources grant ordinary application read/write access. Never select them as a silent fallback or seed/migrate them automatically. Secrets must remain outside the build context and committed files.

## Boundaries before promotion

- Terminate TLS at a trusted edge; align public URL, cookie security and allowed origins. Preserve Socket.io affinity/draining across replicas.
- When declaring custom HTTP prefixes, review both ingress proxying and the router's owning-service policy; a valid backend route can still be unreachable at the edge.
- Keep unprivileged processes, restricted capabilities and explicit writable mounts. Do not solve permission failures by making the whole image writable or privileged.
- One-host upload volumes do not provide shared storage across hosts. Replicas require deliberately shared object storage; persistent database volumes require backups.
- Use orchestrator secrets, pinned images, resource limits and centralized observability before public exposure.

`docker compose down` stops the stack while preserving data. Removing volumes permanently destroys it and needs a deliberate decision. The initializer is not an application account/seed policy; supply domain bootstrap separately.
