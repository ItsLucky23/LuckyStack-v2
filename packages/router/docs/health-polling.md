# Health polling

The router's health system has two layers:

1. **`startHealthPoller`** — an in-process loop that probes each locally-owned service URL with `HEAD /` and flips the resolver's health state on change. Only runs in dev mode with fallback routing enabled.
2. **`createRedisHealthStore`** — a Redis-backed key/value plus pub/sub layer that lets multiple router replicas converge on the same view of service health.

Source: `packages/router/src/healthPoller.ts`, `packages/router/src/redisHealthStore.ts`, `packages/router/src/resolveTarget.ts`.

## When the poller is active

The poller is started by `startRouter()` only when **all** of the following hold:

- `input.currentEnvKey === 'development'`
- `deploy.config.ts -> development.enableFallbackRouting === true`
- The current env exists in `environments[...]`

In production the router does not poll — it relies on the platform's load balancer to short-circuit dead instances at the connection layer, and on Redis-backed health state for cross-router awareness when other replicas mark a service down.

## Probe protocol

```ts
fetch(serviceUrl, { method: 'HEAD', signal: <AbortController, 2s timeout> })
```

- **Healthy** = `response.ok || response.status < 500`. Any 4xx that isn't a 5xx still counts as healthy because the request reached the backend.
- **Unhealthy** = `fetch` rejected (network error, DNS failure, abort due to timeout) or the response status was `>= 500`.
- The poller does not retry inside a single tick — one HEAD per service per interval. State transitions are observed by comparing the new value against `resolver.getLocalHealth(service)`.

The probe URL is the value from `deploy.config.ts -> environments[currentEnvKey].bindings[service]`. There is no separate `/livez` or `/healthz` path appended; the backend is expected to respond to HEAD on `/`.

## Poll interval

Resolved in this order by `startRouter`:

1. `deploy.config.ts -> development.healthPollMs`
2. `deploy.config.ts -> routing.defaultHealthPollMs`
3. `5000` ms

The interval is registered via `setInterval(...)` and `.unref()`-ed so it never blocks process exit. An initial probe runs immediately so the first few requests have real health data instead of the optimistic "everything healthy" default.

## Which services get polled

```ts
const services = resolver.getLocallyOwnedServices()
  .filter((service) => Boolean(localBindings[service]));
```

- `getLocallyOwnedServices()` — when `localPresetKey` is set, this is `services.config.ts -> presets[localPresetKey].services`; when unset, it's `Object.keys(currentEnv.bindings)`.
- Intersected with the current env's `bindings` map so services declared in a preset but unbound in the current env are skipped.

Services owned by another preset, and services declared only in the fallback env, are never polled by this instance — that's the job of the router replica running that preset.

## State propagation

```ts
const previous = resolver.getLocalHealth(service);
if (healthy !== previous) {
  resolver.setLocalHealth(service, healthy);
  onStateChange?.(service, healthy);
}
```

`resolver.setLocalHealth(service, healthy)`:

1. Writes the new value into the in-process `healthState` Map.
2. When a `RedisHealthStore` is attached, asynchronously writes `router:health:<envKey>:<service>` and publishes on `router:health:events:<envKey>`.

The Redis subscriber inside `createRedisHealthStore` listens on the same channel. When a sibling router publishes a change, the subscriber updates its in-memory cache and invokes `onExternalChange(service, healthy)`, which `startRouter` wires back to `resolver.setLocalHealth(...)` so `getLocalHealth` stays consistent for inspectors and tests.

`onStateChange` (passed by `startRouter`) is fired only for poller-detected transitions and logs:

```text
[router] local service '<service>' is now healthy
[router] local service '<service>' is now unhealthy
```

## Shared health store

`createRedisHealthStore({ envKey, onExternalChange })`:

| Method | Behavior |
| --- | --- |
| `hydrate(services)` | `MGET` every key on boot, populates the local cache. Missing keys default to **healthy** (optimistic) so cold-starts don't route every first request to fallback while waiting for the first poll. |
| `set(service, healthy)` | `SET router:health:<envKey>:<service>` to `'healthy'` / `'unhealthy'`, then `PUBLISH` `{ service, healthy }` on the events channel. |
| `get(service)` | Returns the cached value, defaulting to `true` (healthy) when absent. |
| `close()` | Unsubscribes the listener and disconnects both clients. |

Two `ioredis` clients are used: one for `GET`/`SET`/`PUBLISH`, one dedicated to `SUBSCRIBE` (Redis pub/sub requires the subscribing connection to be exclusive). Both use `lazyConnect: true` so a Redis outage surfaces as an explicit `connect` failure instead of buffering commands behind a retry loop.

Connection options come from `getRedisConnectionOptions()` in `@luckystack/core`, with optional overrides on the `RedisHealthStoreInput` (`redisHost`, `redisPort`, `redisPassword`). The fallback chain inside `createRedisHealthStore` is `input.redisHost ?? process.env.REDIS_HOST ?? '127.0.0.1'` (and similar for port and password) — practical for tests that need to swap host without touching env vars.

## Hydration sequence on boot

In `startRouter`, the order is:

1. `createRedisHealthStore({ envKey, onExternalChange })` — connects two Redis clients, subscribes to the events channel.
2. `createServiceTargetResolver({ ..., healthStore })` — resolver reads health via the store first, falling back to its in-memory map.
3. `await healthStore.hydrate(resolver.getLocallyOwnedServices())` — seeds the resolver from Redis before the HTTP listener opens.
4. `server.listen(port)` — first request never sees a cold cache.

If hydration is skipped (no store), the in-memory map is pre-populated with `true` for every locally-owned service in `createServiceTargetResolver`, so the result is the same optimistic default.

## In-memory fallback

When `createRedisHealthStore` throws and split/fallback mode is **not** active (current env has no `fallback`):

```text
[router] shared health state unavailable, falling back to in-memory
```

The resolver runs without a `healthStore`. Local health is per-process; sibling routers do not see updates. Acceptable for single-instance dev without Redis.

## Hard-fail rule (split/fallback mode)

When the current env declares a `fallback`, `requireSharedHealth = true` in `startRouter`. If `createRedisHealthStore` throws, the router refuses to start:

```text
[router] split/fallback mode requires shared Redis, but the store failed to initialize: <reason>
```

`--no-shared-health` is silently ignored in this mode for the same reason.

## Inflight request behavior on health flips

Health changes affect **request-level** routing only:

- A request that already entered `createHttpProxy` and called `resolver.resolve(service)` has its target bound. Subsequent flips do not redirect it.
- A WebSocket connection upgraded to the `system` backend stays there for its lifetime, even if `system` is later marked unhealthy — the Socket.io Redis adapter keeps cross-instance rooms working regardless.
- New incoming requests/upgrades hit the latest resolver state.

This is the "switch new traffic, leave inflight alone" guarantee from `ARCHITECTURE_PACKAGING.md` §9.6 #5.

## Manual probe

`HealthPoller.checkNow()` returns a promise that resolves once every locally-owned service has been probed. Useful for tests and for forced re-checks after a known recovery event:

```ts
const running = await startRouter({ currentEnvKey: 'development' });
await running.healthPoller?.checkNow();
```

## Disabling shared state for single-instance dev

Pass `--no-shared-health` (CLI) or `disableSharedHealthState: true` (programmatic). The router uses an in-memory Map per process. Do not use this in production when more than one router replica exists — replicas will silently disagree about which services are up.

## Related

- `packages/router/src/healthPoller.ts` — poller implementation.
- `packages/router/src/redisHealthStore.ts` — Redis-backed store + pub/sub.
- `packages/router/src/resolveTarget.ts` — reads health when choosing local vs fallback.
- `packages/router/docs/boot-uuid-failover.md` — the second Redis-mediated guarantee that runs at boot.
- `docs/HOSTING.md` — environment topology and Redis sharing requirements.
