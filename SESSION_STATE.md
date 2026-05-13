# SESSION_STATE — 2026-05-13

## Session Summary

This session covered four arcs in one continuous block of work: (1) flipped all 12 `@luckystack/*` packages to `private: false` + Tier-A status (including promoting `devkit` from Tier-B and bumping it to `0.1.0`), (2) expanded the playground page with full demo sections for hooks, settings, auth/CSRF, health endpoints, file upload, offline queue, presence, and `streamTo` (token-targeted streaming), (3) shipped a complete starter into the `create-luckystack-app` template — login/register/reset-password/settings pages, all 7 settings APIs, full `_components/` + `_functions/` + `_locales/`, plus the `server/hooks/notifications.ts` and `shared/tryCatch.ts` glue, and (4) restructured the template + dogfood `src/` so framework-React plumbing (Middleware, Router, AvatarProvider, LocationProvider, TranslationProvider, ThemeToggler-as-`useTheme()`, i18n-backed notify, SessionContext) now lives in `@luckystack/core/client` and `@luckystack/presence/client` — the user-facing scaffold dropped from 16+7 files to 9+3 files. All 13 packages still build green; client + server tsc both clean.

### Second arc — devkit hot reload + rate-limit kill switch

A separate stretch in the same day diagnosed the dev-server freeze the user kept hitting when AI bursts saved many files at once (server became unresponsive, even Ctrl+C queued). Root cause: the hot reload pipeline ran fully synchronously on the main event loop — `createRequire().require()` for module reload, `ts.createProgram(...)` for every type-map regen, plus a full re-walk of the import dependency graph per save. Approach (per approved plan `~/.claude/plans/refine-dit-plan-nog-lazy-walrus.md`): incremental, no worker threads, no build/publish-shape changes. Outcome: async ESM `import()` with `?v=<ts>` cachebust replaces sync `require`; type-map regen now coalesced + fire-and-forget via `setImmediate`; import graph memoized by mtime; explicit `SIGINT`/`SIGTERM` handler added to dev boot. As bonus, a global `rateLimiting.enabled` kill-switch was added to `ProjectConfig` for local dev / load tests, short-circuited centrally in `checkRateLimit` + `getRateLimitStatus`. All devkit + core + server + root builds remain green; `npm pack --dry-run` for `@luckystack/devkit` produces an identical 7-file tarball (no shape drift).

## Completed Tasks

**Tier-A flip + docs sync:**
- All 12 packages: `private: false` + `publishConfig.access: public` added (`packages/*/package.json`).
- `@luckystack/devkit` bumped `0.0.1` → `0.1.0`; description rewritten to drop "Tier-B" language; README rewritten with install + CLI table (`packages/devkit/package.json`, `packages/devkit/README.md`).
- `docs/ARCHITECTURE_PACKAGING.md` — tier table updated: `@luckystack/login` now A (DI'd via `userAdapter`), `@luckystack/devkit` now A (DI'd via `registerLocaleReloader`); "current state" header refreshed to 2026-05-13.
- `server/functions/sentry.ts` re-pointed at `@luckystack/error-tracking` (previously imported stale `packages/sentry/src/sentry`).
- Stale `packages/sentry/dist/` cleanup (left over from the earlier rename).
- `node scripts/buildPackages.mjs --pack-dry-run` — 13/13 succeed, tarballs validated.

**Playground extensions (in `src/playground/`):**
- New `_api/throwError_v1.ts` (demos `apiError` hook), `_api/spam_v1.ts` (rateLimit: 3, demos `rateLimitExceeded`), `_sync/throwSync_server_v1.ts` (demos `syncError`), `_sync/streamToToken_server_v1.ts` (demos `streamTo` to specific socket-ids).
- `src/playground/page.tsx` gained sections: Auth & CSRF & OAuth providers, Settings flows, Hooks demo, Health & test-reset, File upload (via `processUpload`), Offline queue (disconnect/reconnect + live queue size poll), Presence & session observer, plus a streamTo target-input row with "Copy my socket id" helper.
- `src/playground/page.tsx`: `LogEntry.channel` widened with `auth | settings | health | upload | offline | hook` channels.

**Hook audit (no code changes — all were already wired):**
- Verified dispatch sites in code: `csrfMismatch` (`packages/server/src/httpRoutes/csrfMiddleware.ts:40`), `preEmailSend`/`postEmailSend` (`packages/email/src/sendEmail.ts:40,50`), `preSessionRefresh`/`postSessionRefresh` (`packages/login/src/session.ts:145,156`), `preApiRespond`/`postApiRespond` (api handlers), `onUploadStart`/`onUploadComplete` (`packages/core/src/processUpload.ts:54,70`), `preErrorNormalize`/`postErrorNormalize` (`packages/core/src/localizedNormalizer.ts:135,159`).

**TESTING_PLAN.md updates:**
- §3.6 multi-instance router expanded from 4 lines to 6 detailed test scenarios (boot UUID handshake, synchronizedEnvKeys mismatch, health-poll switchover, per-preset routing, preset bundle selection).
- §4.5 streamTo test added (two tabs, copy socket id, fire streamTo, verify only targets receive).
- New §4.10–§4.16 for the playground extensions (hooks, settings, auth/CSRF, health, upload, offline, presence).
- §5 deferred list updated: csrfMismatch already wired; monitoring decision documented.

**README.md root:**
- Already led with `npx create-luckystack-app` install; cleaned stale `packages/sentry/` reference (renamed to `error-tracking/`); removed Tier-B labels from devkit/router lines.

**Complete starter shipped in scaffolder template (`packages/create-luckystack-app/template/`):**
- Pages: `src/login/page.tsx`, `src/register/page.tsx`, `src/reset-password/page.tsx`, `src/settings/page.tsx`, plus the existing `dashboard/page.tsx`.
- APIs: `src/_api/{session,logout}_v1.ts`; `src/reset-password/_api/{sendReset,confirmReset}_v1.ts`; all 7 `src/settings/_api/*.ts`.
- Server hook glue: `server/hooks/notifications.ts` (transactional email triggers).
- `shared/tryCatch.ts` (client-safe stub, no Sentry coupling).
- `src/index.css` (Tailwind 4 `@theme` block); `postcss.config.mjs`; `vite.config.ts` extended with `vite-tsconfig-paths`.
- `template/package.json` — added: sharp, validator, fontawesome (5 entries), sonner, plus dev deps tailwindcss + @tailwindcss/postcss + postcss + vite-tsconfig-paths.
- `template/tsconfig.json` — added `config` path alias.

**Framework-React migration to `@luckystack/core/client`:**
- New `packages/core/src/localesRegistry.ts` — `registerLocales` / `getRegisteredLocales` / `getDefaultLocale` / `registerLanguageSource` / `getActiveLanguage` / `getLocaleByCode`.
- New `packages/core/src/middlewareRegistry.ts` — `registerMiddlewareHandler` / `getMiddlewareHandler` + `MiddlewareInput`/`MiddlewareHandler`/`MiddlewareResult` types.
- New `packages/core/src/react/` folder: `sessionContext.ts` (`SessionContext`, `useSession<T>()`, `setLatestSession`, `getCurrentSession`), `AvatarProvider.tsx`, `useTheme.ts`, `TranslationProvider.tsx` (folds in `useTranslator` + `translate` helpers), `notify.ts` (i18n-backed, auto-registers), `Middleware.tsx`, `Router.tsx` (`useRouter` hook).
- `packages/core/src/client.ts` extended with re-exports of all the new react/* and registry surface.
- `packages/core/src/projectConfig.ts` — added `defaultTheme?: 'light' \| 'dark'` field + default value.
- `packages/core/package.json` — added react / react-dom / react-router-dom / sonner as optional peerDeps.
- New `packages/presence/src/client/LocationProvider.tsx` + export from `packages/presence/src/client/index.ts`.

**Template restructure (after framework moves):**
- DELETED from `template/src/_components/`: Navbar, Middleware, AvatarProvider, Router, LocationProvider, ThemeToggler, TranslationProvider.
- DELETED from `template/src/_functions/`: sentry, icon, notify, translator.
- MOVED: Dropdown trio into `template/src/_components/dropdown/`; TemplateProvider into `template/src/_components/templates/`.
- NEW: `template/src/_components/templates/Home.tsx` (sample 'home' layout — no Navbar, just header + Middleware-wrapped content).
- NEW: `template/luckystack/i18n/locales.ts` (registers JSON locales + language source).
- `template/src/main.tsx` rewritten: imports from `@luckystack/core/client` / `@luckystack/presence/client`, side-effect imports `luckystack/i18n/locales`, registers middlewareHandler.
- `template/src/_providers/SessionProvider.tsx` rewritten: writes into core's `SessionContext`, mirrors to `setLatestSession`, drops Sentry coupling.
- `template/src/settings/page.tsx`: `template = 'home'` (was 'dashboard'); imports refactored to `@luckystack/core/client`.
- `template/README.md` rewritten to describe the new layout: what user owns vs what framework owns.
- TemplateProvider in template renamed templates from `'dashboard' | 'plain'` → `'home' | 'plain'`.

**Dogfood migration in this repo (`src/`):**
- DELETED: `src/_components/{Middleware,Router,AvatarProvider,LocationProvider,ThemeToggler,TranslationProvider}.tsx`.
- DELETED: `src/_functions/{notify,translator}.ts`.
- KEPT (project-specific): `src/_components/Navbar.tsx`, `src/_functions/sentry.ts`, `src/_functions/icon.ts`.
- Updated imports in: `src/main.tsx`, `src/_providers/SessionProvider.tsx`, `src/_sockets/socketInitializer.ts`, `src/_functions/middlewareHandler.ts`, `src/_components/{ConfirmMenu,ErrorPage,Avatar,Navbar,TemplateProvider,LoginForm}.tsx`, `src/{admin,dashboard,docs,reset-password,settings}/page.tsx`.
- `src/_functions/middlewareHandler.ts`: re-typed to match core's `MiddlewareHandler` signature.
- `tsconfig.server.json`: added `packages/core/src/react/**/*` to exclude list (JSX file in server compile context).

**Hot reload non-blocking refactor (`packages/devkit/` + `packages/server/`):**
- `packages/devkit/src/loader.ts`: dropped `createRequire(import.meta.url)` + CJS-cache loop; new `importFile()` uses `pathToFileURL(absolutePath).href + '?v=' + Date.now()` with dynamic `import()`. Module load now yields to the event loop during parse/transpile.
- `packages/devkit/src/hotReload.ts`: introduced `typeMapQueue` + `requestTypeMapRegeneration()` + `runTypeMapRegeneration()` that coalesces concurrent requests into a single background `setImmediate` task and logs `[HotReload] type map ready in Xms`. Every inline `await tryCatch(() => generateTypeMapFile({ quiet: true }))` inside `processPendingApiChanges`, `processPendingSyncChanges`, `handleChange`, `handleDelete`, `handleFunctionChange`, and the sync-server template-injection branch replaced with `requestTypeMapRegeneration()`. Startup `generateTypeMapFile()` (line ~508) deliberately left synchronous-on-boot. Removed `clearModuleCache(...)` helper + its single caller in `enqueueAffectedRoutesFromDependency` (the ESM `?v=` cachebust replaces it).
- `packages/devkit/src/importDependencyGraph.ts`: `extractImportSpecifiers` now memoizes per-file by mtime in `specifiersCache: Map<string, {mtimeMs, specifiers}>`; `collectScopedFiles` caches its `Set<string>` for `SCOPED_FILES_TTL_MS = 1000`; new export `invalidateGraphForFile(absolutePath)` for the watcher to call on add/change/unlink (wired in all four `handleAdd`/`handleChange`/`handleDelete`/`handleFunctionChange` handlers).
- `packages/server/src/createServer.ts`: added `process.once('SIGINT', () => process.exit(0))` + `process.once('SIGTERM', () => process.exit(0))` inside the `if (enableDevTools)` block immediately after `devkit.setupWatchers()`. Ctrl+C now reliable even mid-typecheck.
- Build verified: `npm --workspace packages/devkit run build` + `npm --workspace packages/server run build` + `npm run build` (root) all green. `npm --workspace packages/devkit pack --dry-run` reports same 7-file tarball shape as baseline (README, validateDeploy.js+map, index.d.ts, index.js+map, package.json) — no new entries, no missing entries.

**Rate-limit kill-switch (`packages/core/`):**
- `packages/core/src/projectConfig.ts`: added `enabled: boolean` to `RateLimitingConfig` interface (with JSDoc explaining global kill-switch semantics); added `enabled: true` to `DEFAULT_PROJECT_CONFIG.rateLimiting` so existing consumers keep current behavior.
- `packages/core/src/rateLimiter.ts`: added `isRateLimitingEnabled()` getter + `buildAllowedResult(limit)` helper; both `checkRateLimit` and `getRateLimitStatus` short-circuit to `buildAllowedResult(limit)` when disabled — counters untouched, no Redis roundtrip. Centralized so all 5 callsites (api/sync handlers + `authApiRoute.ts`) are covered automatically.
- Consumer opt-in: set `rateLimiting: { enabled: false }` (or e.g. `enabled: process.env.NODE_ENV === 'production'`) inside the project's `registerProjectConfig({...})` call.
- `npm --workspace packages/core run build` green.

**Plan + design artifacts:**
- New plan file: `~/.claude/plans/refine-dit-plan-nog-lazy-walrus.md` — approved by user before implementation. Documents context, surgical approach (no worker threads, no tsup/package.json changes), critical files, deliberate non-changes for publish safety, reused utilities, and verification checklist.

## Pending Logic / Known Bugs

- **`npm run server` smoke test** — never run on this branch since the early `bootstrapLuckyStack` migration. Highest risk unverified change.
- **`npm org create luckystack`** — scope still not registered on npm (memory entry tracks this).
- **`LUCKYSTACK_BUNDLE` startup assertion** — `packages/server/src/runtimeMapsLoader.ts` falls back to `'default'` silently if the env var is unset. In production this could 30-min outage you. Need a refuse-to-boot guard when `NODE_ENV === 'production'` and the env var is missing.
- **Tarball install smoke test** — `npm pack` each Tier-A package + install into a clean test directory; confirm types + runtime resolve.
- **`@luckystack/core/client` peer deps marked optional** — react/react-dom/react-router-dom/sonner are `peerDependenciesMeta.optional: true`. That's correct for server-only consumers but means client consumers won't get install warnings if they forget react. Acceptable trade-off but worth a note in the README.
- **The `i18nNotify` export from `@luckystack/core/client`** triggers `registerNotifier` as a side-effect on any import from the client barrel. The sonner import lands in any bundle that imports from `@luckystack/core/client` — tree-shaking depends on the bundler. Not a bug but a tradeoff that's worth flagging.
- **`@luckystack/monitoring`** — not in this monorepo; per memory entry, ships as its own GitHub repo + thin adapter (web-vitals folds in as subpath). No work this session.

**Hot reload + rate-limit arc:**
- **Live dev-server smoke test not yet run.** Build is green and `pack --dry-run` shape is identical, but the user hasn't yet started `npm run dev` and observed the new behavior end-to-end. Expected log shape after a save: `[HotReload] API reloaded: <path>` (fast) followed shortly by `[HotReload] type map ready in Xms` asynchronously.
- **Burst-save behavior unverified.** Theory: 20+ files saved at once → server keeps responding throughout, single coalesced type-map regen at the end. Worth confirming with a search-replace burst on the playground APIs.
- **Burst coalescing nuance.** `requestTypeMapRegeneration()` may run twice in a worst-case burst (one immediate + one re-run from `pending=true`). The pre-existing `scheduleReload('typemap', ...)` debounce wrappers still front the helper for non-burst paths, so this is acceptable; revisit only if log noise becomes annoying.
- **ESM module cache growth.** Each `import(url + '?v=' + Date.now())` keeps the prior module alive in the ESM registry. For dev sessions this is negligible (process is recycled), but worth flagging if anyone runs a long-lived dev process for hours of heavy churn.
- **No template wiring for `rateLimiting.enabled`.** The `create-luckystack-app` template `config.ts` does not yet show the new field. Default `true` is safe; if we want consumers to discover the toggle, add a commented-out example to the template.

## Exact Next Step

Run `npm run server` from the repo root (after `npm run generateArtifacts` if you haven't generated since the latest route additions). Open `http://localhost:5173/login`, register a new account, navigate to `/settings`, change the avatar (verify upload + `onUploadStart`/`onUploadComplete` hooks fire in server log), then to `/playground`, click `Sync stream (originator-only)` and `Sync broadcastStream` in two tabs to confirm streaming still works after the framework-React move. If anything 500s or the playground page doesn't render, the most likely suspect is the `registerLanguageSource` wiring in `src/main.tsx` — it relies on `getCurrentSession()` from `src/_providers/SessionProvider.tsx` which now writes into core's `SessionContext` via `setLatestSession`; if the side-effect import order is wrong the language source returns null and translations fall back to `defaultLanguage`.

**Also for the hot-reload arc:** while the dev server is up, edit `src/playground/_api/spam_v1.ts` and save — watch the terminal. You should see `[HotReload] API reloaded: ...` (sub-100ms) followed asynchronously by `[HotReload] type map ready in Xms`. Then trigger a curl/browser call to a *different* API immediately after a save and confirm the response returns within normal latency (no multi-second stall). Finally, save 10+ API files in one burst (find/replace a no-op string across `src/playground/_api/*.ts`) and confirm the server keeps responding throughout and the type map regenerates once at the end. Press Ctrl+C during a burst to verify the new SIGINT handler exits the process within < 500 ms.

## Technical State

### Files modified this session (one-line each)

**New files:**
- `packages/core/src/localesRegistry.ts` — locale + language source registry
- `packages/core/src/middlewareRegistry.ts` — middleware handler registry
- `packages/core/src/react/{sessionContext.ts,AvatarProvider.tsx,useTheme.ts,TranslationProvider.tsx,notify.ts,Middleware.tsx,Router.tsx}` — framework-React surface
- `packages/presence/src/client/LocationProvider.tsx` — moved from template
- `src/playground/_api/throwError_v1.ts`, `src/playground/_api/spam_v1.ts`, `src/playground/_sync/throwSync_server_v1.ts`, `src/playground/_sync/streamToToken_server_v1.ts` — playground demo routes
- `packages/create-luckystack-app/template/luckystack/i18n/locales.ts` — locale registration overlay
- `packages/create-luckystack-app/template/server/hooks/notifications.ts` — copied for changePassword email trigger
- `packages/create-luckystack-app/template/shared/tryCatch.ts` — client-safe stub
- `packages/create-luckystack-app/template/postcss.config.mjs` — Tailwind 4 PostCSS plugin
- `packages/create-luckystack-app/template/src/index.css` — Tailwind 4 `@theme` block
- `packages/create-luckystack-app/template/src/_components/templates/Home.tsx` — sample 'home' layout
- `packages/create-luckystack-app/template/src/{login,register,reset-password,settings,_api,_components,_functions,_providers,_locales}/**` — full starter

**Modified:**
- 12 × `packages/*/package.json` — `private: false` + `publishConfig.access`
- `packages/devkit/package.json` — version bump + description rewrite
- `packages/devkit/README.md` — Tier-A install instructions
- `packages/core/package.json` — react/sonner peerDeps added (optional)
- `packages/core/src/projectConfig.ts` — `defaultTheme` field added
- `packages/core/src/client.ts` — re-exports for new react/* + registries
- `packages/presence/src/client/index.ts` — re-export LocationProvider
- `docs/ARCHITECTURE_PACKAGING.md` — tier table + status header
- `TESTING_PLAN.md` — §3.6 multi-instance router, §4.5 streamTo, §4.10–§4.16 new playground sections, §5 deferred update
- `README.md` — clean stale `packages/sentry/` + Tier-B labels
- `tsconfig.server.json` — exclude `packages/core/src/react/**`
- `server/functions/sentry.ts` — re-export from `@luckystack/error-tracking`
- `src/main.tsx` — imports from core/client + register* calls in entry
- `src/_providers/SessionProvider.tsx` — writes into core's SessionContext
- `src/_sockets/socketInitializer.ts` — notify import path
- `src/_functions/middlewareHandler.ts` — typed via core's `MiddlewareHandler`
- `src/_components/{ConfirmMenu,ErrorPage,Avatar,Navbar,TemplateProvider,LoginForm}.tsx` — imports
- `src/{admin,dashboard,docs,reset-password,settings}/page.tsx` — imports + `useSession<SessionLayout>()` cast
- `src/playground/page.tsx` — 8 new demo sections + state + handlers
- `packages/devkit/src/loader.ts` — `createRequire` removed; `pathToFileURL` import added; `importFile()` now async ESM dynamic import with `?v=<ts>` cachebust
- `packages/devkit/src/hotReload.ts` — coalesced background `requestTypeMapRegeneration()` introduced; all inline `generateTypeMapFile` calls in event handlers replaced (startup line ~508 left synchronous); `clearModuleCache` removed; `invalidateGraphForFile` invocations added to all four watcher handlers
- `packages/devkit/src/importDependencyGraph.ts` — mtime-keyed `specifiersCache`, 1s-TTL `scopedFilesCache`, new exported `invalidateGraphForFile(absolutePath)`
- `packages/server/src/createServer.ts` — `process.once('SIGINT'/'SIGTERM', () => process.exit(0))` added in dev-tools block
- `packages/core/src/projectConfig.ts` — `RateLimitingConfig.enabled: boolean` field + JSDoc; default `enabled: true` in `DEFAULT_PROJECT_CONFIG.rateLimiting`
- `packages/core/src/rateLimiter.ts` — `isRateLimitingEnabled()` + `buildAllowedResult()` helpers; short-circuits added to `checkRateLimit` and `getRateLimitStatus`

**Deleted:**
- `src/_components/{Middleware,Router,AvatarProvider,LocationProvider,ThemeToggler,TranslationProvider}.tsx`
- `src/_functions/{notify,translator}.ts`
- `packages/sentry/dist/` (stale leftover after earlier rename)

### Dev/temp changes to revert before shipping

None this session. All edits are intended for v1 ship.

### Environment notes

- Working tree: ~16 modified + ~26 new files/dirs. Nothing committed this session.
- Branch: `chore/package-split-prep`. Main: `master`.
- Type checks pass: `npx tsc --noEmit -p tsconfig.client.json` and `npx tsc --noEmit -p tsconfig.server.json` both clean.
- Build: `node scripts/buildPackages.mjs` — 13/13 succeed in ~37s.
- Type-map regenerated this session via `npm run generateArtifacts` after adding `streamToToken_server_v1.ts` and the new `playground/*` routes.
- No server process running. No pending Vite restart. `package-lock.json` is in the modified set but only due to lockfile churn from earlier in the session.

**Hot reload + rate-limit arc additions:**
- Re-built individually + together: `npm --workspace packages/devkit run build`, `npm --workspace packages/server run build`, `npm --workspace packages/core run build`, `npm run build` (root, including `generateArtifacts` + Vite + bundleServer) — all green.
- `npm --workspace packages/devkit pack --dry-run` confirmed identical 7-file tarball shape vs baseline (no shape drift, safe to publish).
- Working tree now also includes the four edited devkit/server/core files listed above. Nothing committed.
- Live `npm run dev` smoke not yet run — see "Exact Next Step".

### Memory entries created/updated this session

- New: `~/.claude/projects/.../memory/project_monitoring_separation.md` — `@luckystack/monitoring` ships in its own GitHub repo; web-vitals folds in as a subpath.
