# extensibility — Verified & Merged Audit Findings
Sources: reports/extensibility.md + review/v0.2.0/* · Verified against current working tree (branch chore/package-split-prep, 2026-06-11).

## Verdict summary
Across both scans this area produced 24 distinct findings after de-duplication. **23 are CONFIRMED present in the current tree, 1 is REFUTED** (review HOK-15 / reports#4 claimed there is no post-HTTP hook AND mischaracterised `postSyncAuthorize` as missing — the latter half is wrong: `postSyncAuthorize` exists in core types). The commit that ran between the older `review/v0.2.0/` scan and now (302cbf1 "fixed bugs on login page and wizard/cli flow") touched the login/wizard/CLI surface, **not the extension-point surface** — so essentially nothing in this area changed and the older scan's hook/lifecycle findings still hold. The `reports/extensibility.md` scan (which had its own adversarial pass) is accurate to the current code on every finding I re-checked. The biggest live issues are structural extension-seam gaps, all consistent across both scans: (a) no server start/stop lifecycle hook or `RunningLuckyStackServer.stop()` for graceful shutdown (reports#3); (b) no per-message socket-transport interception seam mirroring `preHttpRequest` (reports#1/2 + HOK-16); (c) no client-side request interceptor on `apiRequest` (reports#6); (d) no post-HTTP-request observability hook for the full HTTP surface (reports#4 / HOK-15); (e) no `unregisterHook` on the server hook bus (HOK-06); and a cluster of missing observability hooks on rejection/failure paths (auth-rejection HOK-04, login-failure HOK-10, router edge-block HOK-13). No critical or high *security* issues surfaced in the extension surface; the single security-flavoured finding is the dev-only `clearAllHooks` foot-gun (Medium per reports, fail-closed on NODE_ENV+token).

Note on scope: the `review/v0.2.0/HOOKS.md` scan attributes many hook gaps to individual packages (presence, email, error-tracking, secret-manager, test-runner, devkit, cli). Those that are genuinely about a *missing extension seam* in `packages/` are included below; package-internal behavioural/security findings that belong to other audit areas (e.g. presence token-logging SEC-28, email ConsoleSender SEC-04, router XFF SEC-08) are out of scope here and are covered by their own area files.

## Findings

### EXT-01 — No server start/stop lifecycle hooks or `stop()` for graceful shutdown · severity: high · status: CONFIRMED
- **Sources:** reports(#3) + review(MIS-026)
- **Current location:** `packages/server/src/createServer.ts:105-106` (SIGINT/SIGTERM → `process.exit(0)`), `:133-186` (`listen`), `:186` (`return { httpServer, ioServer, listen }`)
- **Original claim:** `listen()` resolves and calls an optional `callback?.()` but dispatches no hook; `RunningLuckyStackServer` exposes no `stop()`/`close()`; SIGINT/SIGTERM call `process.exit(0)` directly with no drain. No way to flush queues / close pools / finish in-flight streams on shutdown.
- **Verification (current code):** Re-read in full. `createServer.ts:186` returns exactly `{ httpServer, ioServer, listen }` — no `stop`/`close`. The dev branch (`:105-106`) registers `process.once('SIGINT'|'SIGTERM', () => process.exit(0))` with no drain window. `listen` (`:133-184`) resolves the HTTP server and fires `callback?.()` (`:178`) but dispatches no hook. No `onServerListening`/`preServerStop`/`postServerStop` name exists in core's HookPayloads. The router has the pattern the server lacks (`startRouter` returns `stop()`).
- **Verdict & why:** CONFIRMED. Most material extensibility gap in the area; both scans independently flagged it. Severity high (graceful shutdown is a real production need: DB pools, in-flight sync streams, service-mesh deregistration).
- **Recommendation:** Add `onServerListening` / `preServerStop` hooks and a `stop()` on `RunningLuckyStackServer` with a configurable drain window; wire SIGINT/SIGTERM to call it before `process.exit`.

### EXT-02 — Socket-message handlers bypass any per-message interception seam (no `preSocketMessage` mirroring `preHttpRequest`) · severity: high · status: CONFIRMED
- **Sources:** reports(#1 + #2 partial) + review(HOK-16 partial)
- **Current location:** `packages/server/src/loadSocket.ts:147-161` (api/sync dispatch), `:109` (`applySocketMiddlewares` — handshake-only)
- **Original claim:** Incoming socket api/sync messages dispatch directly with no per-message hook analogous to `preHttpRequest`; the only socket interception seam is `io.use` (runs once at handshake). A consumer cannot gate/throttle/audit individual socket messages without reaching into framework internals.
- **Verification (current code):** Confirmed. `loadSocket.ts:147-149` wires `socket.on(apiRequest, msg => void handleApiRequest(...))` and `:155-160` the sync listener, both dispatching straight into the pipeline. `applySocketMiddlewares(io)` is called once at `:109` before the connect handler (handshake `io.use`), not per message. No `preSocketMessage`/`preSocketApi`/`preSocketSync` hook name exists. Authz is covered inside the pipeline (`preApiValidate`, `preSyncAuthorize`) but a transport-level "stop this message" stop-signal seam is absent — the HTTP path has `preHttpRequest` (stop-capable), the socket path has no equivalent.
- **Verdict & why:** CONFIRMED. reports rated Medium; I raise the *combined* extensibility weight to high because it pairs with EXT-04 (sync execute/validate hooks) and EXT-13 to leave the entire socket transport without a top-level interception point. The asymmetry with the HTTP path (which HAS a stop-capable hook) is the core defect.
- **Recommendation:** Add a `preSocketMessage`-style stop-signal hook at the top of `handleApiRequest`/`handleSyncRequest`, mirroring `preHttpRequest`.

### EXT-03 — No client-side request interceptor / retry / header-injection seam on `apiRequest` · severity: high · status: CONFIRMED
- **Sources:** reports(#6)
- **Current location:** `packages/core/src/apiRequest.ts` (whole function, ~474 lines; emits `socketEventNames.apiRequest` directly)
- **Original claim:** `apiRequest` is a monolithic function with no client-side request hook; the `clientHookBus` only fires login transitions. A consumer cannot wedge a correlation id / feature-flag context onto outgoing calls or implement custom retry, and Rule 21 / the `no-unsafe-api-wrappers` lint actively discourage wrapping it.
- **Verification (current code):** Confirmed by grep: no `interceptor`/`registerRequestInterceptor`/`preApiRequest`/`clientHookBus` reference anywhere in `apiRequest.ts`. `clientHookBus.ts` (`ClientHookPayloadMap`) carries only `preLogin`/`postLogin`/`postLogout` — no request-level client hook. The offline queue is the only built-in resilience and its policy is config-only.
- **Verdict & why:** CONFIRMED. A genuine dead-spot, sharpened by the lint rule that forbids the obvious workaround (wrapping `apiRequest`). High because it is the one client-transport extension point with no escape hatch that doesn't violate a project rule.
- **Recommendation:** Add a client request/response interceptor registry on the core client subpath (typed, so route/version inference survives — not a wrapper).

### EXT-04 — No validate/execute lifecycle hooks for sync; failed `_server` executions are invisible to hook consumers · severity: high · status: CONFIRMED
- **Sources:** review(HOK-16) + reports(#18 partial — same root cause: undecomposed pipeline)
- **Current location:** `packages/sync/src/handleSyncRequest.ts` (613 lines; validate ~407, error paths ~449-480, `preSyncFanout` success-only ~522)
- **Original claim:** Sync has `preSyncAuthorize`/`postSyncAuthorize`/`preSyncFanout`/`postSyncFanout`/`preSyncStream`/`postSyncStream` but no `preSyncValidate`/`postSyncValidate` around input validation and no `preSyncExecute`/`postSyncExecute` around `_server`. When `_server` throws/returns an error, NO hook fires (`preSyncFanout` only dispatches on success). The API pipeline has the counterparts (`preApiValidate`/`postApiValidate`, `preApiExecute`/`postApiExecute` with `{ result, error, durationMs }`).
- **Verification (current code):** Confirmed structurally. core types has `postSyncAuthorize` (`types.ts:310`) but no `preSyncValidate`/`postSyncValidate`/`preSyncExecute`/`postSyncExecute` names. `handleSyncRequest.ts` is 613 lines with auth/rate-limit/validate/server-run/fanout/stream interleaved — the missing hooks are a direct consequence of the pipeline not being decomposed into hookable stages the way `@luckystack/api` was. Audit/latency/error-alerting on sync mutations cannot be built without forking.
- **Verdict & why:** CONFIRMED. The API↔sync hook-parity gap is real and the error-path invisibility is the sharp edge (error-tracking auto-instrumentation also loses span-close fidelity here). High.
- **Recommendation:** Add `preSyncValidate`/`postSyncValidate` and `preSyncExecute`/`postSyncExecute` mirroring the API payloads, in both sync transports.

### EXT-05 — No `postHttpRequest`/`postHttpResponse` hook for the full HTTP surface · severity: med · status: CONFIRMED
- **Sources:** reports(#4) + review(HOK-15)
- **Current location:** `packages/server/src/httpHandler.ts:242-262` (only `preHttpRequest` dispatched)
- **Original claim:** `preHttpRequest` fires before dispatch and can stop, but there is no `postHttpResponse`/`postHttpRequest` covering EVERY response (static files, SPA fallback, auth routes, health probes, custom routes, origin-gate 403s). The API-pipeline `transformApiResponse`/`postApiRespond` only cover `/api`; `postSyncFanout` only `/sync`. An access log / RED metrics / slow-request alert — the exact use `preHttpRequest`'s own comment advertises ("latency timer") — has a timer-start hook but no timer-stop hook.
- **Verification (current code):** Confirmed by grep: `httpHandler.ts` has `preHttpRequest` (`:250`) and no `postHttpRequest`/`postHttpResponse`/`res.on('finish')` hook. core types carries no `postHttpRequest` name.
- **Verdict & why:** CONFIRMED. Both scans agree (reports#4 Medium, HOK-15 Medium) — severity reconciled at Medium. Note review framed this finding while ALSO (in the merged HOK-15 prose elsewhere) being correct that `postSyncAuthorize` exists — see EXT-24 for the one place review got it wrong.
- **Recommendation:** Dispatch `postHttpRequest` from a `res.on('finish')` listener with `{ method, url, requestId, origin, statusCode, durationMs }`.

### EXT-06 — `registerHook`/`registerSyncHook` have no unregistration (server bus inconsistent with client bus) · severity: med · status: CONFIRMED
- **Sources:** review(HOK-06)
- **Current location:** `packages/core/src/hooks/registry.ts:24-31` (`registerHook` → `void`), `:75-82` (`registerSyncHook` → `void`), `:64-67` (`clearAllHooks`, test-only)
- **Original claim:** Both register functions push into module Maps and return `void`; no `unregisterHook`, no returned unsubscribe; `clearAllHooks` is the only removal and it's test-only (and nukes framework handlers). The client-side `clientHookBus` already returns an unsubscribe — the server side is inconsistent.
- **Verification (current code):** Confirmed verbatim. `registerHook` (`:24-31`) and `registerSyncHook` (`:75-82`) both return `void`. `clientHookBus.ts` (`onClientHook`) returns an unsubscribe closure — the inconsistency is real. Re-registering on dev hot-reload accumulates duplicate handlers that all fire.
- **Verdict & why:** CONFIRMED. Backwards-compatible fix (current return is `void`). Medium.
- **Recommendation:** Make `registerHook`/`registerSyncHook` return a `() => void` that splices the exact handler, matching the client bus contract.

### EXT-07 — `clearAllHooks()` via `/_test/reset?include=hooks` drops framework-internal handlers · severity: low · status: CONFIRMED
- **Sources:** reports(#2)
- **Current location:** `packages/server/src/httpRoutes/testResetRoute.ts:75-78`, `packages/core/src/hooks/registry.ts:64-67`
- **Original claim:** `clearAllHooks()` calls `hookHandlers.clear(); syncHookHandlers.clear();` with no framework-vs-consumer distinction; after a reset with `include=hooks`, presence cleanup / any framework hook silently stops firing. Route is fail-closed on NODE_ENV + TEST_RESET_TOKEN (dev/test only).
- **Verification (current code):** Confirmed. `testResetRoute.ts:75-78` calls `clearAllHooks()` when `include` contains `hooks`; `registry.ts:64-67` clears both maps indiscriminately (the comment itself warns it breaks framework-internal hooks). Fail-closed gating verified upstream in the same route.
- **Verdict & why:** CONFIRMED. Dev/test-only foot-gun, not a production exposure — Low is correct.
- **Recommendation:** Tag handlers with origin (`framework`|`consumer`) and clear only consumer handlers, or re-arm framework hooks after a clear.

### EXT-08 — No auth-rejection hook on the API request lifecycle · severity: med · status: CONFIRMED
- **Sources:** review(HOK-04)
- **Current location:** `packages/api/src/handleApiRequest.ts:70-105` (`checkApiAuth`, emits `auth.required`/`auth.forbidden`), `:471` (call site)
- **Original claim:** `checkApiAuth` emits 401/403 envelopes but dispatches no hook on auth denial, unlike every other rejection class (`rateLimitExceeded`, `csrfMismatch`, `corsRejected`). No `apiAuthRejected`/`authFailed` entry in HookPayloads. Consumers cannot audit failed authorization / detect credential-stuffing without forking.
- **Verification (current code):** Confirmed by grep: `checkApiAuth` returns `auth.required` (`:81`) / `auth.forbidden` (`:95`) with no `dispatchHook('apiAuthRejected'…)`/`dispatchHook('authFailed'…)` call. core types carries no such hook name. The contrast with `applyApiRateLimits` firing `rateLimitExceeded` is accurate.
- **Verdict & why:** CONFIRMED. Real observability asymmetry. Medium.
- **Recommendation:** Fire `apiAuthRejected` (fire-and-forget, like `rateLimitExceeded`) from both transports on the auth-fail path with `{ routeName, reason, errorCode, userId?, transport, ip? }`.

### EXT-09 — No hook on FAILED login/register attempts · severity: med · status: CONFIRMED
- **Sources:** review(HOK-10)
- **Current location:** `packages/login/src/login.ts` (failure returns at the credentials/oauth paths; `postLogin` fires only on success)
- **Original claim:** Every login/register failure path returns early with a reason and dispatches nothing; `postLogin` fires only on success and `preLogin` can veto but not observe outcomes. No per-account brute-force lockout / SIEM feed possible without forking. (A prior audit blessed per-IP rate limiting, but counter-based lockout needs a failure signal.)
- **Verification (current code):** Confirmed by core-types absence: no `loginFailed`/`authFailed` hook name exists in `packages/core/src/hooks/types.ts`. The login package dispatches pre/post for login/register/logout/session* but nothing on failure. (Re-checked the hook inventory; consistent with both the review evidence and the api-package auth-rejection gap EXT-08.)
- **Verdict & why:** CONFIRMED. The one gap in an otherwise rich login hook surface. Medium.
- **Recommendation:** Add an observational `loginFailed: { email?, userId?, provider, reason, stage }` dispatched fire-and-forget on each failure return.

### EXT-10 — No edge request-blocking hook in the router proxy (`preProxyRequest` cannot reject/mutate) · severity: med · status: CONFIRMED
- **Sources:** review(HOK-13)
- **Current location:** `packages/router/src/httpProxy.ts:51-59`
- **Original claim:** `preProxyRequest` is dispatched fire-and-forget (`void dispatchHook(...)`) and the upstream request proceeds immediately; the hook collects no return value. A consumer running the router as their edge cannot block a request (IP/geo ban, maintenance short-circuit, lightweight WAF, edge auth) without forking — contradicting the router's stated selling point "intercept proxy traffic without forking" (router CLAUDE.md).
- **Verification (current code):** Confirmed. `httpProxy.ts:51` is `void dispatchHook('preProxyRequest', {...})` and `transport.request(...)` starts at `:59` regardless of any result. The hook bus IS stop-signal capable (`dispatchHook` returns `DispatchResult`), but this call site discards it.
- **Verdict & why:** CONFIRMED. Medium. The capability to make it a gate already exists in the hook bus; only the call site needs an awaited, decision-returning variant.
- **Recommendation:** Add an awaited `proxyRequestGate` returning `{ action: 'allow' } | { action: 'deny', statusCode, body }` before `transport.request`; keep `preProxyRequest` as the observe-only hook.

### EXT-11 — `SessionProvider` interface fixed at 4 methods; no provider-level session enumeration / per-user revocation · severity: med · status: CONFIRMED
- **Sources:** reports(#5)
- **Current location:** `packages/core/src/sessionProviderRegistry.ts:31-41`
- **Original claim:** `SessionProvider` is `{ getSession, saveSession, deleteSession, logout }`. A consumer replacing the whole provider loses admin enumeration / per-user revocation (which live only in login's `session.ts` / `sessionAdapter.ts`). The richer surface is only reachable via login.
- **Verification (current code):** Confirmed verbatim — interface is exactly those 4 methods (`:31-41`), no `listAll`/`revokeUser`. The two-tier design (provider in core, adapter in login) is real.
- **Verdict & why:** CONFIRMED, but this is a *conscious* layering choice (whole-provider replacement is the advanced path; adapter-swap is preferred). Medium-leaning-low as an extensibility gap.
- **Recommendation:** Document whole-provider replacement as advanced and adapter-swap as preferred; or widen `SessionProvider` with optional `listAll`/`revokeUser`.

### EXT-12 — Redis structurally assumed at boot (socket adapter + boot-UUID) with no "no-Redis" opt-out · severity: med · status: CONFIRMED
- **Sources:** reports(#7)
- **Current location:** `packages/server/src/loadSocket.ts:113` (`attachSocketRedisAdapter(io)` unconditional), `packages/server/src/createServer.ts:117-123` (`writeBootUuid` mandatory, hard-throws)
- **Original claim:** `attachSocketRedisAdapter` is called unconditionally (duplicates two Redis clients) and `writeBootUuid()` hard-throws on failure. Rate limiter falls back to memory and the session adapter is swappable, but the socket adapter and boot-UUID write are not behind a seam — a single-instance no-Redis deploy can't cleanly boot.
- **Verification (current code):** Confirmed. `loadSocket.ts:113` calls `attachSocketRedisAdapter(io)` with no guard (comment even says "safe overhead in single-instance deploys" — i.e. always attached). `createServer.ts:117-123` wraps `writeBootUuid()` in tryCatch and re-throws a descriptive Error on failure (boot halts). No `redis.enabled: false` config gate exists.
- **Verdict & why:** CONFIRMED. Listed as a missing opt-out seam, not a bug. Medium. (The router has `--no-shared-health`; the server has no equivalent.)
- **Recommendation:** Gate `attachSocketRedisAdapter` + `writeBootUuid` behind a config flag (e.g. `redis.enabled: false` → in-memory adapter, skip boot-UUID).

### EXT-13 — Express/Fastify cannot be layered on (raw Node HTTP + dispatch table owned by the framework) · severity: low · status: CONFIRMED (documented boundary)
- **Sources:** reports(#8)
- **Current location:** `packages/server/src/createServer.ts:125-127`, `packages/server/src/httpHandler.ts:81-102` (`PRE_PARAMS_ROUTES`/`POST_PARAMS_ROUTES`)
- **Original claim:** `http.createServer((req,res) => handleHttpRequest(...))` hard-wires the framework's own router arrays; the only seam is `registerCustomRoute` + `customRoutes`. No way to mount an Express `app`/Fastify instance.
- **Verification (current code):** Confirmed. `createServer.ts:125-127` is the literal `http.createServer` call into `handleHttpRequest`; `httpHandler.ts:81-102` are the two fixed route arrays. `registerCustomRoute('pre-params')` does get the raw `req` stream.
- **Verdict & why:** CONFIRMED but it is an explicitly documented architectural boundary (`packages/server/CLAUDE.md`: "Replacing the HTTP layer with Express/Fastify ... breaks the route handler contract"). A genuine hard block for consumers who need it, but conscious. Low.
- **Recommendation:** None required; optionally document a "mount Express under a `pre-params` custom route" pattern.

### EXT-14 — WS upgrades in a multi-instance router are pinned to the `system` service · severity: low · status: CONFIRMED (documented boundary)
- **Sources:** reports(#9)
- **Current location:** `packages/router/src/wsProxy.ts` (per router CLAUDE.md + `docs/ARCHITECTURE_MULTI_INSTANCE.md`)
- **Original claim:** `createWsProxy` pins all upgrades to the `system` backend; a deployment wanting sockets on a non-`system` preset cannot route them there.
- **Verification (current code):** Confirmed via router CLAUDE.md function index ("Pins all upgrades to the `system` service backend; Socket.io's Redis adapter handles cross-instance fanout") and the multi-instance arch doc. Structural and documented.
- **Verdict & why:** CONFIRMED, documented. Low — flagged for completeness only.
- **Recommendation:** None (documented).

### EXT-15 — Socket-message backpressure poll interval (10 ms) + avg-packet-size (1024 B) + 32-socket sample cap hardcoded · severity: low · status: CONFIRMED
- **Sources:** reports(#10)
- **Current location:** `packages/api/src/_shared/backpressure.ts:19,34`, `packages/sync/src/_shared/streamEmitters.ts:59-64`
- **Original claim:** `setTimeout(resolve, 10)` poll + `/1024` packet conversion in the api helper; `AVG_PACKET_BYTES = 1024`, `POLL_INTERVAL_MS = 10`, `MAX_SOCKETS_FOR_PRESSURE_SAMPLE = 32` in sync. Only `thresholdBytes` is consumer-tunable per-call.
- **Verification (current code):** Confirmed verbatim. `backpressure.ts:19` is `Math.ceil(effectiveThresholdBytes / 1024)`, `:34` is `setTimeout(resolve, 10)`. `streamEmitters.ts:60-64` declares the three module constants exactly as claimed. Not in `projectConfig`.
- **Verdict & why:** CONFIRMED. Low. High-throughput LLM-streaming consumers can't tune drain cadence or the packet-size heuristic.
- **Recommendation:** Surface `sync.streamBackpressure.{pollIntervalMs, avgPacketBytes, maxSocketsForPressureSample}` in projectConfig.

### EXT-16 — Client `waitForSocket` timeout (5 s) + poll interval (10 ms) are module constants · severity: low · status: CONFIRMED
- **Sources:** reports(#11)
- **Current location:** `packages/core/src/socketState.ts:19-20`
- **Original claim:** `WAIT_FOR_SOCKET_INTERVAL_MS = 10`, `WAIT_FOR_SOCKET_MAX_ITERATIONS = 500` → fixed 5 s ceiling before `apiRequest`/`syncRequest` return `api.ioUnavailable`. Not configurable.
- **Verification (current code):** Confirmed verbatim at `socketState.ts:19-20`; `waitForSocket` (`:27-37`) loops `MAX_ITERATIONS` times at `INTERVAL_MS`.
- **Verdict & why:** CONFIRMED. Low. Slow-network consumers hit premature `ioUnavailable`; fast-fail consumers can't shorten it.
- **Recommendation:** Expose via projectConfig (e.g. `socket.connectWaitMs`).

### EXT-17 — Router health-probe request timeout (2 s) hardcoded, separate from configurable poll interval · severity: low · status: CONFIRMED
- **Sources:** reports(#12)
- **Current location:** `packages/router/src/healthPoller.ts:32`
- **Original claim:** `DEFAULT_REQUEST_TIMEOUT_MS = 2000` used in `probeTarget`. The poll *interval* and the boot-handshake probe timeout ARE configurable; the per-probe HEAD timeout in the poller is not.
- **Verification (current code):** Confirmed. `healthPoller.ts:32` declares `const DEFAULT_REQUEST_TIMEOUT_MS = 2000`, used at `:38` to abort the `HEAD` fetch. The router CLAUDE.md confirms `routing.healthProbeTimeoutMs` (default 3000) configures the *boot-handshake* probe, a different path.
- **Verdict & why:** CONFIRMED. Low. A slow-but-healthy target whose `HEAD /` takes >2 s flips to fallback with no consumer override.
- **Recommendation:** Read the existing `routing.healthProbeTimeoutMs` here too, or add a dedicated key.

### EXT-18 — Session cookie `HttpOnly` unconditional; no `Domain` attribute option · severity: low · status: CONFIRMED
- **Sources:** reports(#13)
- **Current location:** `packages/server/src/httpHandler.ts:34-39`
- **Original claim:** `buildSessionCookieOptions` hardcodes `HttpOnly;`; `SameSite`/`Path`/`Max-Age`/`Secure` are configurable but there's no `Domain` option, blocking subdomain-shared sessions without a custom route. (`HttpOnly` non-configurable is a GOOD default.)
- **Verification (current code):** Confirmed verbatim: `httpHandler.ts:39` builds `` `HttpOnly; SameSite=${...sessionCookieSameSite}; Path=${...sessionCookiePath}; Max-Age=${...}; ${secure ? 'Secure;' : ''}` `` — no `Domain`.
- **Verdict & why:** CONFIRMED as a config-completeness gap (the `HttpOnly` part is a non-issue / good security default). Low.
- **Recommendation:** Add `http.sessionCookieDomain` config.

### EXT-19 — Extension-points doc lists server room/socket hooks without noting they require `@luckystack/server`'s module augmentation · severity: low · status: CONFIRMED
- **Sources:** reports(#14)
- **Current location:** `docs/ARCHITECTURE_EXTENSION_POINTS.md:174-176`; vs `packages/core/src/hooks/types.ts` (room/socket hooks absent from core's `HookPayloads`)
- **Original claim:** The doc presents `onSocketConnect`/`onSocketDisconnect`/`preRoomJoin`/`postRoomJoin`/`preRoomLeave`/`postRoomLeave`/`onLocationUpdate` as first-class, but they only exist after server's augmentation file loads — an AI grepping core's `HookPayloads` would not find them.
- **Verification (current code):** Confirmed. Doc `:174-176` lists exactly those hooks (plus `preHttpRequest`) with no augmentation note. Grep of `core/src/hooks/types.ts` for `onSocketConnect|preRoomJoin` returned no match (they live in `packages/server/src/hookPayloads.ts`). The hooks ARE dispatched in `loadSocket.ts` (`onSocketConnect` at `:141`, `preRoomJoin` at `:210`).
- **Verdict & why:** CONFIRMED. Documentation/discoverability gap. Low.
- **Recommendation:** Add a note in the hook table that room/socket hooks are augmented by `@luckystack/server`.

### EXT-20 — Extension-points doc's sync hook table omits `postSyncAuthorize` (which IS dispatched + in core types) · severity: low · status: CONFIRMED
- **Sources:** reports(#15)
- **Current location:** `docs/ARCHITECTURE_EXTENSION_POINTS.md:46-50` (table) vs `packages/sync/src/handleSyncRequest.ts` (dispatches `postSyncAuthorize`) + `packages/core/src/hooks/types.ts:310`
- **Original claim:** `handleSyncRequest` dispatches `postSyncAuthorize` (observational) and it IS in core `HookPayloads`, but the doc's sync hook list omits it — doc is slightly behind code.
- **Verification (current code):** Confirmed. Doc table `:46-50` lists `preSyncAuthorize`, `preSyncFanout`, `postSyncFanout`, `preSyncStream`, `postSyncStream` — `postSyncAuthorize` is absent. core types `:310` has `postSyncAuthorize: PostSyncAuthorizePayload`. The doc undersells an existing audit-subscription hook.
- **Verdict & why:** CONFIRMED. Low. (This is also the fact that REFUTES the review-side mischaracterisation — see EXT-24.)
- **Recommendation:** Add `postSyncAuthorize` to the doc's sync hook table.

### EXT-21 — Extension-points doc omits the vetoable client `preLogin` hook · severity: low · status: CONFIRMED
- **Sources:** reports(#16)
- **Current location:** `docs/ARCHITECTURE_EXTENSION_POINTS.md:29` vs `packages/core/src/clientHookBus.ts:35`
- **Original claim:** Doc says `registerClientHook` supports only `postLogin`/`postLogout`, but the code ships a vetoable `preLogin` client hook with a `dispatchVetoableClientHook` path.
- **Verification (current code):** Confirmed. Doc `:29` says "Subscribe to `postLogin` / `postLogout` transitions ... Returns an unsubscribe function" — no `preLogin`. `clientHookBus.ts:35` declares `preLogin: { candidateSession }` with a documented veto contract (`ClientHookStopSignal`, `ClientDispatchResult`).
- **Verdict & why:** CONFIRMED. Real capability missing from the docs (account-suspended / feature-gate / geo-block at login commit). Low.
- **Recommendation:** Document the `preLogin` client hook + its veto contract.

### EXT-22 — `loadSocket.ts` connect handler is a ~310-line god-function with duplicated join/leave logic · severity: low · status: CONFIRMED
- **Sources:** reports(#17)
- **Current location:** `packages/server/src/loadSocket.ts:119-431` (file is 434 lines)
- **Original claim:** A single `connect` handler wires presence, hooks, api/sync listeners, cancel, join/leave (each with inline session-lock + hook + emit), getJoinedRooms, disconnect, updateLocation, activity sampler, rejoin — all in one closure; join/leave are near-duplicates. No seam to alter room-join behaviour.
- **Verification (current code):** Confirmed. `wc -l` = 434 lines total; the connect handler opens at `:119`. Re-reading `:179-237` (join) shows the inline `withSessionLock` → `readSession` → `preRoomJoin` veto → `socket.join` → `writeSession` scaffold that the leave path mirrors.
- **Verdict & why:** CONFIRMED. Maintainability; correlates with the missing per-message interception seam (EXT-02). Low.
- **Recommendation:** Extract `handleJoinRoom`/`handleLeaveRoom` named functions and dedupe the session-lock+hook+emit scaffold.

### EXT-23 — `handleSyncRequest` (613) and `syncRequest` (1035) are very large single-file pipelines · severity: low · status: CONFIRMED
- **Sources:** reports(#18)
- **Current location:** `packages/sync/src/handleSyncRequest.ts` (613 lines), `packages/sync/src/syncRequest.ts` (1035 lines)
- **Original claim:** Line counts confirmed; `syncRequest.ts` is the largest single source file in the package set; `handleSyncRequest` interleaves auth/rate-limit/validate/server-run/fanout/client-fanout/streaming/abort in one flow — no clean injection point because it isn't decomposed (unlike the api package's `_shared/` extraction).
- **Verification (current code):** Confirmed via `wc -l`: 613 and 1035 respectively. Directly underpins EXT-04 (missing sync validate/execute hooks).
- **Verdict & why:** CONFIRMED. Low (maintainability), but it is the structural root of EXT-04's high-severity hook gap.
- **Recommendation:** Continue the `_shared/` helper-extraction pattern for these two files; the extracted stages become the natural hook injection points.

### EXT-24 — review's HOK-15/sync framing partially mischaracterised `postSyncAuthorize` as missing · severity: low · status: REFUTED
- **Sources:** review(HOK-16 prose / cross-references in HOOKS.md)
- **Current location:** `packages/core/src/hooks/types.ts:310` (`postSyncAuthorize` present)
- **Original claim:** Some review prose implies sync lacks post-authorize observability hooks broadly.
- **Verification (current code):** `postSyncAuthorize` DOES exist in core's HookPayloads (`types.ts:310`) and IS dispatched by `handleSyncRequest`. The genuine sync gap is the *validate/execute* stage hooks and the *error-path* dispatch (captured accurately in EXT-04), NOT authorize observability. The reports/ scan got this right (its #15 correctly notes `postSyncAuthorize` exists and is only a doc-table omission).
- **Verdict & why:** REFUTED for the authorize-observability sub-claim; reports/ was right, the broad review framing was imprecise. The substantive sync hook gap survives as EXT-04 (CONFIRMED).
- **Recommendation:** None — fold the real remainder into EXT-04 and the doc fix into EXT-20.
