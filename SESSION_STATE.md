# SESSION_STATE

## Session Summary
Branch `chore/package-split-prep`. Drove the LuckyStack framework all the way through the publishability checklist: closed every remaining tier-A code blocker (`SessionLayout` type-only decoupling, `deploy.config` DI registry, `peerNotifier` socket decoupling, login → core type-move to break a circular dep), wired npm workspaces, set up `tsup` ESM + dts builds for all 10 packages with per-package `tsconfig.json` + `tsup.config.ts`, declared real `dependencies`/`peerDependencies`, added full publishing metadata to every package.json (description, keywords, license, repository with monorepo `directory`, author, homepage, bugs, engines), shipped a repo-root MIT `LICENSE`, and built a brand-new tier-A package `@luckystack/server` exposing `createLuckyStackServer({...})` that consolidates the 700-line `server.ts` into a single bootstrap call. End state: every package builds JS + dts, `npm run pack:dry` shows clean tarballs, three pre-publish prerequisites remain (READMEs, `pre*` hooks, final-pre-publish-checks).

## Completed Tasks

### Decoupling and DI
- **§38.1 `SessionLayout` decoupling** — `import type { BaseSessionLayout as SessionLayout }` swap in 7 framework files: `packages/api/src/{handleApiRequest,handleHttpApiRequest}.ts`, `packages/sync/src/{handleSyncRequest,handleHttpSyncRequest,syncRequest}.ts`, `packages/login/src/{session,login}.ts`. login's `as SessionLayout["language"]` casts replaced with `as Prisma.UserCreateInput['language']` (login already imports from `@prisma/client`).
- **`peerNotifier.ts`** — `import { ioInstance } from '../../../../server/sockets/socket'` replaced with `getIoInstance()` from `@luckystack/core`.
- **§39.7 deploy.config DI** — new `packages/core/src/deployConfigRegistry.ts` (`registerDeployConfig` / `getDeployConfig` / `isDeployConfigRegistered` / `DeployConfigShape` / `DeployResourceShape`). `packages/core/src/synchronizedEnvHashes.ts` now reads via `getDeployConfig()`. Project's `deploy.config.ts` calls `registerDeployConfig({ resources: deployConfig.resources })` from the direct file path; `server/server.ts` side-effect-imports `../deploy.config` after `../config`.
- **Type move (login → core)** — moved `BaseSessionLayout`, `SessionLocation`, `AuthProps` from `packages/login/src/sessionLayout.ts` into new `packages/core/src/sessionTypes.ts` to break the circular type dep that was blocking core's per-package dts build. `packages/login/src/sessionLayout.ts` collapsed to a single re-export line; barrel still works for project consumers.
- **Tier-A coupling now zero**: core, sentry, login, api, sync, presence, test-runner, server — all have 0 `packages/** → project` value or type imports.

### Build pipeline (tsup)
- **`tsup` added** to root devDependencies. `npm run build:packages` runs `scripts/buildPackages.mjs` (topological order); `npm run pack:dry` builds + `npm pack --dry-run` per package.
- **`tsconfig.packages.base.json`** at repo root — shared compiler options (ESNext, bundler resolution, declaration, ES2023+DOM lib, react-jsx). No `paths` (sister packages resolve via node_modules → workspace symlinks).
- **Per-package** (10 of them): `tsconfig.json` extends the base and sets `outDir: dist`. `tsup.config.ts` emits ESM + `.d.ts`, externalizes `@luckystack/*` and `node_modules`, target es2022. Tier-B (devkit, router) initially had `dts: false` then was re-enabled after dropping `rootDir`.
- **npm workspaces** enabled in root `package.json` so cross-package imports resolve via `node_modules/@luckystack/*` symlinks at build time.
- **Multi-entry packages**: `@luckystack/core` and `@luckystack/sync` ship `./` (server) and `./client` (browser-safe) subpaths via `exports`. `tsconfig.server.json` / `tsconfig.client.json` got matching path entries for the `/client` subpaths.
- **Build-error fixes during pipeline bring-up** (each one verified):
  - `core/runtimeTypeValidation.ts` — `await import('@luckystack/devkit')` converted to indirect string ID + cast (`DevkitTypeResolverModule`) to skip type-resolution; breaks core → devkit type cycle.
  - `core/apiRequest.ts` lines 311-322 — handler typed as `ApiResponse` instead of `RequestOutput` (which collapses to `never` when `ApiTypeMap` is empty during isolated package build); resolve site uses `as RequestOutput`.
  - `api/handleHttpApiRequest.ts` line 136 — `email: user.email ?? undefined` (was `user.email`, breaking on `string | null`).
  - `sync/syncRequest.ts` lines 453-472 — `UpsertParams`, `TypedCallbackParams`, `UpsertStreamParams` hoisted from inside `useSyncEvents` to module scope (TS4025).
  - `sync/syncRequest.ts` lines 1-19 — relative `../../core/src/...` and `../../login/src/...` imports replaced with `@luckystack/core/client` (which now re-exports the browser-safe surface from `projectConfig`, `notifier`, `socketState`, `offlineQueue`, `responseNormalizer`, `serviceRoute`, `socketEvents`, `socketStatusTypes`, `apiTypeStubs`, `sessionTypes`).
  - Tier-B re-enabled with dts by dropping `rootDir` from `packages/devkit/tsconfig.json` and `packages/router/tsconfig.json`.

### Per-package metadata + dependencies
- **§39.9 dependencies** declared per package (cross-pkg as `^0.0.1`, peers for singletons): see §39.9 table in `docs/ARCHITECTURE_PACKAGING.md`.
- **Metadata** added to every `package.json` and the root: `description`, `keywords`, `license: MIT`, `repository` (with `directory: packages/<name>` for monorepo), `author: Mathijs van Melick <mathijsvanmelick3@gmail.com>`, `homepage`, `bugs`, `engines: { node: ">=20.0.0" }`. Tier-A packages also list `README.md` in `files`. Root `package.json` got matching identity fields.
- **Repo-root `LICENSE`** added (MIT, copyright 2026 Mathijs van Melick).

### `@luckystack/server` (new tier-A package)
- New `packages/server/` with `package.json`, `tsconfig.json`, `tsup.config.ts`, six source files:
  - `src/types.ts` — `CreateLuckyStackServerOptions`, `RunningLuckyStackServer`, `RouteContext`, handler types.
  - `src/sse.ts` — `shouldUseHttpStream`, `initSseResponse`, `sendSseEvent` for streaming `/api/*` and `/sync/*`.
  - `src/logSanitize.ts` — recursive sanitizer that redacts password/token/cookie keys.
  - `src/loadSocket.ts` — full Socket.io setup ported from `server/sockets/socket.ts`: Redis adapter, room join/leave/getJoinedRooms, location updates, presence broadcasting (driven by `getProjectConfig().socketActivityBroadcaster` and `locationProviderEnabled`).
  - `src/httpHandler.ts` — full HTTP request dispatcher ported from `server/server.ts`: CORS + security headers, OPTIONS, method validation, cookie sliding, `/favicon.ico`, `/_health`, `/_test/reset`, `/uploads/*`, `/auth/api`, `/auth/callback`, `/api/*` (with SSE), `/sync/*` (with SSE), customRoutes hook, `/assets/*`, file extensions, SPA catch-all.
  - `src/createServer.ts` — `createLuckyStackServer({...})` factory: dev-tools opt-in (devkit hot reload + console init), boot UUID write, http.Server creation, socket attachment, `listen()` returning a Promise.
  - `src/index.ts` — barrel re-exports.
- **`ProjectConfig` extended** in `packages/core/src/projectConfig.ts` with `socketActivityBroadcaster?`, `locationProviderEnabled?`, `loginRedirectUrl?`. Project's `config.ts` propagates these through `registerProjectConfig`.
- **Build order updated** in `scripts/buildPackages.mjs`: `core → sentry → login → api → sync → presence → server → test-runner → devkit → router`.
- **Dev tsconfigs updated** with `@luckystack/server` paths and includes for both server and client.

### Documentation
- **`docs/ARCHITECTURE_PACKAGING.md`** gained sections §38.1, §39, §39.5, §39.7, §39.8, §39.8.1, §39.9, §39.10. Final shape covers SessionLayout decoupling, the audit, deploy.config DI, the tsup pipeline, the circular-dep resolution, the dep declarations, and the `@luckystack/server` design.

### Memory
- Saved `project_npm_scope_registration.md` — must `npm org create luckystack` on npmjs.com before first publish.
- Saved `user_identity.md` — work identity (`mathijs@youcomm.nl` for git) vs personal (`mathijsvanmelick3@gmail.com` for OSS/npm/license).

## Pending Logic / Known Bugs
- **§39.10 build verification not yet run** — user was about to run `npm install && npm run build:packages` to verify the new `@luckystack/server` package compiles cleanly with all the changes from this session. Pipeline succeeded for the original 9 packages before the server package was added; the server package itself has not yet been compiled by tsup, only authored. **Likely blocker**: any unresolved cross-package import in the new server source will surface as the first error tomorrow.
- **Project's `server/server.ts` not migrated** to use `createLuckyStackServer` yet. Intentional: kept the existing 700-line file working so we have a fallback while the new helper is verified. Migration is a separate one-shot change.
- **`pre*` hooks not added** (Task #23): preLogin, preRegister, preLogout, preSessionCreate, preSessionDelete. Payloads need definition + dispatch sites in `packages/login/src/{login,session,logout}.ts`, with stop-signal short-circuit in each call site.
- **READMEs not written** (Task #24). Tier-A packages need install + quickstart + API reference + cross-pkg deps. Tier-B (devkit, router) gets a one-paragraph stub since they stay private.
- **Pre-publish checks not run** (Task #25): flip `private: false` on tier-A, register the `@luckystack` npm org, real `npm pack`, install the .tgz files in a fresh test directory, verify imports + types resolve.
- **`@luckystack` npm scope not yet registered** — see memory entry. Required before any publish attempt.

## Exact Next Step
Run `npm install && npm run build:packages` from the repo root to verify the new `@luckystack/server` package compiles. Expected outcome: all 10 packages build (ESM JS + .d.ts where applicable) with `dist/index.js` populated under `packages/server/dist/`. If the build fails on `@luckystack/server`, the most likely culprits are: (a) an unresolved import name from `@luckystack/core` (something I assumed was exported but wasn't — paste the error and the import from `httpHandler.ts` or `loadSocket.ts` is the candidate), (b) a type mismatch in the `loginWithCredentials` cast in `httpHandler.ts` (currently typed as `{status,reason,newToken,session} | undefined`), or (c) a missing event-name builder in core. Once the build passes, run `npm run pack:dry` to confirm the new package's tarball contents look right (expected: `package.json`, `dist/index.{js,d.ts,js.map}`, `LICENSE`).

After that, the natural next bites in order: (1) migrate `server/server.ts` to use `createLuckyStackServer({...})` and verify it still serves correctly in dev (`npm run server`), (2) Task #23 add `pre*` hooks, (3) Task #24 READMEs, (4) Task #25 final pre-publish.

## Technical State

### Files modified or created this session
- **New files** (framework code):
  - `packages/core/src/sessionTypes.ts` — moved `BaseSessionLayout`, `SessionLocation`, `AuthProps` here.
  - `packages/core/src/deployConfigRegistry.ts` — `registerDeployConfig` / `getDeployConfig` / `DeployConfigShape`.
  - `packages/server/package.json` + `tsconfig.json` + `tsup.config.ts`.
  - `packages/server/src/{types,sse,logSanitize,loadSocket,httpHandler,createServer,index}.ts`.
- **New files** (build pipeline):
  - `tsconfig.packages.base.json` — shared base for per-package builds.
  - `scripts/buildPackages.mjs` — topological build orchestrator.
  - 9 × `packages/<name>/tsconfig.json`, 9 × `packages/<name>/tsup.config.ts` (one for each pre-existing package; server's added too — 10 total).
- **New files** (publishing):
  - `LICENSE` (repo root, MIT).
- **Modified — package.json files** (10 total, all received metadata + deps):
  - root, core, sentry, login, api, sync, presence, test-runner, devkit, router (+ new server).
- **Modified — framework source**:
  - `packages/core/src/index.ts` — re-exports for `sessionTypes`, `deployConfigRegistry`.
  - `packages/core/src/client.ts` — expanded from 2 exports to full browser-safe surface used by `@luckystack/sync`.
  - `packages/core/src/synchronizedEnvHashes.ts` — `getDeployConfig()`.
  - `packages/core/src/runtimeTypeValidation.ts` — indirect `import('@luckystack/devkit')`.
  - `packages/core/src/apiRequest.ts` — handler types `ApiResponse`, resolve casts to `RequestOutput`.
  - `packages/core/src/projectConfig.ts` — `socketActivityBroadcaster`, `locationProviderEnabled`, `loginRedirectUrl` added.
  - `packages/core/src/validateRequest.ts` — local `./sessionTypes` import.
  - `packages/login/src/sessionLayout.ts` — collapsed to re-export from core.
  - `packages/login/src/login.ts` + `session.ts` — `as SessionLayout` aliasing + Prisma input cast.
  - `packages/api/src/{handleApiRequest,handleHttpApiRequest}.ts` — type alias swap; HTTP variant got `email: ... ?? undefined`.
  - `packages/sync/src/{handleSyncRequest,handleHttpSyncRequest,syncRequest}.ts` — type alias swap; syncRequest moved to `@luckystack/core/client`; `useSyncEvents` interfaces hoisted.
  - `packages/presence/src/activity/peerNotifier.ts` — `getIoInstance()` from core.
- **Modified — project files**:
  - `config.ts` — propagates new fields through `registerProjectConfig`.
  - `deploy.config.ts` — calls `registerDeployConfig`.
  - `server/server.ts` — added `import '../deploy.config'`. (Not migrated to use `createLuckyStackServer` yet.)
  - `tsconfig.server.json` + `tsconfig.client.json` — added `@luckystack/core/client`, `@luckystack/sync/client`, `@luckystack/server` paths and includes.
  - `package.json` (root) — workspaces enabled, scripts `build:packages` and `pack:dry`, root metadata, `tsup` devDep.
- **Modified — docs**:
  - `docs/ARCHITECTURE_PACKAGING.md` — §38.1, §39, §39.5, §39.7, §39.8, §39.8.1, §39.9, §39.10.

### Temporary/dev-only changes to revert before shipping
- None. Every change in this session is production-intended.

### Environment notes
- No server running. No staged git changes (everything unstaged/untracked relative to `master`).
- Build pipeline: `npm install` was last run before `@luckystack/server` was added — so `node_modules/@luckystack/server` doesn't exist yet. **Must run `npm install` before `npm run build:packages` tomorrow** to register the new workspace.
- `npm run lint` and the project's main `npm run build` (server bundle) have NOT been re-run since the session's many edits to api/sync/login/server-package files. There is some risk the project's own server/client builds need adjustments — flag if that surfaces tomorrow.
- Suggested commit message: `feat: tsup build pipeline + per-package metadata + @luckystack/server bootstrap helper`.
- `tsup` v8.5.1 is now in root devDeps. The 10 packages + 6 root config files (root package.json, LICENSE, tsconfig.packages.base.json, scripts/buildPackages.mjs, tsconfig.{server,client}.json) are the surface to review before commit.
