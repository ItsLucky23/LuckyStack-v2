# SESSION_STATE

## Session Summary
Branch `chore/package-split-prep`. After the last commit, this sitting:
- Extracted `@luckystack/presence` — the activity-broadcaster lives there now. Login (logout) + server/sockets/socket.ts consume it via the barrel.
- Documented a circular `login ⇄ presence` dependency that we accept for now (logout needs to clean up presence state; presence needs login's session API). Fix sketched in §30.5.

`npm run lint` and `npm run build` pass clean. `dist/server.js` = 211.5 KB.

## §8 Execution Order progress

| # | Step | Status |
|---|------|--------|
| 1 | Freeze v1 package map | ✅ |
| 2 | Hook inventory + ownership | ✅ |
| 3 | Finalize core boundaries | ✅ |
| 4 | Project-level `functions/` contract | ✅ (Phase 1; Phase 2 pruning deferred) |
| 5 | Extract login | ✅ |
| 6 | Extract sync | ⚠️ server-side done; **client-side pending** |
| 7 | Extract presence | ✅ (this session) |
| 8 | Sentry package | ✅ |
| 9 | Ship devkit | ✅ (+ excluded from prod bundle) |
| 10 | Service-scoped backend build | ✅ (presets generate) |
| 11 | Load balancer backend | ⬜ not started |
| 12 | Dev forwarding to staging | ⬜ not started |

**Plus bonus**: `@luckystack/api` (extracted because handlers import login) and the project-level `functions/` override mechanism.

## Current package map

```
@luckystack/core       (base: transport, utilities, DI, hooks, runtime type validation)
   ↑
@luckystack/login    ⇄  @luckystack/presence    (circular — see §29 known debt)
   ↑                          ↑
@luckystack/sentry     @luckystack/sync      @luckystack/api
   (feature peers — none depend on each other)

@luckystack/devkit     (dev-time tooling; external in prod bundle)
```

**Production bundle (`dist/server.js`): 211.5 KB** (from 9.9 MB baseline before devkit exclusion).

## NEXT TASK (per §30)

1. **`server/sockets/socket.ts` review/move** — last server-side file outside packages. Decide: fold into core (transport is core's responsibility per §2.1) or make a `@luckystack/transport` package.
2. **`responseNormalizer` split** — `createLocalizedNormalizer({ translate })` factory. Design-first.
3. **Client-side sync/API split** — `socketInitializer.ts` split; `syncRequest.ts` + `offlineQueue.ts` → sync client slice; `apiRequest.ts` → api client slice. Design-first.
4. **Login ⇄ presence circular fix** — move logout's presence-state cleanup into a `postLogout` hook handler registered by presence at init. Makes presence a one-way dependent on login.
5. **Devkit type-emitter cleanup** — `Record<string, any>` → resolved types.
6. **Load balancer + service forwarding** (§8 steps 11-12) — separate workstream.

## Technical State

- Branch: `chore/package-split-prep`
- `npm run lint` — clean
- `npm run build` — clean (vite 462 modules ~3.8s; dist/server.js 211.5 KB)
- Current changes unstaged since last commit

## Key invariants (still in force)

- **Shim path rule**: shims use direct file paths (`../../packages/<pkg>/src/<file>`), never barrel.
- **Script-exit rule**: tsx-run scripts that import any `@luckystack/*` barrel MUST end with `process.exit(0)` (Redis connection holds event loop open).
- **Devkit externality rule**: runtime code that needs devkit must use `await import('@luckystack/devkit')` behind `env.NODE_ENV !== 'production'`. Static imports bundle it in.
- **Package-listing parity rule**: every `@luckystack/*` package must be listed in both tsconfigs (paths + include) — eslint-plugin-import-x fails on one-sided aliases.
- **Type ownership**: `AuthProps` + `BaseSessionLayout` in login; `HookSessionShape` in core (structurally compatible); `SessionLayout` in project `config.ts` (extends Prisma `User`).
- **Hook payload ownership**: core owns api/sync; feature packages augment via `declare module '@luckystack/core' { interface HookPayloads { ... } }`.
- **Sentry split**: DI surface in core; concrete `@sentry/node` init in sentry package.
