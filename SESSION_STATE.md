# SESSION_STATE

> **Agent**: AI 3
> **Branch**: `chore/package-split-prep`
> **Date**: 2026-05-27

## Session Summary

Full hardening pass driven by a 7-question codebase audit (hooks, dynamic imports, Bun support, backend linting, client-side sync `auth` staleness, streaming coverage, test infrastructure). User approved the largest scope: A1+A2+B1+B2+E+F. Three parallel agents handled the heavy lifting (streaming cancel/backpressure end-to-end, settings tests, reset-password + auth tests); I drove the hooks, lint config, Bun support, scaffolding, side-fixes, and finalization. Final state: lint clean, full build green, AI snapshots refreshed, branch-log + INDEX updated.

## Completed Tasks

- **A1 — 3 missing hooks**
  - `preLogin` client hook in `packages/core/src/clientHookBus.ts` + `ClientHookStopSignal` / `dispatchVetoableClientHook` / `ClientDispatchResult` types.
  - New `proposeLogin(session)` in `packages/core/src/react/sessionContext.ts`; `SessionProvider.tsx` + template switched to it; uses `useRef` to dodge TS flow-analyzer narrowing.
  - `postSyncAuthorize` payload + dispatch added to `packages/core/src/hooks/types.ts` and `packages/sync/src/handleSyncRequest.ts`.
  - `prePasswordChanged` + `prePasswordResetCompleted` payload types in `packages/login/src/hookPayloads.ts`. Dispatch wired into `src/settings/_api/changePassword_v1.ts` + `src/reset-password/_api/confirmReset_v1.ts` (+ template mirrors).
- **A2 — backend lint hardening** (conservative — audit finding was partially wrong)
  - Discovered `no-floating-promises` already on via `tseslint.configs.strictTypeChecked`.
  - Added documentation overlay in `eslint.official.config.js` for `packages/*/src/**/*.ts`.
  - New opt-in `lint:packages` script in `package.json` (default `lint:all` glob unchanged).
  - Side-fix: `templateInjector.ts` placement-warning template now emits `export const __luckystackPlacementWarning = true` instead of `export {};`.
- **B1 — Stream cancellation via AbortController** (delegated agent, end-to-end socket + HTTP for api + sync)
  - New `packages/core/src/cancelRegistry.ts` (per-`(socketId,key)` map + `abortAllForSocket`).
  - New `apiCancel` + `syncCancel` socket event names.
  - Per-request `AbortController` in both `handleSyncRequest.ts` and `handleApiRequest.ts`; `socket.once('disconnect', abort)` + cleanup; HTTP listens to `req.on('close', abort)`.
  - Stream emitters short-circuit on `signal.aborted`.
  - Client `apiRequest({ signal? })` + `syncRequest({ signal? })` emit cancel events on abort.
  - Templates updated (`sync_server.template.ts`, `api.template.ts`) so handlers see `abortSignal`.
- **B2 — Backpressure via `flushPressure`** (same agent)
  - `flushPressure({ thresholdBytes? })` method on `SyncStreamEmitters`; default 1 MB (~1024 packets via ~1 KB estimate). Worst-case across up to 32 sockets for broadcast/streamTo.
  - HTTP API variant documented no-op.
  - Section 8 added to `packages/sync/docs/streaming.md` with LLM-token opt-in example.
- **E — Bun runtime support**
  - `engines.bun: ">=1.1.0"` added; new scripts `bun:check`, `bun:server`, `bun:prod`.
  - New `scripts/checkBunCompat.mjs` — 8-probe smoke (node:crypto, fs/path, url, @prisma/client, socket.io, ioredis, @luckystack/core, @luckystack/server). 8/8 pass under Node v24.
  - New "Running on Bun" section in `docs/HOSTING.md`.
- **F — 12 per-route business-logic tests** (parallel agents, 29 cases total)
  - Settings (5): `changePassword_v1.tests.ts` (4), `deleteAccount_v1.tests.ts` (3), `signOutEverywhere_v1.tests.ts` (2), `updatePreferences_v1.tests.ts` (3), `updateUser_v1.tests.ts` (3).
  - Reset-password (2): `sendReset_v1.tests.ts` (2), `confirmReset_v1.tests.ts` (4).
  - Auth lifecycle (2): `_api/logout_v1.tests.ts` (2), `_api/session_v1.tests.ts` (3).
  - Streaming (3): `streamBroadcast_server_v1.tests.ts` (2), `streamProgress_server_v1.tests.ts` (2), `streamToToken_server_v1.tests.ts` (2).
  - `scripts/scaffoldRouteTest.mjs` extended to accept root-level routes (`logout/v1` instead of requiring `<page>/<name>/<version>`).
- **Side-fixes**
  - `packages/devkit/src/routeNamingValidation.ts:374` — replaced CJS `require('@luckystack/core')` with top-level static import (ESM bug was blocking `generateArtifacts`).
  - `packages/devkit/src/templates/page_dashboard.template.ts` + `page_plain.template.ts` renamed to `.tsx` (JSX-in-`.ts` was failing `tsc -b`). Lookup table in `templateInjector.ts` updated.
  - Deleted stray untracked `src/_tet/` folder (user-confirmed) — was colliding with `src/admin/page.tsx` on the duplicate-page-route check.
- **Finalization**
  - `npm run lint` → exit 0.
  - `npm run build` → exit 0.
  - `npm run ai:capabilities` + `npm run ai:index` → refreshed (14 packages, 7 commands, 8 skills).
  - `branch-logs/chore--package-split-prep.md` — full session entry appended.
  - `branch-logs/INDEX.md` — row bumped to 28 entries.
  - New memory: `feedback_tight_time_estimates.md` (user pushes back on padded effort estimates; default to realistic lower bound).

## Pending Logic / Known Bugs

**Reported but deliberately NOT auto-fixed** (per CLAUDE.md "report without auto-fixing"):

- `src/settings/_api/signOutEverywhere_v1.ts:20` — calls `revokeUserSessions(user.id)` without `user.token` as `exceptToken`. The code signs out the caller's own session too. If the intent is "sign out OTHER devices only", pass `user.token` as the second arg. The test asserts current behavior with a `//? TODO: verify intent` marker.
- `src/_api/session_v1.ts` — stray `console.log(user)` in the active route body.
- `src/settings/_api/updateUser_v1.ts` — typed input has no `email` field; audit's "email collision" scenario isn't reachable through this route as-written. Test replaced with avatar-format assertion instead.
- ~250 cosmetic lint errors in `packages/*/src/**/*.ts` (mostly `unicorn/switch-case-braces` + `no-unnecessary-condition`). Surface via `npm run lint:packages`. Cleanup is its own session.
- `.prisma/client/index-browser` Vite warning — cosmetic, harmless.

**Test cases TODO'd in-file pending live exercise**:

- Streaming sync tests (`streamBroadcast_server_v1.tests.ts`, `streamProgress_server_v1.tests.ts`, `streamToToken_server_v1.tests.ts`) have envelope-shape coverage only. Cancellation + backpressure tests are TODO'd because `ctx.callSync` doesn't observe individual stream chunks cross-process. To test B1/B2 end-to-end, boot the server and use a real socket client.
- `sendReset_v1.tests.ts` hook-observation uses Redis-key delta assertion instead of `registerHook` listener (cross-process limitation).

## Exact Next Step

Boot the server (`npm run server`) and run the new test suite for one route end-to-end against a live process:

```
npm run test -- --filter settings/changePassword/v1
```

If it passes, sweep:

```
npm run test
```

Then exercise the new `preLogin` client hook manually — open the app, register a one-line `registerClientHook('preLogin', () => ({ stop: true, errorCode: 'login.suspended' }))` somewhere in `main.tsx`, attempt to log in, and confirm the local React state rolls back to null (no half-logged-in render). Remove the test handler afterwards.

## Technical State

**Files modified this session** (one-line notes; full diff in git):

- **A1 hooks**:
  - `packages/core/src/clientHookBus.ts` — added `preLogin` + `dispatchVetoableClientHook` + types.
  - `packages/core/src/react/sessionContext.ts` — added `proposeLogin`.
  - `packages/core/src/client.ts` — exported new symbols.
  - `packages/core/src/hooks/types.ts` — added `PostSyncAuthorizePayload` + map entry.
  - `packages/sync/src/handleSyncRequest.ts` — `postSyncAuthorize` dispatch.
  - `packages/login/src/hookPayloads.ts` — added pre-hook types + augmentations.
  - `src/_providers/SessionProvider.tsx` + `packages/create-luckystack-app/template/src/_providers/SessionProvider.tsx` — use `proposeLogin`.
  - `src/settings/_api/changePassword_v1.ts` + template mirror — vetoable pre-hook dispatch.
  - `src/reset-password/_api/confirmReset_v1.ts` + template mirror — vetoable pre-hook dispatch.
- **A2 lint**: `eslint.official.config.js`, `package.json` (lint:packages script), `packages/devkit/src/templateInjector.ts` (placement-warning export shape).
- **B1+B2 streaming**: `packages/core/src/cancelRegistry.ts` (NEW), `packages/core/src/index.ts`, `packages/core/src/socketEvents.ts`, `packages/core/src/apiRequest.ts`, `packages/sync/src/syncRequest.ts`, `packages/sync/src/_shared/streamEmitters.ts`, `packages/sync/src/handleSyncRequest.ts`, `packages/sync/src/handleHttpSyncRequest.ts`, `packages/api/src/handleApiRequest.ts`, `packages/api/src/handleHttpApiRequest.ts`, `packages/server/src/loadSocket.ts`, `packages/devkit/src/templates/sync_server.template.ts`, `packages/devkit/src/templates/api.template.ts`, `packages/sync/docs/streaming.md` (new section 8).
- **E Bun**: `package.json` (engines + 3 scripts), `scripts/checkBunCompat.mjs` (NEW), `docs/HOSTING.md` (new section).
- **F tests**: 12× new `*.tests.ts` files under `src/`, `scripts/scaffoldRouteTest.mjs` (root-level route support).
- **Side-fixes**: `packages/devkit/src/routeNamingValidation.ts` (ESM require), `packages/devkit/src/templates/page_dashboard.template.tsx` (RENAMED from `.ts`), `packages/devkit/src/templates/page_plain.template.tsx` (RENAMED), `packages/devkit/src/templateInjector.ts` (lookup table). `src/_tet/` deleted.
- **Earlier session work** (pre-audit, also on this branch):
  - `packages/devkit/src/routingRules.ts` + `routeNamingValidation.ts` + `loader.ts` + `templateInjector.ts` — `isRouteTestFile` helper to exclude `.tests.ts` from route walkers.
  - `server/server.ts` + `server/sockets/socket.ts` + `server/utils/repl.ts` — fixed stale `./functions/*` imports after the `server/functions/*` → root `functions/*` move.
  - `shared/sleep.ts` + `shared/tryCatch.ts` — direct file-path imports (not `@luckystack/core` barrel) to avoid bootUuid → node:crypto leak into Vite client bundle.
  - `packages/core/src/client.ts` — added `sleep` + `tryCatch` to the browser-safe surface.
  - `packages/create-luckystack-app/template/shared/sleep.ts` — pointed at `@luckystack/core/client`.

**Auto-regenerated** (do not hand-edit):

- `docs/AI_CAPABILITIES.md`, `docs/AI_QUICK_INDEX.md`, `src/_sockets/apiTypes.generated.ts`, `server/prod/generatedApis.*-preset.ts`.

**Temporary / dev-only changes to revert before shipping**: None. Every change is production-intended.

**Environment**:

- Server NOT running (no dev process started this session).
- Git: branch `chore/package-split-prep`, all changes unstaged. No commits made this session — user controls commit cadence.
- No pending package installs. `eslint-plugin-n` was considered for A2 but deliberately skipped (would have required non-autonomous `npm install`).
- Three background subagents completed (streaming, settings tests, reset-password+auth tests). No agents still running.

**Plan reference**: `C:\Users\MathijsYouComm\.claude\plans\reflective-shimmying-starfish.md`.
