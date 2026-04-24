# SESSION_STATE

## Session Summary
Branch `chore/package-split-prep`. This sitting closes the previous session's §34.1-§34.3 follow-ups AND adds the Socket.io Redis adapter (filed as a gap during planning — routers can land a client on instance X, but room fanout only works when every instance shares a pub/sub channel). Also scaffolds `@luckystack/test-runner`.

Six concrete changes landed this session:

1. **Socket.io Redis adapter** — `attachSocketRedisAdapter(io)` in `@luckystack/core`, wired into `server/sockets/socket.ts`. Room broadcasts now fan out across every backend sharing the Redis.
2. **Router WebSocket proxying** — `createWsProxy` + `server.on('upgrade', ...)`. Socket.io upgrades route to the `system` service by convention.
3. **Redis-backed router health state** — `createRedisHealthStore` with keys `router:health:<env>:<service>` and pub/sub channel `router:health:events:<env>`. Resolver reads a hydrated cache (sync), writes+publishes fire-and-forget.
4. **Boot-time shared-Redis handshake** — `writeBootUuid()` on backend startup, `/_health` endpoint returns it, router probes fallback `/_health` and compares against its own Redis. Catches divergent Redis URLs.
5. **Hard-fail guard** — split/fallback mode (`environment.fallback` set) refuses to boot without Redis per §9.6 #7. Smoke-verified.
6. **`@luckystack/test-runner`** package — contract-smoke layer driven by `apiTypes.generated.ts -> apiMethodMap`. `npm run test:contract` walks every endpoint, asserts `{status, errorCode}` envelope. Deferred layers (auth, rate-limit, schema fuzz) need generator changes.

## §8 Execution Order progress — **ALL 12 STEPS ✅ (done in previous session)**

Refinement status from §34 (previous session's plan):

| # | Refinement | Status |
|---|------------|--------|
| 34.1 | WebSocket proxying | ✅ this session |
| 34.2 | Redis-backed health state | ✅ this session |
| 34.3 | Boot-time shared-Redis handshake | ✅ this session |
| NEW  | Socket.io Redis adapter (gap) | ✅ this session |
| NEW  | `@luckystack/test-runner` scaffold | ✅ this session |
| 34.4 | `responseNormalizer` split | ⏸ not started |
| 34.5 | `apiTypes.generated.ts` decoupling | ⏸ not started |
| 34.6 | Emitter re-relativizer | ⏸ not started |

## Current package map

```
@luckystack/core       (base: transport, utilities, DI, hooks, CORS, runtime validation,
                        socket Redis adapter, boot UUID)
   ↑
@luckystack/login      (auth + session; owns BaseSessionLayout, AuthProps)
   ↑
@luckystack/presence   (registers postLogout handler on core; one-way dep on login)
@luckystack/sentry     @luckystack/sync (server + client)     @luckystack/api

@luckystack/devkit     (dev-time only; external in prod bundle)
@luckystack/router     (load balancer + health store + boot handshake + WS proxy;
                        raw ioredis, no @luckystack/* runtime imports)
@luckystack/test-runner (NEW — contract-smoke tests driven by generated route map)
```

## NEXT TASK (per §35, new plan)

1. **Auth metadata in generated map** — emit `apiMetaMap` next to `apiMethodMap` with `{ method, auth: { login, additional } }`. Unlocks test-runner's auth-enforcement layer.
2. **`responseNormalizer` split** — framework `createLocalizedNormalizer({ translate })` factory; project provides translate. Design-first.
3. **`apiTypes.generated.ts` decoupling** — optional. Emitter outputs `declare module '@luckystack/core'` augmentation.
4. **Emitter re-relativizer** — if function shims ever live outside `server/functions/`, `typeof import('<relative>')` resolves wrong. Compute absolute + re-relativize.
5. **`/_health` contract → fatal** — once every service exposes `/_health`, flip the handshake from warning to throw.
6. **Rate-limit + schema-fuzz test layers** — needs per-test token issuer + Zod schema emission.

None of these are blockers; all are refinements.

## Technical State

- Branch: `chore/package-split-prep`
- `npm run lint` — clean
- `npm run build` — clean (vite 465 modules ~3.5s; dist/server.js 214.5 KB, +1.8 KB vs last session)
- `npm run router` — boots in single-instance; hard-fails without Redis in split/fallback mode (verified)
- `npm run test:contract` — new; runs contract smoke against `TEST_BASE_URL` (default `http://localhost:80`)
- New dep: `@socket.io/redis-adapter@^8.3.0`

## Router quick-reference

```bash
# dev with Redis, full functionality
npm run router

# opt out of shared-health (ignored when env.fallback is set)
# single-instance dev without Redis: unset the fallback in deploy.config.ts

# bound to a single preset (other services go straight to fallback)
LUCKYSTACK_ENV=development LUCKYSTACK_PRESET=fleet-preset npm run router
```

## Test runner quick-reference

```bash
# walk every endpoint in apiMethodMap against a running backend
npm run test:contract

# custom URL + auth cookie
TEST_BASE_URL=http://localhost:4019 TEST_AUTH_TOKEN=<token> npm run test:contract

# skip specific endpoints (known to need real input)
TEST_SKIP="settings/updateUser,system/logout" npm run test:contract
```

## Key invariants (cumulative)

- **Shim path rule**: shims use direct file paths (`../../packages/<pkg>/src/<file>`), never barrel.
- **Barrel vs direct-path rule**: within the monorepo, project-side client code and cross-package internal imports use direct file paths, not barrels.
- **Client/server barrel split rule**: packages with both slices provide `src/index.ts` (server-safe) + `src/client.ts` (React/browser). `tsconfig.server.json` excludes the `client.ts` files.
- **Script-exit rule**: tsx-run scripts importing any `@luckystack/*` barrel MUST end with `process.exit(0)`.
- **Devkit externality rule**: runtime code that needs devkit must use `await import('@luckystack/devkit')` behind `env.NODE_ENV !== 'production'`.
- **Package-listing parity rule**: every `@luckystack/*` package must be in both tsconfigs (paths + include).
- **Type ownership**: `AuthProps` + `BaseSessionLayout` in login; `HookSessionShape` in core; `SessionLayout` in project `config.ts`.
- **Hook payload ownership**: core owns api/sync; feature packages augment via `declare module '@luckystack/core' { interface HookPayloads { ... } }`.
- **Hook handler return-type rule**: `HookHandler<T>` requires `: HookResult` annotation + explicit `return undefined`.
- **Sentry split**: DI surface in core; concrete `@sentry/node` init in sentry package.
- **One-way package deps**: no circular deps. Cross-package side effects go through the core hook registry.
- **Router in its own process**: `npm run router` is a separate `tsx` invocation, not bundled with `dist/server.js`. Router reads `deploy.config.ts` + `services.config.ts` directly; does not depend on any `@luckystack/*` runtime package. Redis access uses raw ioredis.
- **WS target rule** (NEW): router forwards WebSocket upgrades to the `system` service (overridable via `wsTargetService`). Safe because every backend attaches the Socket.io Redis adapter.
- **Shared-Redis hard-fail rule** (NEW): when `environment.fallback` is set, router MUST boot with reachable Redis. `disableSharedHealthState` is ignored.
- **Boot-UUID rule** (NEW): every backend writes `luckystack:boot:<env>` on startup. `/_health` returns it. Routers cross-check to detect divergent Redis URLs.
- **Socket.io Redis adapter always on** (NEW): `attachSocketRedisAdapter(io)` runs on every backend boot. Rooms fan out across instances via pub/sub. Safe no-op in single-instance.
