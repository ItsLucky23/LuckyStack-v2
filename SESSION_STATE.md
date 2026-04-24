# SESSION_STATE

## Session Summary
Branch `chore/package-split-prep`. This sitting closes every item from §35's refinement plan. The original split→ship packaging arc is done; what's left is scope expansion (real fuzz via Zod, monitoring package, NPM publishability audit), not missing foundations.

Seven changes landed:

1. **Auth metadata in generated map** — `apiMetaMap` emits `{ method, auth, rateLimit }` per endpoint alongside `apiMethodMap`. Reuses the existing `extractAuth` AST walker.
2. **Auth-enforcement test layer** — `runAuthEnforcementTests` walks `auth.login: true` endpoints, expects `auth.required` without a session. CLI: `npm run test:auth`.
3. **`responseNormalizer` split** — `createLocalizedNormalizer({ translate })` factory in `@luckystack/core`. Project registers on boot via `registerLocalizedNormalizer`. Framework packages (`@luckystack/api`, `sync`) now import `normalizeErrorResponse` / `extractLanguageFromHeader` from core — no more deep-reaching into `server/utils/…`.
4. **`apiTypes.generated.ts` decoupling** — generator emits `declare module '@luckystack/core' { interface ApiTypeMap extends _ProjectApiTypeMap {} }` augmentation. `apiRequest.ts` / `syncRequest.ts` now import types from core instead of the deep-relative generated file.
5. **Emitter re-relativizer** — `typeof import('<relative>')` specifiers are now resolved + re-relativized to the generated file's directory. Shims at any depth produce working imports.
6. **Rate-limit + fuzz test layers** — `runRateLimitTests` fires N+1 requests and expects `api.rateLimitExceeded`; `runFuzzTests` sends junk payloads and asserts no 5xx, envelope preserved. CLIs: `test:rate-limit`, `test:fuzz`. Schema-driven fuzz still deferred (needs Zod emission).
7. **Boot handshake strict mode** — new `routing.strictBootHandshake` flag in `deploy.config.ts`. Warning-only by default; flip to `true` per-deployment once `/_health` is universal.

## §8 Execution Order progress — **ALL 12 STEPS ✅ (two sessions ago)**

Refinement status from §35:

| # | Refinement | Status |
|---|------------|--------|
| 35.1 | Auth metadata in generated map | ✅ this session |
| 35.2 | Auth-enforcement test layer | ✅ this session |
| 35.3 | `responseNormalizer` split | ✅ this session |
| 35.4 | `apiTypes.generated.ts` decoupling | ✅ this session |
| 35.5 | Emitter re-relativizer | ✅ this session |
| 35.6 | Rate-limit + fuzz test layers | ✅ this session (schema-driven fuzz deferred) |
| 35.7 | `/_health` → fatal (opt-in) | ✅ this session (flag-based) |

## Current package map

```
@luckystack/core       (base: transport, utilities, DI, hooks, CORS, runtime validation,
                        socket Redis adapter, boot UUID, apiTypeStubs, localizedNormalizer)
   ↑
@luckystack/login      (auth + session; owns BaseSessionLayout, AuthProps)
   ↑
@luckystack/presence   (registers postLogout handler on core; one-way dep on login)
@luckystack/sentry     @luckystack/sync (server + client)     @luckystack/api

@luckystack/devkit     (dev-time only; external in prod bundle; emitter re-relativizer)
@luckystack/router     (load balancer + health store + boot handshake + WS proxy;
                        raw ioredis, no @luckystack/* runtime imports)
@luckystack/test-runner (contract + auth + rate-limit + fuzz layers, all driven by
                        apiTypes.generated.ts)
```

## NEXT TASK (per §36 in packaging doc)

Original arc is closed. Forward items are scope expansions, not foundations:

1. **Zod/JSON-schema emission** — generator emits runtime schemas; unlocks property-based fuzz via `fast-check`.
2. **`clearAllRateLimits()` test hook** — expose a dev-only `/_test/reset` so test runners can drain limiter state between runs.
3. **NPM publishability audit** — grep for every remaining deep-relative import from `packages/**` into project files. Should be near zero after §35.4.
4. **Shared-secret sync checks** — enforce `synchronizedEnvKeys` from `deploy.config.ts` at the same pass as the Redis UUID handshake.
5. **`@luckystack/web-vitals`** — client-side RUM (§15 backlog).
6. **`@luckystack/monitoring`** — dual-stream Sentry + audit trail (§15 backlog, needs self-host-vs-SaaS decision).

## Technical State

- Branch: `chore/package-split-prep`
- `npm run lint` — clean
- `npm run build` — clean (`dist/server.js` 211.9 KB — down 2.6 KB vs last session because `server/utils/responseNormalizer.ts` no longer drags a duplicate of the core module into the bundle)
- `npm run router` — boots in split/fallback mode when Redis is up
- Test runner CLIs: `test:contract`, `test:auth`, `test:rate-limit`, `test:fuzz`

## Test runner quick-reference

```bash
# contract smoke: every endpoint returns {status, errorCode} envelope
npm run test:contract

# auth enforcement: auth.login:true endpoints reject with auth.required
npm run test:auth

# rate limit: N+1 requests hit api.rateLimitExceeded
TEST_MAX_RATE_LIMIT=50 npm run test:rate-limit

# fuzz: junk payloads don't 5xx and stay in envelope
TEST_AUTH_TOKEN=<cookie> npm run test:fuzz

# shared env:
TEST_BASE_URL=http://localhost:4019
TEST_SKIP="settings/updateUser,system/logout"   # comma-separated <page>/<name>
TEST_SESSION_COOKIE_NAME=luckystack_token
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
- **WS target rule**: router forwards WebSocket upgrades to the `system` service (overridable via `wsTargetService`). Safe because every backend attaches the Socket.io Redis adapter.
- **Shared-Redis hard-fail rule**: when `environment.fallback` is set, router MUST boot with reachable Redis. `disableSharedHealthState` is ignored.
- **Boot-UUID rule**: every backend writes `luckystack:boot:<env>` on startup. `/_health` returns it. Routers cross-check to detect divergent Redis URLs.
- **Socket.io Redis adapter always on**: `attachSocketRedisAdapter(io)` runs on every backend boot. Rooms fan out across instances via pub/sub. Safe no-op in single-instance.
- **Normalizer registration rule** (NEW): framework packages call `normalizeErrorResponse` / `extractLanguageFromHeader` from `@luckystack/core`. The project MUST side-effect-import the module that calls `registerLocalizedNormalizer` on startup, or framework errors fall back to identity translate (returns the errorCode key as the message).
- **Augmentation-load rule** (NEW): the `declare module '@luckystack/core'` augmentation in `src/_sockets/apiTypes.generated.ts` is a side-effect type load. Any file that imports from the generated file pulls it into the compilation. If no file imports it, `ApiTypeMap` stays empty.
- **Boot handshake strict flag** (NEW): `deploy.config.ts -> routing.strictBootHandshake` is warning-only by default. Flip to `true` per-deployment once `/_health` is universal.
