# sync — Verified & Merged Audit Findings
Sources: reports/sync.md + review/v0.2.0/* · Verified against current working tree (branch chore/package-split-prep, 2026-06-11).

## Verdict summary
24 distinct findings across the two scans for the sync area, de-duplicated to 22 entries. Of these: **15 CONFIRMED** (still live in current code/docs), **2 ALREADY-FIXED** since the scans ran, **1 PARTIALLY-FIXED**, **0 REFUTED**, **4 UNCERTAIN/non-defect** (hook-gap feature requests + a hard-block caveat). The two scans that have been overtaken by code changes: **QUA-044** (`RuntimeSyncServerEntry.validation` ignored) is now honored via the new `resolveSyncValidationMode` helper in BOTH transports, and **QUA-013** (dev loader dropping `validation`/`errorFormatter`) is now fixed in `devkit/loader.ts` — both carry in-code comments citing the exact finding IDs, so the review/ scan clearly pre-dates those fixes. The biggest live issue is **SEC-12** (socket `handleSyncRequest` has NO top-level `tryCatch` while the HTTP twin does, and `validateRequest({ user: user! })` passes `null` into `'key' in user` for an `additional`-only/`login:false` route → a remotely-triggerable process crash via unhandledRejection, since loadSocket invokes the handler as an un-`.catch()`'d `void` IIFE). Close behind: the **#1 client-only-route auth bypass** (reports High, CONFIRMED), the **SEC-11 full-`serverOutput`-leak** that the docs actively teach as a field-hiding recipe (review High; reports underweighted it as Low #5 — review is right), and **SEC-25** schema-enumeration via echoed validator messages (the API fix was never ported to sync).

## Findings

### SYNC-01 — Client-only sync routes (no `_server`) bypass auth + input validation entirely  ·  severity: high  ·  status: CONFIRMED
- **Sources:** reports(#1, with its own CONFIRMED adversarial verdict)
- **Current location:** `packages/sync/src/handleSyncRequest.ts:289` (route-valid guard), `:318-350` (auth under `if (serverSyncEntry)`), `:405-430` (validation under `if (serverSyncEntry)`); HTTP twin `handleHttpSyncRequest.ts:273`, `:286-308`, `:344-383`; loader `packages/devkit/src/loader.ts:446`
- **Original claim:** A route shipping only `_client_v{N}.ts` reaches the per-recipient handler with no `auth.login`, no `auth.additional`, and no input validation — an unauthenticated, unvalidated endpoint.
- **Verification (current code):** Confirmed unchanged. The route is valid when EITHER file exists (`:289` aborts only when both `_client` and `_server` are absent). Every auth + validation gate is nested under `if (serverSyncEntry)` (`:320`, `:405`). For a client-only route `serverSyncEntry` is `undefined`, so all gates are skipped and `normalizedData` flows raw into `processClientSyncForRecipient` (`clientFanout.ts:104`, `clientInput: data`). The dev loader stores only `resolvedSyncModule.main` for `_client` files (`loader.ts:446`) — any `auth` export is dropped — so the pattern cannot be gated. The HTTP transport mirrors this exactly.
- **Verdict & why:** CONFIRMED High. Only surviving gate is the optional, default-absent `preSyncAuthorize` hook. Docs call `_server` "mandatory" while the runtime treats it as optional — the contradiction is the root enabler.
- **Recommendation:** Treat a missing `_server` as a hard error (route MUST have `_server`), OR run a default-deny auth gate when `_server` is absent. Reconcile the "mandatory" docs with the runtime.

### SYNC-02 — Socket sync path has no top-level error guard; `validateRequest(user!)` crashes on `additional`-only route  ·  severity: high  ·  status: CONFIRMED
- **Sources:** review(SEC-12); related to review SUMMARY #5 (unhandled-rejection DoS)
- **Current location:** `packages/sync/src/handleSyncRequest.ts:333` (`validateRequest({ auth, user: user! })`), whole body unguarded (contrast HTTP twin `handleHttpSyncRequest.ts:227` `tryCatch` wrapper); caller `packages/server/src/loadSocket.ts:156-159`; `packages/core/src/validateRequest.ts:69` (`condition.key in user`)
- **Original claim:** `handleHttpSyncRequest` wraps its body in `tryCatch` but `handleSyncRequest` does not; `await ioInstance.fetchSockets()` (Redis-adapter timeout) and a `null` user passed to `validateRequest` are unguarded, becoming a fatal unhandledRejection.
- **Verification (current code):** Confirmed. The socket handler's body is NOT wrapped — `readSession`, `getRuntimeSyncMaps`, `fetchSockets()`, and the auth block all run bare. At `:322` `if (auth.login && !user?.id)` is skipped when `auth.login` is false; then `:333` unconditionally calls `validateRequest({ auth, user: user! })`. For a route with `auth: { additional: [...] }` but no `login: true`, an anonymous socket yields `user === null`, and `validateRequest.ts:69` executes `condition.key in user` → `TypeError: Cannot use 'in' operator … in null`. loadSocket.ts:156-159 invokes the handler as `void (async () => { … })()` with no `.catch`, so the throw is an unhandledRejection (fatal on modern Node). The HTTP twin's identical `user!` (`:295`) is at least caught by its `tryCatch`.
- **Verdict & why:** CONFIRMED High. Remotely triggerable by any anonymous socket against a misconfigured `additional`-only route, plus the multi-instance `fetchSockets()` rejection path. The HTTP twin is already protected; the socket path is the regression.
- **Recommendation:** Wrap `handleSyncRequest`'s body in the same `tryCatch` envelope the HTTP path uses (emit `sync.serverExecutionFailed` + `cleanupRequest` on throw), and guard the anonymous case explicitly (`if (auth.additional?.length && !user) return auth.required`) instead of `user!`.

### SYNC-03 — Per-recipient `_client` "filter" pattern leaks full `serverOutput` to every recipient; docs teach it as field-hiding  ·  severity: high  ·  status: CONFIRMED
- **Sources:** review(SEC-11 / SUMMARY #7) + reports(#5, rated Low) — same root cause, MERGED
- **Current location:** `packages/sync/src/_shared/clientFanout.ts:151-159` (success envelope always spreads `serverOutput`); docs `packages/sync/docs/server-vs-client-handlers.md:105` (table row "Hide a field … | Yes | Per-recipient filter") + Example B `:238-269`
- **Original claim:** `serverOutput` is included verbatim in every recipient's frame, but the docs show putting the sensitive record in `serverOutput` and "stripping" it only in `clientOutput` — so the secret travels to every browser, hidden only by render choice.
- **Verification (current code):** Confirmed. `clientFanout.ts:151-159` builds `{ cb, fullName, serverOutput, clientOutput: clientSyncResult, … }` — `serverOutput` is always the full server payload for every recipient. Example B (`server-vs-client-handlers.md:238-269`) returns `{ status: 'success', card }` (with `privateNotes`) from `_server`, then nulls `privateNotes` only in the `_client` `clientOutput` — so `serverOutput.card.privateNotes` reaches every room member's socket frame. The §4 table still lists "Per-recipient filter" as a way to "Hide a field from non-owner viewers".
- **Verdict & why:** CONFIRMED, severity High (review is right; reports #5 underweighted it as Low). This is the canonical "hide a private field" recipe shipping a data leak.
- **Recommendation:** Let `_client` suppress/override the shared `serverOutput` (e.g. honor a per-route `omitServerOutputForRecipients` that emits only `clientOutput` when a `_client` file exists), OR at minimum rewrite Example B + the §4 table to state plainly that `serverOutput` always reaches every recipient unfiltered and sensitive fields must be fetched inside `_client`, never returned from `_server`.

### SYNC-04 — Sync handlers echo raw input-validation messages to clients (schema enumeration); API fix never ported  ·  severity: high  ·  status: CONFIRMED
- **Sources:** review(SEC-25)
- **Current location:** `packages/sync/src/handleSyncRequest.ts:423-424` (`errorParams: [{ key: 'message', value: inputValidation.message }]`), mirror `handleHttpSyncRequest.ts:377`; the ported-elsewhere fix lives in `packages/api/src/_shared/socketValidationStage.ts:70-81`
- **Original claim:** Both sync transports return the detailed validator message to the requesting client; the API package already fixed this (generic code only) but sync never received the same treatment.
- **Verification (current code):** Confirmed. Both sync handlers still put `inputValidation.message` (e.g. "clientInput.userId should be string") into the client-bound error envelope. By contrast `api/_shared/socketValidationStage.ts:70-81` now emits a generic `api.invalidInputType` with NO message and routes the detail to the `postApiValidate` hook + dev logs, with an explicit SECURITY comment. The sync handlers have no such dehydration and no `postSyncValidate` hook.
- **Verdict & why:** CONFIRMED. Any `login:false` sync route lets unauthenticated callers enumerate its input schema; authenticated callers can map every route's schema. review is correct that this is an un-ported API fix.
- **Recommendation:** Mirror the API fix: return generic `sync.invalidInputType` with no `message` param; route the detail to dev logs + a new `postSyncValidate` hook. Apply to both transports.

### SYNC-05 — `RuntimeSyncServerEntry.validation` declared/generated/documented but never read  ·  severity: medium  ·  status: ALREADY-FIXED
- **Sources:** review(QUA-044)
- **Current location:** `packages/sync/src/_shared/validationMode.ts:16` (`resolveSyncValidationMode`); read at `handleSyncRequest.ts:411` and `handleHttpSyncRequest.ts:365`
- **Original claim:** Both handlers unconditionally call `validateInputByType`; a route's `validation: { input: 'skip' }` is silently ignored.
- **Verification (current code):** Fixed since the scan. A new `validationMode.ts` helper interprets `'relaxed'` / `{ input: 'skip' }` → `'relaxed'`, default `'strict'`. Both transports now wrap the `validateInputByType` call in `if (resolveSyncValidationMode(serverSyncEntry.validation) === 'strict')` (socket `:411`, HTTP `:365`). The helper's header comment explicitly cites QUA-044.
- **Verdict & why:** ALREADY-FIXED. The documented escape hatch now works in both transports.
- **Recommendation:** None (regression test would be welcome — see SYNC-19).

### SYNC-06 — Dev loader drops `errorFormatter` + `validation` for sync routes (dev/prod divergence)  ·  severity: high  ·  status: ALREADY-FIXED
- **Sources:** review(QUA-013)
- **Current location:** `packages/devkit/src/loader.ts:362-363` (hot-reload upsert) and `:442-443` (initial scan)
- **Original claim:** The dev loader built sync server entries as only `{ main, auth, inputType, inputTypeFilePath }`, dropping `validation` and `errorFormatter` that the prod generator emits.
- **Verification (current code):** Fixed since the scan. Both `devSyncs` assignment sites now include `validation: resolvedSyncModule.validation` and `errorFormatter: resolvedSyncModule.errorFormatter`, with comments citing QUA-013 / QUA-044.
- **Verdict & why:** ALREADY-FIXED in devkit. (Note: this was a prerequisite for SYNC-05 — both had to land for `validation` to work end-to-end in dev.)
- **Recommendation:** None; a parity test asserting dev-loader ≡ prod-generator sync entry shape would lock it in.

### SYNC-07 — No default receiver authorization: any client can sync into any room or broadcast to `all`  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** review(SEC-27) + reports(#2, #3) — MERGED (room-membership + `'all'` broadcast are the same insecure-by-default root)
- **Current location:** `packages/sync/src/handleSyncRequest.ts:247` (only non-emptiness check on `receiver`), `:499-501` (`receiver === 'all' ? fetchSockets() : in(receiver).fetchSockets()`); hook at `:357`
- **Original claim:** The client-supplied `receiver` is never checked against the sender's `socket.rooms`; `_server.main()` mutates before fanout regardless of membership; `receiver: 'all'` fans out cluster-wide to any client.
- **Verification (current code):** Confirmed. The only `receiver` check is `:247` non-emptiness (`if (!receiver) … missingReceiver`). No `socket.rooms.has(receiver)` anywhere. `_server` runs (mutating state) before the fanout, and `'all'` triggers `ioInstance.fetchSockets()` across every instance. The only mitigation is the opt-in, undocumented-as-required `preSyncAuthorize` hook (`:357`). Combined with SYNC-01, a client-only route makes `'all'` reachable with no auth at all.
- **Verdict & why:** CONFIRMED Medium (insecure-by-default + missing knob, not a missing capability). reports #2/#3 and review SEC-27 agree.
- **Recommendation:** Add `sync.allowClientReceiverAll: false` (reject `'all'` from clients unless enabled) and opt-in `sync.requireRoomMembership: true` (cheap `socket.rooms.has(receiver)` on the socket path). Document `preSyncAuthorize` as the mandatory room-membership gate in `ARCHITECTURE_SYNC.md`.

### SYNC-08 — Unbounded `chunkCounters` map — memory growth / slow DoS; "cleared on teardown" comment is false  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** review(QUA-045) + reports(#4) — MERGED
- **Current location:** `packages/sync/src/_shared/streamEmitters.ts:12` (`const chunkCounters = new Map`), bump-only at `:14-19`, dispatch at `:25`
- **Original claim:** The comment claims entries are "Cleared on receiver-room teardown" but only `.get`/`.set` exist — no `.delete`/`.clear` — so every `(routeName, recipient)` pair (rooms + per-token rooms) leaks one entry forever.
- **Verification (current code):** Confirmed verbatim. `streamEmitters.ts:12` still carries the "Cleared on receiver-room teardown" comment; `bumpChunkIndex` (`:14-19`) only does `get`/`set`; no delete/clear exists in the module. Key is `${routeName}|${recipient}` (`:13`). The counter also never resets per stream, so `postSyncStream`'s `chunkIndex` is a process-lifetime counter, not a per-stream index (semantic drift).
- **Verdict & why:** CONFIRMED Medium — real heap leak on any streaming deployment + misleading false comment + wrong hook payload semantics.
- **Recommendation:** Replace the module-level Map with a per-request counter created inside `buildSyncStreamEmitters` (emitters are already per-request), or evict the key on `cleanupRequest`/`postSyncFanout`. Fix the comment.

### SYNC-09 — `syncRequest` promise never settles when its queued offline request is evicted (drop-oldest / maxAgeMs)  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** review(QUA-046)
- **Current location:** `packages/sync/src/syncRequest.ts:453-468` (resolves only on `enqueued === false`); eviction sites `packages/core/src/offlineQueue.ts:52` (expiry splice), `:73` (drop-oldest shift)
- **Original claim:** syncRequest resolves the caller only when `enqueueSyncRequest` returns false; drop-oldest (`queue.shift()`) and `evictExpired` (splice) silently discard items whose `run` closure is the only thing that can settle the promise — so an awaited evicted send hangs forever.
- **Verification (current code):** Confirmed. `runRequest` (`syncRequest.ts:446`) calls `enqueueSyncRequest({ … run, dropPolicy })` and only `resolve(...)`s on `!enqueued` (`:462`). `offlineQueue.ts` `enqueueWithPolicy` does `queue.shift()` on drop-oldest (`:73`) and `evictExpired` splices (`:52`) — neither invokes any per-item callback (no `onDrop` field exists). The discarded item's promise never resolves/rejects. The default `offlineQueue.dropPolicy` is `'drop-oldest'` (`projectConfig.ts`), and the docs push that policy for cursor-move syncs — so this is the NORMAL overflow path, not an edge case.
- **Verdict & why:** CONFIRMED Medium. `await syncRequest(); updateUI()` freezes whenever the queue evicts that item offline.
- **Recommendation:** Give queue items an `onDrop` callback (invoked on shift/splice/expiry); have syncRequest resolve with `{ status: 'error', errorCode: 'offline.dropped' }`. Apply the same to `apiRequest`'s queue usage.

### SYNC-10 — `attachSyncReceiver` throws synchronously inside the socket event listener on malformed payloads  ·  severity: low  ·  status: CONFIRMED
- **Sources:** review(QUA-084)
- **Current location:** `packages/sync/src/syncRequest.ts:924` (`throw new Error(errorMessage)` inside the `socket.on(socketEventNames.sync, …)` callback)
- **Original claim:** A success-status sync frame with no resolvable route key reaches a `throw` inside the receive bridge — an uncaught exception that can kill other listeners on the same emit; the input is server-controlled.
- **Verification (current code):** Confirmed. At `:916-925`, when `routeKeys.length === 0`, after logging + dev-notify, the code executes `throw new Error(errorMessage)` still inside the `socket.on` callback (the callback runs to `:930`). One malformed server emit detonates the client listener instead of degrading to a logged warning.
- **Verdict & why:** CONFIRMED Low. Already logged + notified just above; replacing `throw` with `return` is a one-line fix with no behavior loss.
- **Recommendation:** Replace the `throw` with `return` after the existing `getLogger().error` + `notify.error` calls.

### SYNC-11 — No per-route rate limit for sync routes (all sync shares the global `defaultApiLimit`)  ·  severity: high  ·  status: CONFIRMED
- **Sources:** review(CFG-06) + reports(Hooks: "No per-route rate-limit override for sync") — MERGED
- **Current location:** `packages/sync/src/handleSyncRequest.ts:81` (`config.rateLimiting.defaultApiLimit`), HTTP twin `handleHttpSyncRequest.ts:87`; loader never reads a sync `rateLimit` export
- **Original claim:** API routes support `export const rateLimit: number | false` per route, but sync routes don't — both handlers only read the global `defaultApiLimit`, so a hot sync route (cursor moves) can't be tuned without weakening every API route.
- **Verification (current code):** Confirmed. `applySyncRateLimits` (`:54-152`) keys the per-route bucket but uses `defaultApiLimit` as the limit (`:81`); there is no read of `serverSyncEntry.rateLimit`. `RuntimeSyncServerEntry` (`syncTypes.ts:54-83`) has no `rateLimit` field, and the dev loader/prod generator don't emit one for sync. The HTTP twin is identical (`:87`).
- **Verdict & why:** CONFIRMED. review rates it high (configurability north-star), reports rates it as a hooks/config gap — both agree it's a real missing knob. Severity high is defensible given the API/sync asymmetry the docs promise.
- **Recommendation:** Support `export const rateLimit: number | false` in sync `_server` files end-to-end (devkit loader + generator + `RuntimeSyncServerEntry`), and use `serverSyncEntry.rateLimit ?? config.rateLimiting.defaultApiLimit` in both transports.

### SYNC-12 — `room-fanout.md` describes the pre-`fetchSockets` implementation (contradicts current code in 3 sections)  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** review(QUA-047) + reports(Docs gaps: "room-fanout.md describes a stale implementation") — MERGED
- **Current location:** `packages/sync/docs/room-fanout.md:13-20` (§1) — current code `handleSyncRequest.ts:499-501`, `:504`
- **Original claim:** §1 shows `ioInstance.sockets.sockets` / `adapter.rooms.get(receiver)` returning `Set | undefined` and says the empty-room signal is "`sockets` is `undefined`/falsy"; the real code uses `await ioInstance.in(receiver).fetchSockets()` returning an array, checked via `sockets.length === 0`. §6/§7 also describe obsolete paths (sticky-sessions workaround) the RemoteSocket fanout obsoleted.
- **Verification (current code):** Confirmed. `room-fanout.md:13-17` still shows `ioInstance.sockets.sockets` / `ioInstance.sockets.adapter.rooms.get(receiver)` and states "`sockets` is `undefined` and the fanout fails with `sync.noReceiversFound`". The actual handler (`:499-501`) uses `fetchSockets()` (array) and checks `sockets.length === 0` (`:504`). The doc ships in the npm tarball.
- **Verdict & why:** CONFIRMED Medium. An AI following these docs reasons about the wrong API and the wrong empty-room signal, and may add unnecessary sticky sessions.
- **Recommendation:** Update §1/§6/§7 to the `fetchSockets`/`RemoteSocket` model; remove the sticky-sessions workaround; fix the empty-room signal to `length === 0`.

### SYNC-13 — `docs/ignore-self.md:124` example compares session tokens against `user.id` (won't exclude sender)  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(Docs gaps: "ignore-self.md:124 has a wrong example")
- **Current location:** `packages/sync/docs/ignore-self.md:124` (`.filter(t => t !== user.id)`)
- **Original claim:** `streamTo(others...)` is built from a room-members token list filtered by `t !== user.id` — comparing tokens against a user id, so it does not exclude the sender.
- **Verification (current code):** Confirmed verbatim. Line 124: `const others = (await functions.session.getRoomMembers(roomCode)).filter(t => t !== user.id);` — `getRoomMembers` returns tokens, `user.id` is a user id, so the filter never matches and the sender is NOT excluded. Misleading copy-paste for the exact scenario the section documents.
- **Verdict & why:** CONFIRMED Low (docs only).
- **Recommendation:** Filter against the sender's token (e.g. `user.token`) or document that `getRoomMembers` returns tokens and the comparison key must match.

### SYNC-14 — Sync `CLAUDE.md` hook table omits 3 of the 7 dispatched hooks  ·  severity: low  ·  status: CONFIRMED
- **Sources:** review(MIS-027)
- **Current location:** `packages/sync/CLAUDE.md` "Hooks dispatched by the server handler" table
- **Original claim:** The table lists only preSyncAuthorize, preSyncFanout, postSyncFanout, rateLimitExceeded; the code also dispatches postSyncAuthorize (`handleSyncRequest.ts:384`), preSyncStream + postSyncStream (`streamEmitters.ts:24-26`).
- **Verification (current code):** Confirmed. The package CLAUDE.md hook table has exactly those 4 rows. The handler dispatches `postSyncAuthorize` at `:384`; `streamEmitters.ts:24-26` dispatches `preSyncStream` and `postSyncStream` per chunk. Three real extension points are undocumented in the AI-facing INDEX.
- **Verdict & why:** CONFIRMED Low (docs gap; AI consumers will conclude the hooks don't exist).
- **Recommendation:** Add postSyncAuthorize, preSyncStream, postSyncStream rows to the table; mirror into `server-vs-client-handlers.md` / `streaming.md`; regenerate `docs/AI_QUICK_INDEX.md`.

### SYNC-15 — Sync stream backpressure sampling constants hardcoded (32 sockets / 10ms / 1KB)  ·  severity: low  ·  status: CONFIRMED
- **Sources:** review(CFG-41) + reports(Missing config: "Hardcoded backpressure constants") — MERGED
- **Current location:** `packages/sync/src/_shared/streamEmitters.ts:60` (`AVG_PACKET_BYTES = 1024`), `:61` (`POLL_INTERVAL_MS = 10`), `:64` (`MAX_SOCKETS_FOR_PRESSURE_SAMPLE = 32`)
- **Original claim:** None of the three constants are reachable via projectConfig; only the per-call `thresholdBytes` is tunable, so large frames / big rooms / latency-sensitive streams can't tune the pressure model.
- **Verification (current code):** Confirmed verbatim at the cited lines. `projectConfig.sync` (`projectConfig.ts:512-520`) exposes only `streamThrottle.*`, `fanoutYieldEvery`, `fanoutYieldMs` — none of the three flush-pressure constants.
- **Verdict & why:** CONFIRMED Low (hardening/configurability).
- **Recommendation:** Move the three into `projectConfig.sync.flushPressure: { avgPacketBytes, pollIntervalMs, maxSampledSockets }` with current values as defaults.

### SYNC-16 — `fanoutYieldEvery` modulo with no zero-guard  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(#6)
- **Current location:** `packages/sync/src/handleSyncRequest.ts:550` (`if (tempCount % fanoutYieldEvery === 0)`); default `projectConfig.ts:519` `fanoutYieldEvery: 100`
- **Original claim:** A consumer setting `sync.fanoutYieldEvery: 0` yields `n % 0 === NaN`, so the loop never yields and a `receiver: 'all'` fanout can block the event loop.
- **Verification (current code):** Confirmed. `:550` is `if (tempCount % fanoutYieldEvery === 0) { await … }` with no clamp; default is 100 but a misconfigured `0` produces `NaN` (never truthy) → no yielding.
- **Verdict & why:** CONFIRMED Low (misconfiguration hardening).
- **Recommendation:** Clamp to `Math.max(1, fanoutYieldEvery)`.

### SYNC-17 — Raw session tokens flow into Sentry/tryCatch context + stream logs without redaction  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** review(SEC-26)
- **Current location:** `packages/sync/src/_shared/clientFanout.ts:111` (`targetToken: tempToken` in tryCatch context); `packages/sync/src/_shared/streamEmitters.ts:223` (`getLogger().debug(… { tokens: filtered, payload })`)
- **Original claim:** `clientFanout` passes the recipient's raw session token as tryCatch context, which `captureException` forwards verbatim to the error tracker; `streamEmitters` logs the full `streamTo` token list when `logging.stream` is on. Neither key is in the default redaction set.
- **Verification (current code):** Confirmed. `clientFanout.ts:103-114` calls `tryCatch(…, { handler, sync, stage, sourceUserId, targetToken: tempToken, receiver, transport })` — `targetToken` is the recipient's live token, persisted to the error tracker on any `_client` throw. `streamEmitters.ts:222-223` logs `{ tokens: filtered, payload }` (the raw `streamTo` token list) under `shouldLogStream()`. Neither `targetToken` nor `tokens` is a default redacted key.
- **Verdict & why:** CONFIRMED Medium. Live bearer credentials reach the error tracker / stream logs, defeating HttpOnly-cookie mode and the redaction facility.
- **Recommendation:** Hash/truncate tokens before placing them in tryCatch context (`token.slice(0,8)+'…'`); add `targettoken`/`tokens` to `DEFAULT_REDACTED_LOG_KEYS`; run capture extra-context through `sanitizeForLog`.

### SYNC-18 — No server-initiated typed sync emit (cron/webhook fan-out)  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** review(MIS-018)
- **Current location:** `packages/sync/src/index.ts:5-15` (only `handleSyncRequest`, `handleHttpSyncRequest`, `createStreamThrottle` exported)
- **Original claim:** Both entry points require a client context (a live Socket or a session token), so cron jobs / webhooks can't trigger a typed sync fanout without impersonating a client or hand-rolling `io.to(room).emit`.
- **Verification (current code):** Confirmed. `index.ts` exports no `emitServerSync`/`pushSync`/server-initiated helper. `handleSyncRequest` needs a `Socket`; `handleHttpSyncRequest` needs a `token` to pass `auth.login` routes. A background job has neither.
- **Verdict & why:** CONFIRMED Medium (missing feature). A realtime framework should support server-originated pushes through the typed pipeline.
- **Recommendation:** Export `emitServerSync({ name, version, data, receiver, ignoreSelf? })` that runs the existing pipeline (skip auth/rate-limit, run `_server` with a configurable system identity, then normal fanout + `_client` + hooks); document the cron/webhook recipe in `ARCHITECTURE_SYNC.md`.

### SYNC-19 — No tests for either sync transport handler's security pipeline  ·  severity: low  ·  status: CONFIRMED
- **Sources:** review(QUA-083)
- **Current location:** `packages/sync/src/handleSyncRequest.ts` + `handleHttpSyncRequest.ts` (existing tests cover only streamThrottle / streamEmitters)
- **Original claim:** Zero unit tests for either handler; auth.login / validateRequest gates, ignoreSelf semantics, fanout error paths, and the no-raw-message rule have no regression coverage.
- **Verification (current code):** Confirmed by absence — the package's tests are streamThrottle/streamEmitters only; no handler-level suite exists. This is also why SYNC-02/SYNC-04 could regress/never-port unnoticed.
- **Verdict & why:** CONFIRMED Low (test gap, but it is the safety net for the High findings above).
- **Recommendation:** Add vitest coverage with a mocked io + syncObject: login-required rejection, `additional`-auth rejection with null user (SYNC-02), rate-limit reject + hook, validation-failure envelope without raw message (SYNC-04), ignoreSelf skip, per-recipient error isolation, validation-mode skip (SYNC-05).

### SYNC-20 — Blanket `/* eslint-disable */` across both sync transport handlers  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** review(QUA-002, the pkg-sync slice of the merged entry)
- **Current location:** `packages/sync/src/handleSyncRequest.ts:1-2` and `packages/sync/src/handleHttpSyncRequest.ts:1-2` (`/* eslint-disable unicorn/no-abusive-eslint-disable */` + `/* eslint-disable */`)
- **Original claim:** Both ~600/540-line security-critical sync handlers open with a blanket eslint-disable, hiding lint findings (including casts) across the whole file.
- **Verification (current code):** Confirmed verbatim — both files start with the two disable comments. This masks, e.g., any `as` casts and the conditional-auth gate complexity (which is exactly what makes SYNC-01 easy to miss).
- **Verdict & why:** CONFIRMED Medium. A blanket disable on the framework's most security-sensitive transport files is the wrong default.
- **Recommendation:** Replace the blanket disable with targeted per-line/per-rule disables (each with a reason), or fix the underlying lint findings.

### SYNC-21 — `handleSyncRequest` god function + duplicated pipeline drift between socket and HTTP transports  ·  severity: medium  ·  status: PARTIALLY-FIXED
- **Sources:** reports(Code quality: "god function" + "duplicated pipeline")
- **Current location:** `packages/sync/src/handleSyncRequest.ts:156-614` (~460 lines) vs `handleHttpSyncRequest.ts:162-545`; shared helpers `_shared/clientFanout.ts`, `_shared/streamEmitters.ts`, `_shared/validationMode.ts`, `_shared/errorBuilders.ts`, `_shared/syncTypes.ts`
- **Original claim:** The handler is a ~460-line god function with ~10 near-identical error-emit blocks; the two transports re-implement auth/validation/exec/fanout and have already drifted (socket yields the event loop + dispatches postSyncAuthorize; HTTP does neither).
- **Verification (current code):** Partially addressed. Significant shared extraction has happened since the original report — `processClientSyncForRecipient` (clientFanout), `buildSyncStreamEmitters` (streamEmitters), `resolveSyncValidationMode`, `buildFormattedError`, and the shared `syncTypes` now single-source the per-recipient loop, stream emitters, validation mode, error shaping, and runtime types. BUT the top-level pipeline is still duplicated across the two files and the drift the report named persists: the socket path dispatches `postSyncAuthorize` (`:384`) and yields the event loop (`:550`); the HTTP path does NEITHER (no postSyncAuthorize, no fanout yield). The socket handler is also still ~460 lines with many repeated `socket.emit(buildSyncResponseEventName(...), buildSyncError(...))` blocks. Critically, the SEC-12 tryCatch divergence (HTTP wrapped, socket not) is a live instance of exactly this drift risk.
- **Verdict & why:** PARTIALLY-FIXED. Shared sub-helpers landed; the pipeline body is still two drifting copies and the named drift (postSyncAuthorize, yield, tryCatch) is real.
- **Recommendation:** Extract the shared pipeline stages (auth gate, rate-limit, validate, `_server` exec, fanout) into transport-agnostic functions the way the per-recipient loop already is; reconcile the postSyncAuthorize + yield + tryCatch divergence (the tryCatch one is SYNC-02).

### SYNC-22 — No hook to mutate/filter the recipient set before fanout (stoppable per-recipient delivery)  ·  severity: low  ·  status: CONFIRMED
- **Sources:** review(HOK-28) + reports(Hooks: "No hook to mutate/filter the recipient socket set") — MERGED
- **Current location:** `packages/sync/src/_shared/clientFanout.ts:103` (per-recipient loop, no pre-recipient hook); `handleSyncRequest.ts:528` (`preSyncFanout` is all-or-nothing)
- **Original claim:** `preSyncFanout` can only stop the whole fanout; there is no per-recipient hook, so cross-cutting mute/block policies must be duplicated in every `_client` file.
- **Verification (current code):** Confirmed. `preSyncFanout` (`:528`) gates the whole fanout; the per-recipient loop (`:548-603`) has no `preSyncRecipient`/`onSyncDeliver` hook before `processClientSyncForRecipient` / the server-only emit. The only per-recipient injection point is the route's own `_client` file.
- **Verdict & why:** CONFIRMED Low (missing extension point / feature request).
- **Recommendation:** Dispatch a stoppable `preSyncRecipient` hook per recipient (`{ routeName, receiver, recipientToken, sourceUserId, serverOutput, transport }`); a stop signal skips that recipient without bumping `recipientCount`.

### SYNC-23 — No validate/execute lifecycle hooks for sync (failed `_server` runs invisible to hook consumers)  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** review(HOK-16)
- **Current location:** `packages/sync/src/handleSyncRequest.ts:411` (validate, no hook), `:455-486` (error paths, no hook), `:528` (preSyncFanout success-only)
- **Original claim:** Sync has no counterpart to the API pipeline's `pre/postApiValidate` and `pre/postApiExecute`; when `_server` throws or returns an error, no hook fires (preSyncFanout only dispatches on success), so audit/latency/alerting on failing sync mutations can't be built without forking.
- **Verification (current code):** Confirmed. `validateInputByType` runs at `:411` with no surrounding hook; the `_server` error/throw branches (`:455-486`) dispatch no hook; `preSyncFanout` fires only after a successful `_server` (`:528`). No `preSyncValidate`/`postSyncValidate`/`preSyncExecute`/`postSyncExecute` exist.
- **Verdict & why:** CONFIRMED Medium (missing observability hooks; also degrades error-tracking span-close fidelity on sync error paths). Related to SYNC-04's recommended `postSyncValidate`.
- **Recommendation:** Add `pre/postSyncValidate` (around `validateInputByType`) and `pre/postSyncExecute` (around the `_server` tryCatch, payload `{ routeName, data, user, receiver, result, error, durationMs, transport }`) in both transports.

### SYNC-24 — `_client` handlers cannot run for cross-instance recipients / cannot veto fanout (hard block)  ·  severity: low  ·  status: UNCERTAIN
- **Sources:** reports(Hard blocks)
- **Current location:** `packages/sync/src/handleSyncRequest.ts:563-587` (per-recipient `_client` dispatch over `fetchSockets()` results, which include `RemoteSocket`s); docs `room-fanout.md` §7
- **Original claim:** With the Redis adapter, `fetchSockets()` returns `RemoteSocket` objects for other instances; per-recipient `_client` execution/branding against remote recipients is structurally limited, and a `_client` error only affects that recipient (cannot abort the broadcast).
- **Verification (current code):** The current handler iterates ALL `fetchSockets()` results (local + RemoteSocket) and calls `processClientSyncForRecipient` for each. `RemoteSocket.emit()` routes to the owning instance, and `extractTokenFromSocket(tempSocket)` reads the handshake — but whether a `RemoteSocket`'s handshake headers are fully populated cross-instance (so per-recipient token redaction works identically to local sockets) is a runtime property of the Redis adapter I can't confirm by static reading. The "`_client` cannot veto the whole fanout" half IS true by construction (errors are per-recipient, `clientFanout.ts:117-149` continues).
- **Verdict & why:** UNCERTAIN — the veto-limitation is real-but-by-design (Low); the cross-instance `_client` fidelity claim needs a multi-instance runtime test to confirm whether `RemoteSocket` handshake data drives the same redaction. Note this overlaps SYNC-03 as the real leak vector is `serverOutput`, not `_client` fidelity.
- **Recommendation:** If cross-instance per-recipient redaction matters, add a multi-instance integration test asserting a `_client` route redacts identically for remote recipients; document the `_client`-can't-veto contract in `server-vs-client-handlers.md`.
