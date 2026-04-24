# SESSION_STATE

## Session Summary
Branch `chore/package-split-prep`. After the last commit, this sitting:
- Broke the `login ⇄ presence` circular dependency via a `postLogout` hook handler registered by presence at server startup. Login no longer imports from presence.
- Moved `server/auth/checkOrigin.ts` (CORS allow-list) into `@luckystack/core`.

`npm run lint` + `npm run build` clean. `dist/server.js` = 212.2 KB.

## §8 Execution Order progress

| # | Step | Status |
|---|------|--------|
| 1 | Freeze package map | ✅ |
| 2 | Hook inventory + ownership | ✅ |
| 3 | Finalize core boundaries | ✅ |
| 4 | Project-level `functions/` contract | ✅ Phase 1 |
| 5 | Extract login | ✅ |
| 6 | Extract sync | ⚠️ server-side done; **client-side pending** |
| 7 | Extract presence | ✅ |
| 8 | Sentry package | ✅ |
| 9 | Ship devkit | ✅ (+ excluded from prod bundle: 212 KB) |
| 10 | Service-scoped backend build | ✅ |
| 11 | Load balancer backend | ⬜ |
| 12 | Dev forwarding to staging | ⬜ |

## Current package map (post-circular-fix)

```
@luckystack/core       (base: transport, utilities, DI, hooks, CORS allowlist, runtime type validation)
   ↑
@luckystack/login      (auth + session; owns BaseSessionLayout, AuthProps)
   ↑
@luckystack/presence   (registers `postLogout` handler on core; imports login APIs)
@luckystack/sentry     @luckystack/sync     @luckystack/api
   (feature peers — none depend on each other)

@luckystack/devkit     (dev-time only; external in prod bundle)
```

All dependencies are now one-way. No circular.

## NEXT TASK (per §31)

1. **`server/sockets/socket.ts`** — 242 lines of project-specific socket.io wiring. Likely stays in server/ as project glue (mixes transport + session room persistence + location provider + activity broadcaster; too entangled for a clean framework extraction without a big refactor).
2. **`responseNormalizer` split** — `createLocalizedNormalizer({ translate })` factory; project provides translate. Design-first.
3. **Client-side sync/API split** — `socketInitializer.ts` split; `syncRequest.ts` + `offlineQueue.ts` → sync client slice; `apiRequest.ts` → api client slice. Design-first.
4. **Devkit type-emitter cleanup** — `Record<string, any>` → resolved types in generated Functions map.
5. **Load balancer + service forwarding** (§8 steps 11-12) — separate workstream.

## Technical State

- Branch: `chore/package-split-prep`
- `npm run lint` — clean
- `npm run build` — clean (vite 462 modules ~3.7s; dist/server.js 212.2 KB)
- Current changes unstaged since last commit

## Key invariants (still in force)

- **Shim path rule**: shims use direct file paths (`../../packages/<pkg>/src/<file>`), never barrel.
- **Script-exit rule**: tsx-run scripts that import any `@luckystack/*` barrel MUST end with `process.exit(0)`.
- **Devkit externality rule**: runtime code that needs devkit must use `await import('@luckystack/devkit')` behind `env.NODE_ENV !== 'production'`.
- **Package-listing parity rule**: every `@luckystack/*` package must be in both tsconfigs (paths + include) — eslint import-x requires it.
- **Type ownership**: `AuthProps` + `BaseSessionLayout` in login; `HookSessionShape` in core; `SessionLayout` in project `config.ts`.
- **Hook payload ownership**: core owns api/sync; feature packages augment via `declare module '@luckystack/core' { interface HookPayloads { ... } }`.
- **Hook handler return-type rule**: `HookHandler<T>` requires `HookResult | Promise<HookResult>` (where `HookResult = undefined | HookStopSignal`). Use `: HookResult` annotation + explicit `return undefined` — a plain `void`-returning function is rejected by strict TS.
- **Sentry split**: DI surface in core; concrete `@sentry/node` init in sentry package.
- **One-way package deps**: no circular deps between packages. Cross-package side effects (like logout needing to clean up presence state) go through the core hook registry.
