# SESSION_STATE

## Session Summary
Branch `chore/package-split-prep`. After the last commit, this sitting moved client-side transport code per the user's design decision: **API client goes in `@luckystack/core`, sync client goes in `@luckystack/sync` as an additional package**.

Moves:
- `src/_sockets/offlineQueue.ts` → `packages/core/src/offlineQueue.ts` (shared by api + sync)
- Created `packages/core/src/socketState.ts` (shared mutable `socket` + `setSocket` + `incrementResponseIndex` + `waitForSocket`)
- `src/_sockets/apiRequest.ts` → `packages/core/src/apiRequest.ts`
- `src/_sockets/syncRequest.ts` → `packages/sync/src/syncRequest.ts`
- `src/_sockets/socketInitializer.ts` **stays in src/** (project glue) but now delegates socket-state ownership to core

Surfaced two new invariants:
- **Client/server barrel split rule** — packages with both slices use `src/index.ts` (server-safe) + `src/client.ts` (React/browser-coupled). Prevents the server tsconfig (no `jsx`) from pulling React code in transitively.
- **Barrel vs direct-path rule** — project-side client code and cross-package internal imports use direct file paths (`../../packages/<pkg>/src/<file>`) to avoid barrel-pulls-everything problems in Vite (no Node APIs) and server tsconfig (no JSX).

## §8 Execution Order progress

| # | Step | Status |
|---|------|--------|
| 1 | Freeze package map | ✅ |
| 2 | Hook inventory + ownership | ✅ |
| 3 | Finalize core boundaries | ✅ |
| 4 | Project-level `functions/` contract | ✅ Phase 1 |
| 5 | Extract login | ✅ |
| 6 | Extract sync | ✅ **(server + client)** |
| 7 | Extract presence | ✅ |
| 8 | Sentry package | ✅ |
| 9 | Ship devkit | ✅ (+ excluded from prod bundle) |
| 10 | Service-scoped backend build | ✅ |
| 11 | Load balancer backend | ⬜ |
| 12 | Dev forwarding to staging | ⬜ |

**Only steps 11-12 remain in the original §8 execution order.**

## Current package map

```
@luckystack/core       (base: transport, utilities, DI, hooks, CORS, runtime validation)
                        - index.ts: server-safe surface
                        - client.ts: apiRequest (React-coupled)
                        - socketState / offlineQueue: shared client primitives
   ↑
@luckystack/login      (auth + session)
   ↑
@luckystack/presence   (registers postLogout hook on core)
@luckystack/sentry     @luckystack/sync                     @luckystack/api
                        - index.ts: server handlers
                        - client.ts: syncRequest + React hooks
   (feature peers — none depend on each other)

@luckystack/devkit     (dev-time only; external in prod bundle)
```

## NEXT TASK (per §32)

1. **`server/sockets/socket.ts`** — 242 lines; stays in server/ as project glue (documented). No move needed.
2. **`responseNormalizer` split** — `createLocalizedNormalizer({ translate })` factory; project provides translate fn. Design-first.
3. **Generator `any` cleanup** — devkit emits `Record<string, any>` for function re-exports. Internal refinement.
4. **`apiTypes.generated.ts` decoupling** — emitter outputs `declare module '@luckystack/core'` instead of standalone file. Removes the deep-relative type-only imports in apiRequest/syncRequest.
5. **Load balancer + service forwarding** (§8 #11 + #12) — separate workstream.

## Technical State

- Branch: `chore/package-split-prep`
- `npm run lint` — clean
- `npm run build` — clean (vite 465 modules ~3.7s; **dist/server.js 212.7 KB**; client bundle 825.5 KB)
- Current changes unstaged since last commit

## Key invariants (cumulative)

- **Shim path rule**: shims use direct file paths (`../../packages/<pkg>/src/<file>`), never barrel.
- **Barrel vs direct-path rule**: within the monorepo, project-side client code and cross-package internal imports use direct file paths, not barrels. Prevents Vite client bundle from pulling server Node APIs, and prevents server tsconfig from pulling React/JSX code.
- **Client/server barrel split rule**: packages with both slices provide `src/index.ts` (server-safe) + `src/client.ts` (React/browser). `tsconfig.server.json` excludes the `client.ts` files. Currently applies to core and sync.
- **Script-exit rule**: tsx-run scripts importing any `@luckystack/*` barrel MUST end with `process.exit(0)`.
- **Devkit externality rule**: runtime code that needs devkit must use `await import('@luckystack/devkit')` behind `env.NODE_ENV !== 'production'`.
- **Package-listing parity rule**: every `@luckystack/*` package must be in both tsconfigs (paths + include).
- **Type ownership**: `AuthProps` + `BaseSessionLayout` in login; `HookSessionShape` in core; `SessionLayout` in project `config.ts`.
- **Hook payload ownership**: core owns api/sync; feature packages augment via `declare module '@luckystack/core' { interface HookPayloads { ... } }`.
- **Hook handler return-type rule**: `HookHandler<T>` requires `: HookResult` annotation + explicit `return undefined`.
- **Sentry split**: DI surface in core; concrete `@sentry/node` init in sentry package.
- **One-way package deps**: no circular deps. Cross-package side effects go through the core hook registry.
