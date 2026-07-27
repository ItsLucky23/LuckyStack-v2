# Distributed Docker framework plan — 2026-07-27

> AI findings ledger. Status of every item is tracked here (Findings Protocol).
> Scope: LuckyStack router, API/sync transports, presets, shared Redis, Docker assets and Flexbuddy's proven Compose implementation · Tool/agents: source/docs/config review against Flexbuddy's live Docker proof · Supersedes: —

Last updated: 2026-07-27

| # | Finding | Severity | Status | Since | Resolved | Notes / link |
|---|---------|----------|--------|-------|----------|--------------|
| 1 | Socket-first `apiRequest`/`syncRequest` executes on the `system` socket backend, so a locally owned feature preset is bypassed | HIGH | fixed | 2026-07-27 | 2026-07-27 | `transport.invocation: 'routed-http'` now routes typed API/sync execution through HTTP/SSE; one system socket remains for realtime delivery. ADR 0037 + hard-fail Redis integration proof. |
| 2 | Production Docker/Compose assets are not shipped by the scaffolder or CLI | HIGH | fixed | 2026-07-27 | 2026-07-27 | Fresh scaffolds render provider/router-aware assets; existing projects use `npx luckystack add docker`; raw template/CLI assets have byte-parity tests. |
| 3 | Production container startup is not preset-aware as a first-class generated artifact | MED | fixed | 2026-07-27 | 2026-07-27 | `docker/start.sh` selects `LUCKYSTACK_PRESET` at runtime; images bundle generated preset maps and router configs without hardcoding execution to `default`. |
| 4 | Custom HTTP-route ownership is not represented in the shared topology manifest | HIGH | fixed | 2026-07-27 | 2026-07-27 | `services.config.ts > customRoutes` is pure data; longest-prefix routing plus router/preset/deploy fail-fast validation. |
| 5 | A service binding accepts one URL, not a health-aware replica target pool | MED | open | 2026-07-27 | — | External load-balancer URL works today; router-native pools do not |
| 6 | Multi-router/System-replica Socket.io affinity is not delivered as production edge configuration | HIGH | open | 2026-07-27 | — | Polling + upgrade must remain on one backend; shared Redis does not replace affinity |
| 7 | Managed/remote Redis TLS is possible only through custom client registration, not simple standard env configuration | MED | open | 2026-07-27 | — | `luckystack/core/clients.ts` supports custom ioredis; default client only reads host/port/user/password |
| 8 | Local upload volumes are unsafe for service replicas on multiple hosts | HIGH | open | 2026-07-27 | — | Shared object storage is required before multi-host promotion |
| 9 | No framework CI job proves image builds, Compose health, routed API/sync, Socket.io affinity, or split-host behavior | MED | open | 2026-07-27 | — | Unit/integration coverage does not currently build the production topology |
| 10 | The supported scaling modes and local-preset→remote-fallback runbook are fragmented rather than AI-first | MED | open | 2026-07-27 | — | Consolidate in architecture/hosting/package docs and generated AI runbooks |
| 11 | Named `LUCKYSTACK_ENV` topology identities were also treated as application development mode | CRITICAL | fixed | 2026-07-27 | 2026-07-27 | ADR 0040 separates NODE_ENV runtime policy from boot/router topology identity; security, maps, cookies, ports and tooling use runtime mode |

## Executive conclusion

LuckyStack already has most **server-side primitives** needed for this model:

- multiple backend processes can share one remote Redis instance;
- the Socket.io Redis adapter fans events out across processes/hosts;
- one preset can be started locally while the router sends non-local or unhealthy services to a staging fallback;
- generated API/sync maps already create one production bundle per preset;
- a binding may point at an external load balancer, so one service can already have multiple replicas behind that URL;
- router health state and fallback state can be shared through Redis.

Implementation update (2026-07-27): the browser flow now honors split ownership when `transport.invocation: 'routed-http'` is selected. `apiRequest` and `syncRequest` invoke through routed HTTP/SSE while the single Socket.io connection remains pinned to `routing.websocketService` (normally `system`) for rooms, presence and realtime callbacks. Redis distributes the resulting events; it still does not remotely execute handlers. Socket invocation remains the backwards-compatible monolith default.

So the short answer is:

| Capability | Today | Condition / gap |
|---|---|---|
| One shared remote Redis | Yes | Every backend/router must use the same instance, credentials, key namespace and compatible secrets |
| Local containers against staging Redis/Mongo | Yes | Explicit opt-in env; this gives normal staging read/write access |
| Start only `admin` locally, keep other services remote | Yes with routed invocation | Set `transport.invocation: 'routed-http'`; local `admin` executes its routes and other services use router fallback |
| Horizontal replicas of a complete monolith | Yes | Put replicas behind an external LB and share Redis/database/storage |
| Horizontal replicas per feature service | Yes via external LB | Each service binding points to its LB URL; native target arrays are not present |
| Multiple router replicas | Architecturally yes | Edge affinity is mandatory for Socket.io polling/upgrade; shared Redis health state is already supported |
| Fully split multi-host LuckyStack | Framework transport/assets complete | Routed invocation, custom-route ownership and Docker assets are implemented; shared storage and production edge topology remain consumer/operator responsibilities |

## Recommended execution model

Preserve one browser Socket.io connection, but separate **invocation transport** from **realtime delivery**:

```text
Browser
  ├─ API + sync invocation ──HTTP/SSE──> edge ──> LuckyStack router ──> owning service
  └─ realtime subscription ─Socket.io──> system ingress

Owning service ──Socket.io Redis adapter──> shared Redis ──> system socket(s) ──> Browser
```

Add a project-level mode such as:

```ts
transport: {
  invocation: 'socket' | 'routed-http';
}
```

- Keep `socket` as the backwards-compatible default for monoliths.
- `npx luckystack add router` should wire `routed-http` for a split topology.
- `apiRequest` uses the existing HTTP route through `httpFetch`, including CSRF, generated HTTP method, typed envelopes, `AbortSignal`, timeout and SSE stream parsing.
- `syncRequest` uses the existing HTTP/SSE sync route for execution and acknowledgement.
- `upsertSyncEventCallback`, room membership, presence and reconnect remain on the one `system` Socket.io connection.
- The service that owns a sync handler performs fanout through the already shared Socket.io Redis adapter.

This directly enables the requested developer loop:

```text
localhost Vite/nginx → local router
  admin paths → local admin preset/container
  all other API/sync paths → staging fallback bindings
  Socket.io → staging system ingress (or local system when explicitly started)
```

The local feature process must point at staging's Redis, database and compatible session/crypto configuration. It does not need a second browser socket.

### Why not make `system` an internal RPC dispatcher first?

Server-to-server dispatch can work, but it duplicates the existing HTTP transport and introduces a new authenticated protocol with loop prevention, request-context forwarding, streaming framing, cancellation, acknowledgement correlation, retry safety and mutation idempotency. LuckyStack already has HTTP/SSE parity handlers and a service-aware HTTP router. Routed invocation is the smaller and safer generic primitive. Internal RPC should only be added later for server-originated calls that cannot traverse the public/internal router path.

## Supported horizontal-scaling modes

### Mode A — replicated monolith

```text
edge LB (TLS + Socket.io affinity)
  ├─ complete instance A
  ├─ complete instance B
  └─ complete instance C
       └─ shared Redis + database + object storage
```

This remains the simplest production mode. Every instance uses the complete preset. Redis provides cross-instance socket fanout; the LB provides connection affinity and health-aware balancing.

### Mode B — service split with replica pools

```text
edge LB → router replicas
             ├─ system LB → system-1, system-2
             ├─ admin LB  → admin-1, admin-2
             ├─ ats LB    → ats-1, ats-2
             └─ fallback environment for unowned services

all processes → shared Redis + database + object storage
```

This works immediately when each `deploy.config.ts` binding is an external/internal LB URL. Router-native arrays may be added later, but should not block the first production path: mature load balancers already provide active health checks, draining, connection limits and observability.

### Mode C — one local feature against remote staging

```text
local router (env=development, preset=admin)
  ├─ admin → local admin process/container
  └─ other services → fallback=staging

browser socket → staging system
local admin + staging services → same staging Redis/database
```

Required safety rules:

1. Explicit `--env-file`/profile; never default to staging.
2. Loud startup banner naming every remote dependency and resolved host (without secrets).
3. Same session/crypto/project namespace as staging where request authentication requires it.
4. TLS for remote Redis/database outside a trusted tunnel/network.
5. No local seed/migration/bootstrap step may run against staging automatically.
6. Prefer a dedicated staging developer identity and least-privilege credentials.

## Framework versus consumer ownership

| Surface | LuckyStack-v2 owns (generic) | Consumer owns (project-specific) |
|---|---|---|
| Image build | Multi-stage Node/Bun-aware Dockerfile templates, non-root runtime, read-only compatibility, healthchecks, preset entrypoint | Native OS libs unique to the app; exceptional build steps |
| Router image | Generic `@luckystack/router` target/command and generated config bundle | Environment bindings, public hostnames, secrets |
| Web image | Generic unprivileged nginx template, SPA/assets caching, API/sync/socket proxy defaults | Additional custom backend prefixes/domain-specific cache policy |
| Compose | Base services, profiles, health gates, private networks, localhost binding, host-gateway support | App env, service names/presets, selected database, public port |
| Mongo bootstrap | Generic replica-set election/init only | User/admin seed data and migrations |
| Redis | Private authenticated local service and external endpoint slots | Real password/managed endpoint, namespaces and retention policy |
| Presets | CLI/rendering that produces one service per selected preset and validates coverage | Which feature folders belong to each preset |
| Custom routes | Typed ownership manifest + generated router/edge mappings | Route path, owning service, handler/business policy |
| Storage | Generic storage-readiness validation and object-storage hooks | Bucket/provider/credentials/retention |
| CI | Reusable image/Compose/split-topology smoke workflow | Registry, tags, environments and deployment approvals |
| Docs/AI | Canonical scaling runbook, config schema, generated topology summary | Real host inventory and operational contacts |

## Docker asset migration from Flexbuddy

### Move/generalize into `LuckyStack-v2`

- `.dockerignore` baseline and secret exclusions.
- Multi-stage `Dockerfile` structure: dependency cache, double artifact generation, frontend build, minimal non-root app/router images, unprivileged nginx, `tini`, healthchecks.
- `docker/nginx.conf` as a generated template rather than a Flexbuddy-named static upstream.
- Generic Mongo replica-set initializer (election only).
- Compose patterns: named volumes, private infrastructure, health-gated startup, `127.0.0.1` public binding, read-only filesystems, `tmpfs`, dropped capabilities, `no-new-privileges`, `host.docker.internal:host-gateway`.
- External-infrastructure env template and explicit profile/command.
- Docker verification/runbook and reusable CI smoke workflow.
- Production router-config bundling in the scaffold's canonical `bundleServer.mjs`, conditional on router installation.

Recommended locations:

```text
packages/create-luckystack-app/template/
  Dockerfile
  _dot_dockerignore
  docker/nginx.conf.template
  docker/mongo-replica-init.js
  compose.yaml
  _dot_env_docker_remote_template
  docs/DOCKER.md

packages/cli/assets/docker/
  (same canonical assets for `npx luckystack add docker`)
packages/cli/src/commands/addDocker.ts
packages/cli/src/commands/checkDocker.ts
packages/cli/src/commands/renderDocker.ts
```

The template and CLI asset copies need an asset-parity test, matching the existing router asset contract.

### Keep in Flexbuddy

- `docker/mongo-init.js` user document and bootstrap credentials.
- `FLEXBUDDY_*` variable names and all app integration values.
- `topology.services.ts`, actual preset membership and concrete production/staging URLs.
- Flexbuddy custom-route ownership (`storage-download`, Resend inbound webhook, etc.).
- R2 buckets, email, ERP, OCR/enrichment concurrency and encryption keys.
- Any local bootstrap administrator.

Flexbuddy should consume/regenerate framework Docker assets after they land; do not keep two independently evolving generic implementations.

## Required framework work, in dependency order

### Phase 1 — close correctness gaps

1. Add optional routed HTTP/SSE invocation to typed `apiRequest` and `syncRequest` with transport-parity tests.
2. Add a pure-data custom-route ownership manifest and fail validation when a backend route can reach nginx/router without an owner.
3. Correct stale sync documentation so Redis fanout is not described as remote handler execution.
4. Add a multi-process integration test proving: remote `system` socket + local `admin` execution + callback delivered over shared Redis.

### Phase 2 — make Docker a product surface

1. Add `npx luckystack add docker` and canonical template/CLI assets.
2. Render services from selected presets instead of hardcoding `default`.
3. Separate `compose.yaml` (generic base) from local infrastructure and remote-staging profiles/overrides.
4. Add ORM/database-aware runtime generation and generic replica-set init.
5. Add `luckystack docker check` to print URLs/ports, selected presets, dependency hosts, route ownership, storage mode and dangerous remote writes.

### Phase 3 — scale and production hardening

1. Document and test external-LB-per-binding as the supported first replica model.
2. Ship edge examples for router replicas and Socket.io affinity/draining.
3. Add standard TLS/URL support for managed Redis or scaffold a clearly documented custom ioredis registration.
4. Add router-native target pools only if users need LuckyStack to replace the internal LB; include health, draining and deterministic Socket.io affinity rather than plain round-robin.
5. Require shared object storage in multi-host validation.
6. Add image CVE scan, Compose health/login/API/sync/SPA/socket smoke and split-host test jobs.

### Phase 4 — make it AI-obvious

Update and cross-link:

- `docs/ARCHITECTURE_MULTI_INSTANCE.md`
- `docs/HOSTING.md`
- `docs/ARCHITECTURE_SOCKET.md`
- `docs/ARCHITECTURE_SYNC.md`
- `packages/router/CLAUDE.md`
- `packages/create-luckystack-app/CLAUDE.md`
- `docs/AI_RUNBOOKS.md` generator
- `docs/PACKAGE_OVERVIEW.md`

The generated AI runbook must answer, with commands and expected URLs/ports:

- replicate a monolith;
- split presets over hosts;
- run one preset locally against staging fallback;
- select local versus remote Redis/database independently;
- diagnose `serviceNotAssigned`, boot UUID mismatch, affinity failures and Redis fanout failures;
- prove which preset/build is running on each backend.

## Verification gates

A framework implementation is complete only when these automated cases pass:

1. Two complete backend replicas behind an LB share sessions and cross-instance sync.
2. Browser socket is attached to remote `system`; routed API executes only on local `admin`.
3. Routed sync executes only on local `admin`, then reaches the browser callback via Redis and remote `system`.
4. Non-local service automatically uses staging fallback; healthy local service switches back without reconnecting the browser socket.
5. Streaming, cancellation, timeout, CSRF, auth and error envelopes are transport-equivalent.
6. Two router replicas survive one-router termination without losing new connections; existing Socket.io behavior follows the documented drain/reconnect contract.
7. Unknown custom route fails build/config validation, not first live request.
8. Multi-host validation rejects local filesystem uploads.
9. A clean scaffold can build every selected preset image without consumer-only files.
10. CI reports actual public/internal URLs and ports for every smoke topology.
