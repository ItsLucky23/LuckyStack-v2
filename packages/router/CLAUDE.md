# @luckystack/router

> AI summary + function INDEX. For deep specs see `docs/` next to this file.

---

## What this package is

`@luckystack/router` is the **optional** standalone HTTP + WebSocket load-balancer used when a LuckyStack deployment runs more than one backend instance behind a single public origin.

It owns:

- A `luckystack-router` CLI that side-effect-imports the consumer's compiled `deploy.config.js` + `services.config.js`, then boots an HTTP server with a service-key-aware proxy.
- **Service resolution**: parses the first non-transport URL segment (`/api/<service>/...`, `/sync/<service>/...`) and maps it to a target backend URL declared in `deploy.config.ts -> environments[envKey].bindings`.
- **Multi-instance load-balancing**: per-service bindings let preset bundles (e.g. `api` vs `system`) live on different backend processes; WebSocket upgrades are pinned to the `system` service backend.
- **Health polling** of locally-owned services (dev fallback mode) and **Redis-backed shared health state** so router replicas converge on the same view.
- **Boot-UUID handshake** that catches the "two Redis URLs both respond, but one is stale" footgun and warns (or hard-fails when `strictBootHandshake = true`) on `synchronizedEnvKeys` SHA-256 drift between current env and its `fallback`.
- A `dev → staging fallback` proxy: when the local backend for a service is unreachable, traffic is forwarded to the env declared in `environment.fallback`; on recovery, new traffic snaps back (inflight requests/sockets stay put).
- Two extension hooks via `@luckystack/core`'s hook bus: `preProxyRequest` and `postProxyResponse`.

## When to USE this package

- You run **two or more backend instances** behind one public origin (per-preset deployment, A/B testing, blue/green, horizontal scale).
- You want `npm run dev` to **forward unimplemented services to staging** while you only run the few you changed.
- You need **boot-UUID guarantees** that a stale duplicate Redis URL can't silently serve traffic from the wrong topology.
- You want to **intercept proxy traffic** (tracing IDs, audit logging, redaction) via `preProxyRequest` / `postProxyResponse` hooks without forking the router.
- You need **custom service resolution** (host-based, header-based, prefix-based) via `registerServiceResolver`.

## When NOT to USE this package

- A single backend instance fronted by your platform's built-in load balancer (Cloud Run, ALB, Caddy, nginx). Install `@luckystack/server` only and skip this package entirely.
- You do not need preset-aware routing and your platform handles WebSocket upgrades natively — there is nothing this package adds over a generic L7 proxy in that case.
- You do not have Redis available. Single-instance dev without Redis can use `--no-shared-health`, but split/fallback mode (current env declares `fallback`) **requires** Redis and will hard-fail without it.

## Function Index

CLI entry (`packages/router/src/cli.ts`):

- `luckystack-router --deploy <file> --services <file> [--env <key>] [--preset <key>] [--port <n>] [--no-shared-health]` — Side-effect-imports the compiled deploy + services configs, then calls `startRouter()`. Handles SIGINT/SIGTERM shutdown.

Bootstrap (`packages/router/src/startRouter.ts`):

- `startRouter(input: StartRouterInput): Promise<RunningRouter>` — Main entry. Reads `getDeployConfig()` + `getServicesConfig()` from `@luckystack/core`, optionally initializes the Redis health store (required in split/fallback mode), creates the resolver, runs the boot handshake when a fallback env is configured, starts the HTTP server with proxy + WS upgrade handler, and (in dev with `enableFallbackRouting`) starts the health poller. Returns `{ port, resolver, healthPoller, healthStore, stop() }`.

Service resolution (`packages/router/src/resolveTarget.ts`):

- `createServiceTargetResolver(input: ResolveTargetInput): ServiceTargetResolver` — Builds the resolver bound to a specific env. Exposes `resolve(service)`, `setLocalHealth(service, healthy)`, `getLocalHealth(service)`, `getLocallyOwnedServices()`. Resolution order: local binding (when service is owned + healthy) → fallback env binding → null.
- `parseServiceFromPath(pathname: string): string | null` — Default resolver. Strips `/api/` or `/sync/` prefix, returns the next segment.
- `registerServiceResolver(resolver: ServiceResolver | null): void` — Replace the default with a custom function. Return `null` from the resolver to defer to the default. Pass `null` to unregister.
- `resolveServiceKey(input): string | null` — Internal: honors the registered resolver, falls back to `parseServiceFromPath`.

Health polling (`packages/router/src/healthPoller.ts`):

- `startHealthPoller(input: StartHealthPollerInput): HealthPoller` — Polls each locally-owned service's URL with `HEAD /`, flips `resolver.setLocalHealth(...)` on state change, fires `onStateChange` callback. Only started in dev with `enableFallbackRouting`. Returns `{ stop(), checkNow() }`.

HTTP proxy (`packages/router/src/httpProxy.ts`):

- `createHttpProxy(input: CreateHttpProxyInput)` — Returns an `(req, res) => void` handler. Strips hop-by-hop headers, adds `x-forwarded-host`, `x-forwarded-proto`, `x-luckystack-resolved-env`, `x-luckystack-via-fallback`. Dispatches `preProxyRequest` hook before the upstream call and `postProxyResponse` after the upstream response starts. Emits `routing.invalidRequestPath` (400), `<missingServiceErrorCode>` (502), or `routing.upstreamUnreachable` (502) on errors.

WebSocket proxy (`packages/router/src/wsProxy.ts`):

- `createWsProxy(input: CreateWsProxyInput)` — Returns an `upgrade` handler. Pins all upgrades to the `system` service backend; Socket.io's Redis adapter handles cross-instance fanout.

Boot handshake (`packages/router/src/bootHandshake.ts`):

- `runBootHandshake(input: RunBootHandshakeInput): Promise<void>` — Writes a fresh UUID to `luckystack:boot:<envKey>` in Redis, then probes `<fallbackBaseUrl>/_health`, compares the returned `bootUuid` against what's in Redis under the fallback key, and verifies `synchronizedEnvKeys` SHA-256 hashes match. Strict mode throws; non-strict logs a warning.

Shared health store (`packages/router/src/redisHealthStore.ts`):

- `createRedisHealthStore(input)` — Builds the Redis-backed health view with pub/sub for cross-router propagation. Used internally by `startRouter` and threaded into `createServiceTargetResolver` via the optional `healthStore` parameter.

Hook payloads (`packages/router/src/hookPayloads.ts`):

- Module augments `@luckystack/core`'s `HookPayloads` interface with:
  - `preProxyRequest: PreProxyRequestPayload` — `{ service, pathname, method, target, viaFallback }`.
  - `postProxyResponse: PostProxyResponsePayload` — adds `{ statusCode, latencyMs }`.

## Config keys consumed

Read from `getDeployConfig()` (registered by the consumer's `deploy.config.ts`):

- `environments[envKey].bindings: Record<string, string>` — per-service backend URLs for this env.
- `environments[envKey].fallback?: string` — env key to fall through to when local is unreachable / service unowned.
- `routing.defaultRouterPort?: number` — fallback port (default `4000`).
- `routing.missingServiceErrorCode?: string` — error code returned when no binding resolves (default `'serviceNotAssigned'`).
- `routing.defaultHealthPollMs?: number` — health-poll interval default (default `5000`).
- `routing.enableUnhealthyFallback?: boolean` — when true (default), unhealthy local services route via fallback instead of erroring.
- `routing.strictBootHandshake?: boolean` — when true, boot handshake throws instead of warning on mismatch.
- `routing.healthProbeTimeoutMs?: number` — fallback `/_health` probe timeout (default `3000`).
- `routing.bootKeyTtlSeconds?: number` — TTL for the Redis boot UUID key (default `3600`).
- `routing.maxRequestBodyBytes?: number` — max request body size (bytes) the HTTP proxy rejects before forwarding (413 `routing.requestBodyTooLarge`). DEFAULT undefined → 100 MiB. Set to `Infinity` to disable edge enforcement.
- `development.enableFallbackRouting?: boolean` — turn on the dev-mode `local → staging fallback` flow.
- `development.healthPollMs?: number` — dev health-poll override.

Read from `getServicesConfig()`:

- `presets[presetKey].services: string[]` — which services the locally-running preset bundle owns.

Env vars:

- `ROUTER_PORT` — default listen port when `--port` / `input.port` not given.
- `NODE_ENV` — default `--env` value when not given.
- Redis connection config — read centrally via `@luckystack/core`'s `getRedisConnectionOptions()`.
- `synchronizedEnvKeys` (registered in core) — values are SHA-256-hashed and compared with fallback env during the boot handshake.

## Peer dependencies

- **`ioredis@^5.10.0`** (peer) — required at runtime when shared health state or split/fallback mode is in use. Shared peer with `@luckystack/core` so consumers only end up with one ioredis client per process.
- **`@luckystack/core`** (regular dep) — provides config registries, `dispatchHook`, `tryCatch`, `getLogger`, Redis connection helpers, synchronized-env-key registry.

## Hooks emitted

| Hook | Payload | When | Stop signal? |
|---|---|---|---|
| `proxyRequestGate` | `{ service, pathname, method, target, viaFallback, remoteAddress }` | After path validation + service resolution + host-pin check, **before** the upstream leg opens. HTTP: `method` is the actual HTTP verb; WS upgrades: `method = 'UPGRADE'`. | YES — fail-CLOSED deny gate. Return a `HookStopSignal` to reject with `httpStatus` (default 403) + `errorCode`. No handlers = allow. |
| `preProxyRequest` | `{ service, pathname, method, target, viaFallback }` | Just before the upstream request is sent (after the gate passes). | No (observational). |
| `postProxyResponse` | `preProxyRequest` payload + `{ statusCode, latencyMs, error? }` | Upstream response begins streaming back to the client (happy path) **or** the upstream transport emits `'error'` (failure path — `statusCode: 0`, `error` populated). | No (observational). |

Register handlers via `@luckystack/core`'s hook bus on the consumer side. Consumers distinguish success from failure by inspecting `payload.error` (or `payload.statusCode === 0`).

**Example — IP allowlist gate:**

```ts
import { registerHook } from '@luckystack/core';

registerHook('proxyRequestGate', ({ remoteAddress }) => {
  if (remoteAddress !== undefined && !ALLOWED_IPS.has(remoteAddress)) {
    return { stop: true, errorCode: 'routing.ipDenied', httpStatus: 403 };
  }
});
```

## Conventions for this package

- **Every binding URL in `deploy.config.ts > environments.<envKey>.bindings.<service>` MUST declare an explicit port.** `createServiceTargetResolver` validates this at startup and throws when any binding's URL parses without a port. The error message points at the specific service + env so the misconfigured slot is obvious. This guard exists because the router relies on per-preset port pinning to disambiguate backends — relying on `http`/`https` default ports (80 / 443) silently collapses multi-instance topologies onto the same target.
- No emojis in code, comments, logs, or docs (repo-wide rule).
- All async + I/O paths use `tryCatch` from `@luckystack/core`. No raw `try/catch`.
- Strict typing: no `as unknown`, no `as any`, no `unsafe*` wrappers (repo-wide rule, enforced).
- Side-effect imports of `deploy.config` / `services.config` must run **before** `startRouter()` so the registries are populated.
- The router does **not** terminate TLS, do not add cert-loading logic here. Front it with the platform's TLS-terminating proxy.
- Hook payloads live in `hookPayloads.ts` and module-augment `@luckystack/core`'s `HookPayloads` — keep them serializable and side-effect-free.

## Related links

- `packages/router/README.md` — public-facing readme (install + usage).
- `packages/router/docs/cli.md` — CLI flag reference + lifecycle.
- `packages/router/docs/health-polling.md` — poller behavior + Redis-backed shared state.
- `packages/router/docs/http-proxy.md` — proxy semantics, header rewriting, error codes.
- `packages/router/docs/boot-uuid-failover.md` — boot handshake protocol + strict-mode failure modes.
- `packages/router/docs/post-proxy-response-hook.md` — `preProxyRequest` / `postProxyResponse` hook usage.
- `docs/ARCHITECTURE_PACKAGING.md` §9.6 — packaging & router responsibilities.
- `docs/ARCHITECTURE_ROUTING.md` — file-based routing conventions (consumer side).
- `docs/HOSTING.md` — deployment topology, health probes, environment sync.
- `docs/ARCHITECTURE_MULTI_INSTANCE.md` — multi-instance mental model + pitfalls (WS pins to `system`, cross-instance socket fan-out, shared-Redis footgun, single-binding-per-service scaling).
