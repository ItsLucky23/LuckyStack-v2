# Handoff 2026-09-03 solo

Addressed to: the other agent working in this checkout on the v0.10.0 batch (ADR 0058-0062, DEV-376 handoff). This session worked in the SAME working tree, on top of your uncommitted files. Nothing is committed. Read "Files Touched" first: three files carry both your changes and mine.

## Session overview

Branch `main`. A Flexbuddy-side AI claimed that a role change on Flexbuddy staging fails because of LuckyStack: no configurable Socket.io Redis-adapter key, dev + staging sharing one Redis become one cluster, and a post-commit fan-out timeout reported as a mutation failure. This session verified all three claims (plus a fourth the report missed), then implemented the framework-side fix the user chose: a per-environment adapter key derived in code (no new setting), and sync recipients resolved BEFORE `_server` runs on both transports. Full gate green, ADR 0063 written, branch-log entry 89 appended. Not committed.

## Timeline

- Inventory: `packages/server/src/loadSocket.ts:591` called `attachSocketRedisAdapter(io, { pubClient, subClient })` with no `adapterOptions`, so every server sat on upstream's fixed key `socket.io`; no config path via `createServer` / `LoadSocketOptions` / `config.socket`.
- Inventory: Flexbuddy `.env` tunnels dev into the staging Redis (`127.0.0.1:6380`) with the same `PROJECT_NAME=matchrix` — so dev and staging are one Socket.io cluster AND share the session store (`redisKeyFormatter.ts` prefixes by project name only).
- Inventory: both sync transports ran `fetchSockets()` AFTER `_server` (socket: `runSyncFanout`; HTTP: `stageFanout`), so an adapter timeout became `sync.serverExecutionFailed` and an empty room `sync.noReceiversFound` on an already-persisted mutation.
- User decisions: (1) derive the key in code, no setting; (2) resolve recipients first, then persist — the user rejected "ack success after commit, log the delivery failure"; (3) tests + docs; (4) Flexbuddy config is the user's own action.
- Core: added `resolveSocketAdapterKey()` to `packages/core/src/socketRedisAdapter.ts`, wired as the default `key` in `attachSocketRedisAdapter`, exported from `packages/core/src/index.ts`.
- Core tests: new `packages/core/src/socketRedisAdapter.test.ts` (6 cases, mocked `createAdapter`); `socketRedisAdapter.integration.test.ts` now runs on a per-pid suite key and has a third instance on another key with 3 isolation tests.
- Live finding while running the integration suite: this repo's `.env.local` also points at `127.0.0.1:6380`, and `PUBSUB NUMSUB socket.io-request#/#` showed 11 subscribers there. The pre-existing `fetchSockets()` tests timed out on the default key — the bug reproduced in our own suite. Hence the per-pid key.
- Sync: new `resolveSyncRecipients` (socket, `handleSyncRequest.ts`) and `stageResolveRecipients` (HTTP, `handleHttpSyncRequest.ts`) called before input validation; `runSyncFanout` / `stageFanout` now receive `sockets: RoomSocket[]` instead of fetching. Stage numbering renumbered in both files.
- Sync tests: `handleSyncTransport.test.ts` — YOUR test "HTTP: an EMPTY room is sync.noReceiversFound (404), after the _server ran ..." was inverted (title + `expect(entry.main).not.toHaveBeenCalled()`); new describe with 4 cases appended at the end.
- Docs rewritten where the old order made them untrue: `packages/sync/docs/room-fanout.md` §1 + §8, `error-states.md` (row 66 + a new row for the lookup timeout), `server-vs-client-handlers.md` (steps 10/11 swapped + table rows), `packages/sync/CLAUDE.md`, `docs/ARCHITECTURE_SYNC.md`, `docs/ARCHITECTURE_MULTI_INSTANCE.md` (shared-Redis-across-environments paragraph + pitfall row), `packages/core/docs/redis-adapter.md`, `packages/core/CLAUDE.md`.
- CHANGELOG: `[Unreleased]` entries in `packages/core/CHANGELOG.md` (Changed + Added) and `packages/sync/CHANGELOG.md` (Changed). Server CHANGELOG untouched: `loadSocket.ts` is unchanged, core supplies the default.
- Records: ADR 0063 written, `npm run ai:decisions` (62 decisions), `ai:check-ids` ok (87 records), branch-log `main.md` entry "13:00" + INDEX row (entries 88 -> 89).
- Gate: `npm run lint && npm run build && npm run test:unit` exit 0 — 205 files, 2142 passed, 1 skipped (pre-existing). `ai:lint` clean, `ai:changelog-check` green, `ai:refresh` 7/7.

## Done

- `resolveSocketAdapterKey()` = `${getProjectName()}:${resolveEnvKey()}:socket.io`; `attachSocketRedisAdapter` passes it as `key` unless `adapterOptions.key` is set. Verified by 6 unit tests + 8/8 integration tests against the real Redis.
- Socket transport: recipients resolved in `resolveSyncRecipients` (stage 8) before `runSyncServerExecution` (stage 9); fan-out is stage 10 and takes the resolved list.
- HTTP transport: `stageResolveRecipients` (stage 5) before validation (6) and execution (7); `stageFanout` (8) takes the resolved list. Your ADR 0058 / 0059 comment blocks moved with the code; the 0058 block's last sentence now says "before `_server` runs, so nothing has been persisted".
- `//? @adr 0063` tags on both new resolve functions.
- All docs listed above reconciled with the new order; both CHANGELOGs carry an `[Unreleased]` entry including the rolling-deploy note for the key change.
- Full gate green (numbers above).

## In Progress

- (none)

## Blockers

- (none)

## Next Steps

1. Decide what to do with ADR 0058's Decision paragraph: it still says the empty-room check runs "after the `_server` handler has run and persisted its mutation". That is now false. ADR 0063 states the refinement and `relates: [0058]`. Either correct that one sentence in 0058 before it is first committed (it is still untracked), or leave it and let 0063 carry the correction. The user has not chosen yet — see Open Questions.
2. Your `[0.10.0]` CHANGELOG sections are dated 2026-09-03 and mine sit under `[Unreleased]`. If 0.10.0 has not been published, consider folding the `[Unreleased]` entries of core and sync into `[0.10.0]` so the sync behaviour change (recipients before `_server`) ships in the same minor as ADR 0058's HTTP parity change — they touch the same code and the same error codes.
3. Commit. The working tree mixes both sessions (56 modified, 15 untracked). Suggested split if you want two commits: everything in "Files Touched -> this session" below is separable EXCEPT the three shared files (`handleSyncRequest.ts`, `handleHttpSyncRequest.ts`, `handleSyncTransport.test.ts`), which carry both sessions' hunks.
4. `package-lock.json` still needs `npm install --package-lock-only` for the 0.10.0 bump (your open item, unchanged).
5. Flexbuddy handoff (`C:\youcomm\flexbuddy\handoffs\2026-09-03\HANDOFF.md`, yours): worth adding two lines — after upgrading, dev and staging separate automatically via `LUCKYSTACK_ENV`/`NODE_ENV`; and the user must still give dev its own `PROJECT_NAME` or Redis, because the session store is namespaced by project name only (the user said they will do this themselves).

## Open Questions

- ADR 0058 stale sentence: correct in place (untracked file, not yet a published record) or leave and rely on 0063? User said nothing yet; default if unanswered: leave 0058 as is.
- Release packaging: ship the sync reorder in 0.10.0 or as 0.10.1? Not asked; the CHANGELOG entry sits under `[Unreleased]` so either works.

## Files Touched

This session — modified:

- packages/core/src/socketRedisAdapter.ts
- packages/core/src/index.ts (one export line; you also changed this file)
- packages/core/src/socketRedisAdapter.integration.test.ts
- packages/core/docs/redis-adapter.md
- packages/core/CLAUDE.md (you also changed this file — different rows)
- packages/core/CHANGELOG.md
- packages/sync/src/handleSyncRequest.ts (SHARED with your session)
- packages/sync/src/handleHttpSyncRequest.ts (SHARED with your session)
- packages/sync/src/handleSyncTransport.test.ts (SHARED with your session; one of your tests inverted)
- packages/sync/docs/room-fanout.md (you also changed this file)
- packages/sync/docs/error-states.md (you also changed this file)
- packages/sync/docs/server-vs-client-handlers.md (you also changed this file)
- packages/sync/CLAUDE.md (you also changed this file)
- packages/sync/CHANGELOG.md
- docs/ARCHITECTURE_SYNC.md (you also changed this file)
- docs/ARCHITECTURE_MULTI_INSTANCE.md (you also changed this file)
- branch-logs/main.md
- branch-logs/INDEX.md

This session — added:

- packages/core/src/socketRedisAdapter.test.ts
- docs/decisions/0063-sync-recipients-resolve-before-the-server-handler-commits.md
- handoffs/2026-09-03/HANDOFF.md

This session — deleted:

- (none)

Your session's files (unchanged by me, listed so the split is clear): everything else in `git status`, including ADR 0058-0062, the eslint rule + tests, `roomSockets.ts`, `localSocketEnumerationGuard.ts`, `_shared/errorCodes.ts`, login/presence edits, scaffold locales, 17 package manifests.

## User testing checklist

- `npm run test:unit` — expect 2142 passed, 1 skipped.
- `npx vitest run --config vitest.integration.config.ts packages/core/src/socketRedisAdapter.integration.test.ts` with Redis reachable — expect 8/8 (needs the tunnel on 6380 or a local Redis; skips gracefully without one).
- Boot a dev server and check the adapter key in Redis: `PUBSUB CHANNELS *socket.io*` should show `<project>:<env>:socket.io-request#/#` instead of `socket.io-request#/#`.
- In Flexbuddy after the upgrade: a role change on staging no longer waits on a sleeping dev laptop; a staging broadcast no longer appears in a dev browser tab.
