# SESSION_STATE

## Session Summary
Branch `chore/package-split-prep`. After the last commit, this sitting shipped **`@luckystack/router` — the load-balancer backend**. Completes §8 steps 11 (load balancer) + 12 (dev forwarding to staging).

One `npm run router` boots a node-native HTTP proxy that:
- Parses the first route segment of each request as a service key
- Forwards to the service's URL from `deploy.config.ts -> environments[env].bindings[service]`
- Falls through to `environment.fallback`'s bindings when no local binding exists OR the local target fails health
- Returns `serviceNotAssigned` (HTTP 502) when nothing resolves
- In dev, polls local service URLs and flips health state; switches traffic to local when it comes up

Smoke-tested: `ROUTER_PORT=4019 npm run router` boots, listens, health-polls, logs correctly.

## §8 Execution Order progress — **ALL 12 STEPS NOW ✅**

| # | Step | Status |
|---|------|--------|
| 1 | Freeze package map | ✅ |
| 2 | Hook inventory + ownership | ✅ |
| 3 | Finalize core boundaries | ✅ |
| 4 | Project-level `functions/` contract | ✅ Phase 1 |
| 5 | Extract login | ✅ |
| 6 | Extract sync (server + client) | ✅ |
| 7 | Extract presence | ✅ |
| 8 | Sentry package | ✅ |
| 9 | Ship devkit | ✅ (+ excluded from prod bundle) |
| 10 | Service-scoped backend build | ✅ |
| 11 | **Load balancer backend** | ✅ **this sitting** |
| 12 | **Dev forwarding to staging** | ✅ **this sitting** |

The original packaging execution plan is complete. What remains is refinement, not new scope.

## Current package map

```
@luckystack/core       (base: transport, utilities, DI, hooks, CORS, runtime validation)
                        - index.ts / client.ts / socketState / offlineQueue
   ↑
@luckystack/login      (auth + session; owns BaseSessionLayout, AuthProps)
   ↑
@luckystack/presence   (registers postLogout handler on core; one-way dep on login)
@luckystack/sentry     @luckystack/sync (server + client)     @luckystack/api
   (feature peers — none depend on each other)

@luckystack/devkit     (dev-time only; external in prod bundle)
@luckystack/router     (load-balancer backend; separate process; consumes
                        deploy.config.ts + services.config.ts)
```

## NEXT TASK (per §34)

1. **Socket.io / websocket proxying** in the router — same resolver, handle `Upgrade: websocket`.
2. **Redis-backed health state** — share across multiple router instances. §9.6 #7 wants startup hard-fail when Redis is unavailable in split/fallback mode.
3. **Boot-time shared-Redis handshake** — UUID round-trip to catch two Redis URLs that both respond.
4. **`responseNormalizer` split** — framework `createLocalizedNormalizer({ translate })` factory.
5. **`apiTypes.generated.ts` decoupling** — optional. Emit `declare module '@luckystack/core'` augmentation.
6. **Emitter re-relativizer** — if function shims move outside `server/functions/`, the `typeof import('<relative>')` output needs absolute+re-relativize.

Nothing above is blocking the framework's core functionality; all are refinements.

## Technical State

- Branch: `chore/package-split-prep`
- `npm run lint` — clean
- `npm run build` — clean (vite 465 modules ~4.7s; dist/server.js 212.7 KB)
- `npm run router` — smoke-tested; boots, listens, health-polls
- Current changes unstaged since last commit

## Router quick-reference

```bash
# dev, default port 4000, forwards to local services, falls back to staging for unknowns
npm run router

# custom port
ROUTER_PORT=4000 npm run router

# point router at a specific env's bindings
LUCKYSTACK_ENV=staging npm run router

# bound to a single preset (other services go straight to fallback)
LUCKYSTACK_ENV=development LUCKYSTACK_PRESET=fleet-preset npm run router
```

Router config surface (already in `deploy.config.ts`):
- `routing.onMissingService` — `'hard-error'` or `'proxy-fallback'`
- `routing.missingServiceErrorCode` — defaults to `serviceNotAssigned`
- `routing.enableUnhealthyFallback` — whether unhealthy local targets fall through to fallback
- `development.enableFallbackRouting` — enables dev health polling + fallback
- `development.healthPollMs` — poll interval
- `development.switchNewTrafficToLocalWhenHealthy` — currently always on when `enableFallbackRouting` is true

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
- **Router in its own process**: `npm run router` is a separate `tsx` invocation, not bundled with `dist/server.js`. Router reads `deploy.config.ts` + `services.config.ts` directly; does not depend on any `@luckystack/*` runtime package (so it has no Redis connection of its own until §34.2 lands).
