# SESSION_STATE

> **Branch**: `chore/package-split-prep`
> **Date**: 2026-06-02

## Session Summary

Wired `@luckystack/secret-manager` into server boot and then cleared the entire pre-publish backlog (WS1–WS6) plus two finishing touches. The secret-manager now resolves `.env` pointers against an external server when configured, and falls through to plain local env (no crash) when the URL is unset or the package isn't installed — a deliberate fail-OPEN exception to the peer-dep-guard policy that the user confirmed. Everything is gated green (lint/tsc/vitest 711 · build:packages 14/14 · pack:dry 14/14 · live integration `npm run test` 113/0/11 on port `:81`). Nothing is committed.

## Completed Tasks

- **WS1 — secret-manager wired into boot**
  - `server/bootstrap/initSecrets.ts` (NEW) — `resolveSecretsIfConfigured(config, importer?)`: url empty → skip; url set + package absent → warn + skip (no crash); url set + package present → `initSecretManager({ url, token, source: 'remote', dev })` (fail-fast). Injectable `importer` = test seam.
  - `server/bootstrap/initSecrets.test.ts` (NEW) — 5 vitest cases (skip / absent-warn / remote-init / dev-passthrough / fail propagation).
  - `config.ts` — added `secretManager` slot (`{ url, token, dev }`) on the exported config object (NOT `registerProjectConfig`).
  - `server/server.ts` — top-level `await resolveSecretsIfConfigured(projectConfig.secretManager)` after env load, before secret consumers.
  - `tsconfig.server.json` — alias `@luckystack/secret-manager`; `scripts/bundleServer.mjs` — marked it external; `vitest.config.ts` — added `server/**/*.test.ts`.
  - Docs: `.env_template` + `docs/ARCHITECTURE_SECRET_MANAGER.md` rewritten to match the real wiring (config slot + boot seam + remote/local-fallthrough).
- **WS2 — configurable envFiles (default unchanged)**
  - `packages/core/src/env.ts` — `DEFAULT_ENV_FILES` / `getEnvFiles()` / `loadEnvFiles()` (single source of truth, ambient override `LUCKYSTACK_ENV_FILES`); `bootstrapEnv()` uses `loadEnvFiles()`. `+ env.test.ts` (3 cases).
  - Rewired all hardcoded load/watch points to use it: `server/server.ts`, `server/sockets/socket.ts`, `luckystack/login/oauthProviders.ts`, `packages/devkit/src/supervisor.ts` (watch globs).
- **WS3 — peer-dep fixes** (verified against real imports): core `react`/`react-dom` `^19.2.0`; sync `react` → optional; presence `react-router-dom@^7.0.0` optional peer (LocationProvider); test-runner `socket.io-client@^4.8.0` peer (streamWatcher).
- **WS4 — per-route tests**: verified **already complete** — 63/63 custom business-logic tests pass live. The recon's "TODO stubs" claim was outdated; nothing to write.
- **WS5 — manifest/doc-drift**: `devkit/package.json` `homepage`+`bugs`; CLAUDE peer sections (test-runner zod^4 + socket.io-client; presence react-router-dom; core `LUCKYSTACK_ENV_FILES`); **5 README signature fixes** (api, router, presence, test-runner, error-tracking) via a 5-agent workflow (source-verified, surgical).
- **WS6 — publish contract**: `docs/PACKAGE_OVERVIEW.md` peer tables (zod 4 / ts 6 / react 19.2 / test-runner socket.io-client + "four→five layers"); `pack:dry` 14/14.
- **Finishing touch A — rotation poll**: `config.ts` `secretManager.dev = { watch: false, pollIntervalMs: 30_000 }` (poll-only; file-watch off because the supervisor already restarts on `.env` change); `initSecrets.ts` forwards `dev`.
- **Finishing touch B — scaffold-template parity**: `template/server/server.ts` uses `loadEnvFiles()` + a commented secret-manager opt-in; `template/config.ts` commented `secretManager` slot; `template/_dot_env_template` notes for `LUCKYSTACK_ENV_FILES` + secret-manager.
- **Zod-4 deprecation cleanup** (re-triggered by edits, blocked lint): `core/env.ts` `.passthrough()→.loose()`; `test-runner/src/runAllTests.ts` `ZodTypeAny→ZodType`.
- Memory added: `feedback_secret_manager_failopen.md` (fail-OPEN exception). Branch-log entries #45–#48 + INDEX updated; AI snapshots regenerated.

## Pending Logic / Known Bugs

- **Secret-manager "met" path + rotation poll NOT live-tested** — needs the external secret server on `localhost:4000`. Only the URL-unset ("zonder") path is live-verified (113/0/11 green).
- **Port gotcha**: a second project (`C:\youcomm\matchrix`) runs on port `:80`; LuckyStack-v2 is on `:81`. `npm run test` defaults to `:80` → tests the wrong server. Always run with `TEST_BASE_URL=http://localhost:81`.
- **Stale `node_modules/@luckystack/env-resolver` symlink** — causes the `[ai:index] note: env-resolver ... skipped` line (15 vs 14 packages). Clears on `npm install`.
- **Orphan `packages/devkit/src/templates/sync_client.template.ts`** — unused (registry only uses `_paired`/`_standalone`). NOT removed (`rm` is ask-first).
- **Template excluded from main tsc/lint globs** — the `template/` edits are not gate-validated here; only the scaffold smoke (pre-publish) exercises them.

## Exact Next Step

Run the secret-manager **"met" + rotation** live test (secret server on `localhost:4000`, secrets `TEST_V1..TEST_V5`): add `LUCKYSTACK_SECRET_MANAGER_URL=http://localhost:4000`, a `.secret-manager-token` file, and a pointer `MY_SECRET=TEST_V1` to `.env`; restart the server; via the dev-REPL confirm `process.env.MY_SECRET` resolved to the real value. Then publish a new server-side version for that key and confirm `process.env.MY_SECRET` updates **within ~30s without a restart** (the dev poll). Reminder: the running suite must target `:81` (`TEST_BASE_URL=http://localhost:81 npm run test`).

## Technical State

**Files modified this session** (new = NEW):
- `server/bootstrap/initSecrets.ts` (NEW), `server/bootstrap/initSecrets.test.ts` (NEW), `packages/core/src/env.test.ts` (NEW) — secret-manager seam + envFiles tests.
- `config.ts` — `secretManager` slot (`url`, `token`, `dev` rotation poll).
- `server/server.ts` — `loadEnvFiles()` + `await resolveSecretsIfConfigured(...)`.
- `server/sockets/socket.ts`, `luckystack/login/oauthProviders.ts` — env load via `loadEnvFiles()`.
- `packages/core/src/env.ts` — `DEFAULT_ENV_FILES`/`getEnvFiles`/`loadEnvFiles` + `.loose()`.
- `packages/devkit/src/supervisor.ts` — watch globs via `getEnvFiles()`.
- `packages/test-runner/src/runAllTests.ts` — `ZodType` (was `ZodTypeAny`).
- `packages/{core,sync,presence,test-runner,devkit}/package.json` — peer/manifest fixes.
- `tsconfig.server.json`, `scripts/bundleServer.mjs`, `vitest.config.ts`, `.env_template` — secret-manager plumbing + docs.
- Docs: `docs/ARCHITECTURE_SECRET_MANAGER.md`, `docs/PACKAGE_OVERVIEW.md`, `packages/{core,presence,test-runner}/CLAUDE.md`, `packages/{api,error-tracking,presence,router,test-runner}/README.md`.
- Template: `packages/create-luckystack-app/template/{server/server.ts, config.ts, _dot_env_template}` (parity).
- Auto-regenerated (do not hand-edit): `docs/AI_QUICK_INDEX.md`, `docs/AI_CAPABILITIES.md`, `docs/AI_PROJECT_INDEX.md`, `src/_sockets/*.generated.ts`, `server/prod/generatedApis.*-preset.ts`, `package-lock.json` (npm auto-synced after peer edits).

**Temporary / dev-only changes to revert before shipping**: None. The `secretManager.dev` poll is intended (dev-only, no-op in prod and when URL unset).

**Environment**:
- Servers running: LuckyStack-v2 on `:81` (supervisor + tsx `server/server.ts`), matchrix on `:80`, plus Redis + MongoDB. The `:81` server was auto-restarted by the supervisor after the `config.ts`/`server.ts` edits and boots clean.
- Git: branch `chore/package-split-prep`, all changes unstaged, **nothing committed** (user controls commit cadence). Master is the PR base.
- Pending: `npm install` (env-resolver symlink + lockfile), full `npm run build` (vite client) before the real publish, and `npm org create luckystack` before first publish.

**Plan reference**: `C:\Users\MathijsYouComm\.claude\plans\wat-is-nou-het-humming-sonnet.md`.
