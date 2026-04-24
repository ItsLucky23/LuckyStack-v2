# SESSION_STATE

## Session Summary
Branch `chore/package-split-prep`. After the last commit, this sitting:
- Excluded `@luckystack/devkit` entirely from the production bundle (**97.8% size reduction: 9.9 MB → 212 KB**) by making `server/prod/runtimeMaps.ts` lazy-import the devkit via `await import('@luckystack/devkit')`, adding the package to esbuild's `external` list, and consolidating the two dev imports in `server/server.ts` into one devkit barrel import.
- Deleted the redundant `server/functions/tryCatch.ts` wrapper; the one remaining caller (`src/settings/_api/updateUser_v1.ts`) now imports `tryCatch` directly from `@luckystack/core`.
- Added two explanatory `eslint-disable-next-line` comments in `updateUser_v1.ts` for pre-existing `any`-type issues that surfaced when the eslint cache was invalidated.
- Added `@luckystack/devkit` to `tsconfig.client.json` paths for eslint import-x resolver consistency.

`npm run lint` and `npm run build` pass clean.

## Completed on this branch (cumulative)

**Core (`@luckystack/core`):**
- `shared/` utilities, env/db/redis bootstrap, 11 server utilities, hooks registry (augmentable), `runtimeTypeValidation`

**Login (`@luckystack/login`):**
- session/login/loginConfig/logout + `sessionLayout.ts` (owns `BaseSessionLayout`, `AuthProps`) + `hookPayloads.ts` (augments `HookPayloads`)

**Sync (`@luckystack/sync`):** `handleSyncRequest`, `handleHttpSyncRequest`

**API (`@luckystack/api`):** `handleApiRequest`, `handleHttpApiRequest`

**Sentry (`@luckystack/sentry`):** `sentry.ts` (concrete `@sentry/node` wiring; DI surface stays in core)

**Devkit (`@luckystack/devkit`):** `server/dev/**` (21 files) + `runtimeTypeResolver`. **Not in prod bundle** — external in esbuild, lazy-imported behind `NODE_ENV !== 'production'` guards.

**Other cleanups:**
- `server/functions/game.ts` replaced by project-level `functions/game.ts`
- `server/functions/tryCatch.ts` deleted (redundant wrapper)
- All originals left as one-liner re-export shims (direct file paths)

## Package dependency layers

```
@luckystack/core      (base: transport, utilities, DI surfaces, hooks, runtime type validation)
   ↑
@luckystack/login     (auth + session; owns BaseSessionLayout, AuthProps; augments HookPayloads)
   ↑
@luckystack/sentry    @luckystack/sync    @luckystack/api
   (feature peers — none depend on each other)

@luckystack/devkit    (dev-time tooling; external in prod bundle; peer packages only at dev time)
```

Production bundle (`dist/server.js`): **211.7 KB**. Devkit internals (typescript compiler, type emitter, hot reload, etc.) fully excluded.

## NEXT TASK (per §29)

1. **`server/sockets/socket.ts` + `activityBroadcaster.ts` review** — decide: `@luckystack/transport` or fold socket.ts into core. `activityBroadcaster.ts` → likely `@luckystack/presence`.
2. **`responseNormalizer` split** — framework `createLocalizedNormalizer({ translate })` factory, project wires up its own translate fn. Design-first.
3. **Client-side sync/API split** — `socketInitializer.ts` transport vs callback registries; `syncRequest.ts` + `offlineQueue.ts` → sync client slice; `apiRequest.ts` → api client slice. Design-first.
4. **Generator `any` cleanup** — devkit type-map emitter emits `Record<string, any>` for function re-exports (see `Functions.db.prisma: any` in the generated `apiTypes.generated.ts`). Devkit internal improvement; would drop the `eslint-disable` comments from `updateUser_v1.ts` and any future callers.
5. **`@luckystack/presence`** — after the socket and activity-broadcaster split.

## Technical State

- Branch: `chore/package-split-prep`
- `npm run lint` — clean
- `npm run build` — clean (vite 462 modules ~3.9s; **dist/server.js 211.7 KB**)
- Current changes unstaged since last commit

## Key invariants (still in force)

- **Shim path rule**: shims use direct file paths (`../../packages/<pkg>/src/<file>`), never barrel.
- **Script-exit rule**: tsx-run scripts that import any `@luckystack/*` barrel MUST end with `process.exit(0)` — the core barrel opens a Redis connection that keeps the event loop alive.
- **Devkit externality rule**: all runtime code that needs devkit must use `await import('@luckystack/devkit')` behind an `env.NODE_ENV !== 'production'` guard. Static imports OR non-alias paths bundle devkit into prod.
- **Type ownership**: `AuthProps` + `BaseSessionLayout` in login; `HookSessionShape` in core (structurally compatible); `SessionLayout` in project `config.ts`.
- **Hook payload ownership**: core owns api/sync payloads; feature packages add their own via `declare module '@luckystack/core' { interface HookPayloads { ... } }` in their own `hookPayloads.ts` + side-effect import from `index.ts`.
- **Sentry split**: DI surface (`initSharedSentry` + `captureException`/etc.) in core; concrete `@sentry/node` init in `@luckystack/sentry`. Framework code calls `captureException` via core, so core never depends on sentry.
- **Package-listing parity rule**: every `@luckystack/*` package must appear in both `tsconfig.server.json` and `tsconfig.client.json` paths + include — eslint-plugin-import-x's typescript resolver fails on aliases that exist in only one.
