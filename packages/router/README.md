# @luckystack/router

> Optional standalone HTTP + WebSocket load-balancer for multi-instance [LuckyStack](https://github.com/ItsLucky23/LuckyStack-v2) deployments. Redis-backed health, boot-UUID handshake, service-key-aware routing, per-service backend pinning, and a dev → staging fallback proxy.

## When you need it

LuckyStack runs perfectly well on a single backend instance fronted by your platform's built-in load balancer (Cloud Run, ALB, Caddy, nginx). Reach for this router only when:

- **You run two or more backend instances** behind one public origin (per-preset deployment, A/B testing, blue/green).
- **You want `npm run dev` to forward unimplemented services to staging** while you focus on the few you actually changed (the "run only the services you changed" pattern in `deploy.config.ts`).
- **You need boot-UUID guarantees** so a stale duplicate Redis URL can't silently serve traffic from the wrong topology.

If none of the above apply, install `@luckystack/server` only and skip this package.

## Install

```bash
npm install @luckystack/router ioredis
```

`ioredis` is a peer dependency — shared with `@luckystack/core` so you don't accidentally end up with two Redis clients in one process.

## CLI — `luckystack-router`

The package ships a bin. Point it at your compiled `deploy.config.js` and `services.config.js` and it boots a router instance:

```bash
luckystack-router \
  --deploy ./dist/deploy.config.js \
  --services ./dist/services.config.js \
  --env production \
  --preset api \
  --port 4000
```

| Flag | Required | Description |
| --- | --- | --- |
| `--deploy`, `-d` | Yes | Path to the compiled `deploy.config.js` (calls `registerDeployConfig`). |
| `--services`, `-s` | Yes | Path to the compiled `services.config.js` (calls `registerServicesConfig`). |
| `--env`, `-e` | No | Environment key. Default: `NODE_ENV` or `'development'`. |
| `--preset`, `-p` | No | Preset key for the locally-running backend bundle. |
| `--port` | No | Listen port. Default: `ROUTER_PORT` env or `routing.defaultRouterPort`. |
| `--no-shared-health` | No | Skip Redis-backed health store. Ignored in split/fallback mode (always required). |
| `--help`, `-h` | No | Print usage. |

Dev mode against TypeScript sources:

```bash
npx tsx node_modules/@luckystack/router/dist/cli.js \
  --deploy ./deploy.config.ts \
  --services ./services.config.ts \
  --env development
```

## Programmatic API

When you need finer control (custom listeners, embedded into your own bootstrap), import `startRouter`:

```ts
import { startRouter } from '@luckystack/router';
import './deploy.config';     // side-effect: registerDeployConfig(...)
import './services.config';   // side-effect: registerServicesConfig(...)

const running = await startRouter({
  currentEnvKey: 'production',
  localPresetKey: 'api',
  port: 4000,
});

// ... later
await running.stop();
```

| Export | Purpose |
| --- | --- |
| `startRouter(input)` | Boot the router. Returns `{ httpServer, stop }`. |
| `createServiceTargetResolver(input)` / `parseServiceFromPath(url)` | Map a request URL to a target backend by service key. |
| `startHealthPoller(input)` | Begin polling every backend's `/livez` (or configured probe path) and write to Redis. |
| `createHttpProxy(input)` | Low-level HTTP proxy with retry + timeout. |
| `createWsProxy(input)` | Low-level WebSocket upgrade proxy. |

Types: `StartRouterInput`, `RunningRouter`, `ResolveTargetInput`, `ResolveTargetResult`, `ServiceTargetResolver`, `StartHealthPollerInput`, `HealthPoller`, `CreateHttpProxyInput`, `CreateWsProxyInput`.

## How it works

1. HTTP requests are forwarded to the backend whose `services.config.ts` preset owns the service segment of the URL (`/api/<service>/<name>/v<n>`).
2. WebSocket upgrades are pinned to the `system` service backend (Socket.io's Redis adapter handles cross-instance room fanout regardless of which backend holds the connection).
3. Health is polled per-target and stored in Redis so multiple router replicas converge on the same view.
4. A boot-UUID handshake on each target catches the "two URLs both respond, but one is stale" footgun — when `strictBootHandshake` is true, the router refuses to start if any target's `synchronizedEnvKeys` SHA-256 hash diverges from the local one.
5. Optional dev-mode fallback: when the local backend is unreachable, traffic is routed to a configured staging environment (`deploy.config.ts` `fallback`). When the local backend returns to health, new traffic is moved back; existing socket connections stay where they were placed.

## Dependencies

- Runtime: `@luckystack/core`
- Peer (canonical ranges, standardized 2026-05-11):
  - `ioredis@^5.10.0`

## Related architecture docs

- [`docs/ARCHITECTURE_PACKAGING.md`](../../docs/ARCHITECTURE_PACKAGING.md) — multi-service builds, preset bundles, `LUCKYSTACK_BUNDLE`.
- [`docs/HOSTING.md`](../../docs/HOSTING.md) — deployment topology + health probes.

## License

MIT — see [LICENSE](../../LICENSE).
