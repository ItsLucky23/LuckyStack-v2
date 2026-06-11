# Hook Coverage Report — LuckyStack v0.2.0 Review

**Date:** 2026-06-11 · **ID prefix:** HOK · **Findings:** 29 (after merging near-duplicates)

**Scope & methodology.** One combined audit agent per package/area swept the entire repo for hook-bus gaps: lifecycle moments with no `dispatchHook`, dispatched hooks whose stop signals are ignored, registry features that are documented but never invoked, and missing observability seams on rejection paths. Every claimed absence was self-verified against the existing config options, `core/src/hooks/types.ts` HookPayloads map, package `register*` registries, and `docs/audits/` (to avoid re-reporting known items). Three reports of the missing account-deletion hook (cli asset, login package, consumer copy) were merged into one entry — the four shipped copies of `deleteAccount_v1.ts` were diffed and are content-identical (no drift; the cli asset differs only in line endings).

## Severity Index

| ID | Severity | Title | File | Area |
|---|---|---|---|---|
| HOK-01 | High | No authorize/guard hook on MountDocsUiOptions | `packages/docs-ui/src/index.ts` | pkg-docs-ui |
| HOK-02 | High | preEmailSend stop signal dispatched but never honored | `packages/email/src/sendEmail.ts` | pkg-email |
| HOK-03 | High | Test-runner extension registry never invoked by the runner | `packages/test-runner/src/runAllTests.ts` | pkg-test-runner |
| HOK-04 | Medium | No auth-rejection hook on API request lifecycle | `packages/api/src/handleApiRequest.ts` | pkg-api |
| HOK-05 | Medium | No pre/postAccountDelete hooks — only auth mutation without one (all 4 copies) | `packages/cli/assets/login/src/settings/_api/deleteAccount_v1.ts` (+3 mirrors) | pkg-cli / pkg-login / consumer-app |
| HOK-06 | Medium | registerHook/registerSyncHook have no unregistration | `packages/core/src/hooks/registry.ts` | pkg-core |
| HOK-07 | Medium | No hot-reload / codegen lifecycle hooks in devkit | `packages/devkit/src/hotReload.ts` | pkg-devkit |
| HOK-08 | Medium | no-sender / no-template early returns bypass both email hooks | `packages/email/src/sendEmail.ts` | pkg-email |
| HOK-09 | Medium | No registry-level pre-capture filter for error tracking | `packages/error-tracking/docs/adapter-pattern.md` | pkg-error-tracking |
| HOK-10 | Medium | No hook fires on failed login/register attempts | `packages/login/src/login.ts` | pkg-login |
| HOK-11 | Medium | prePresenceUpdate dispatch result ignored (no veto) | `packages/presence/src/activity/peerNotifier.ts` | pkg-presence |
| HOK-12 | Medium | No hook when the disconnect grace window expires | `packages/presence/src/activity/lifecycle.ts` | pkg-presence |
| HOK-13 | Medium | No edge request-blocking hook in the router proxy | `packages/router/src/httpProxy.ts` | pkg-router |
| HOK-14 | Medium | No onApplied/onChange hook after secret rotation | `packages/secret-manager/src/index.ts` | pkg-secret-manager |
| HOK-15 | Medium | No postHttpRequest hook (latency/status for full HTTP surface) | `packages/server/src/httpHandler.ts` | pkg-server |
| HOK-16 | Medium | No validate/execute lifecycle hooks for sync | `packages/sync/src/handleSyncRequest.ts` | pkg-sync |
| HOK-17 | Medium | runAllTests has no onResult/progress passthrough | `packages/test-runner/src/runAllTests.ts` | pkg-test-runner |
| HOK-18 | Medium | Custom test files have no beforeAll/afterAll lifecycle | `packages/test-runner/src/customTests.ts` | pkg-test-runner |
| HOK-19 | Medium | Stale comment + missed passwordChanged hook in consumer notifications | `server/hooks/notifications.ts` | consumer-server |
| HOK-20 | Low | No profile-updated hook around updateUser/updatePreferences | `packages/cli/assets/login/src/settings/_api/updateUser_v1.ts` | pkg-cli |
| HOK-21 | Low | serveAvatar has no pre-serve hook | `packages/core/src/serveAvatars.ts` | pkg-core |
| HOK-22 | Low | No pre/post-scaffold extension seam in create-luckystack-app | `packages/create-luckystack-app/src/index.ts` | pkg-create-app |
| HOK-23 | Low | Supervisor has no pre/post-restart hook | `packages/devkit/src/supervisor.ts` | pkg-devkit |
| HOK-24 | Low | Per-tracker capture failures swallowed with no log and no hook | `packages/core/src/errorTrackerRegistry.ts` | pkg-error-tracking |
| HOK-25 | Low | Routing-rejection responses (400/502) fire no hook | `packages/router/src/httpProxy.ts` | pkg-router |
| HOK-26 | Low | Hybrid-mode resolve failures only reach console.warn | `packages/secret-manager/src/index.ts` | pkg-secret-manager |
| HOK-27 | Low | Origin-policy 403 (missing Origin) dispatches no hook | `packages/server/src/httpHandler.ts` | pkg-server |
| HOK-28 | Low | No stoppable per-recipient sync delivery hook | `packages/sync/src/_shared/clientFanout.ts` | pkg-sync |
| HOK-29 | Low | Explicit empty-dimension marker: no hook gaps in tooling | `scripts/testAll.ts` | tooling |

---

### HOK-01 (High) — No authorize/guard hook on MountDocsUiOptions: documented "internal developer-portal with its own auth layer" cannot be built

**File:** `packages/docs-ui/src/index.ts:44`
**Area:** pkg-docs-ui

**Evidence/description:** `MountDocsUiOptions` (index.ts:44-83) has no auth seam: once the route matches, the handler serves the HTML and the full `apiDocs.generated.json` to any requester. `mounting.md:42` explicitly tells consumers to use `enabledInProd: true` "only for an internal developer-portal deployment with its own auth layer in front" — but there is no way to put auth in front: the auto-registered instance is dispatched first-match-wins, before consumer overlay registrations and before `options.customRoutes` (see the route-shadowing finding in the configurability report), so a consumer-registered guard handler never runs first. Grep across the package confirms no `on*`/`pre*`/`authorize`/`guard` option exists.

**Why it matters for a consumer:** With `enabledInProd: true`, the complete API surface (routes, auth rules, rate limits, input/output types, owner tags) is exposed unauthenticated — valuable recon data — and the docs' own recommended deployment pattern is impossible to implement without forking.

**Recommendation:** Add `authorize?: (req: IncomingMessage) => boolean | Promise<boolean>` to `MountDocsUiOptions`, checked after the route match and before any response; on `false`, return 404 (matching the prod-lockdown response so the route stays unprobeable). This fits the framework's existing functional-option style (cf. `SecurityHeadersBuilder`, `DocsTemplateBuilder`). Consider requiring it (boot warning) when `enabledInProd` is true.

---

### HOK-02 (High) — preEmailSend stop signal is dispatched but never honored: documented suppression/rate-limit patterns silently fail to block sends

**File:** `packages/email/src/sendEmail.ts:137`
**Area:** pkg-email

**Evidence/description:** `sendEmail` discards the `DispatchResult`: `await dispatchHook('preEmailSend', { message, adapter: sender.name });` — the return value is never checked, and `sender.send(message)` runs unconditionally at line 142. Core's `dispatchHook` (`packages/core/src/hooks/registry.ts:52-54`) returns `{ stopped: true, signal }` exactly for this purpose, and three docs claim the abort works: `packages/email/CLAUDE.md:47` ("Returning a stop signal aborts the send"), `docs/ARCHITECTURE_EMAIL.md:120` ("The dispatcher honors the signal and sendEmail returns { ok: false, reason: signal.errorCode }"), and `packages/email/docs/hooks.md` patterns A (suppression list) and B (per-recipient rate limit), which return stop signals expecting the mail to be blocked. Only `hooks.md:135` admits "the abort wiring on the email side is not active in this revision" — directly contradicting the other three docs and its own pattern examples. Not covered in `docs/audits/`.

**Why it matters for a consumer:** A consumer wiring a GDPR/bounce suppression list or per-recipient rate limit per the docs' own examples will believe mail is blocked while it keeps sending — a silent compliance failure.

**Recommendation:** One-line fix in `sendEmail.ts`: `const pre = await dispatchHook('preEmailSend', {...}); if (pre.stopped) return { ok: false, reason: pre.signal.errorCode };` (skip `postEmailSend` in the abort path per the documented contract in `hooks.md:156`). Delete the "current implementation detail" caveat at `docs/hooks.md:135`. Add a test asserting a stop signal prevents `sender.send` from being called.

---

### HOK-03 (High) — Extension registry (layers/fixtures/reporter/webhook) is never invoked by the runner despite docs promising it

**File:** `packages/test-runner/src/runAllTests.ts:70`
**Area:** pkg-test-runner

**Evidence/description:** `registerTestLayer` / `registerTestFixture` / `registerTestReporter` exist (`src/extensionRegistry.ts`) but nothing in the package ever calls `listTestLayers()`, `getTestFixture()`, or `getTestReporter()` — grep across `runAllTests.ts`, `fuzzCheck.ts`, and all sweep files confirms zero call sites outside `extensionRegistry.test.ts`. The docs contradict each other: `docs/ARCHITECTURE_TESTING.md:300` says "Call registerTestLayer({ name, run }) at boot before invoking the runner" (implying the runner picks them up — it does not); `packages/test-runner/CLAUDE.md:83-84` claims fixtures are "realistic payloads die de fuzz layer prefereert boven schema-random" and that `registerTestReporter` will "POST de summary naar een webhook" — but `fuzzCheck.ts` never reads fixtures and no code POSTs the webhook. Only `packages/test-runner/docs/extension-hooks.md:87,137,163` honestly calls these an unwired "coordination surface" with `runRegisteredLayers` on the roadmap.

**Why it matters for a consumer:** A consumer who registers a layer at boot and runs `npm run test` gets a silent no-op — the worst failure mode: they believe extra coverage exists when nothing ran.

**Recommendation:** For 0.2.0 either (a) wire it: in `runAllTests`, after the built-in layers, iterate `walkEndpoints` × `listTestLayers()` calling `layer.run({ endpoint: e.fullPath, method: e.method, authToken })`, feed all results to `getTestReporter()?.onResult/onSummary`, and POST `JSON.stringify(summary)` to `reporter.webhookUrl` (with `webhookAuth` bearer header, tryCatch'd, non-fatal); or (b) ship the documented `runRegisteredLayers({ apiMethodMap, baseUrl, authToken })` entry point and fix `ARCHITECTURE_TESTING.md:300` + `CLAUDE.md:83-84` to stop overstating.

---

### HOK-04 (Medium) — No auth-rejection hook on the API request lifecycle: cannot audit or throttle failed authorization

**File:** `packages/api/src/handleApiRequest.ts:70` (and `packages/api/src/handleHttpApiRequest.ts:257-293`)
**Area:** pkg-api

**Evidence/description:** `checkApiAuth` (handleApiRequest.ts:70-105) and the HTTP equivalent emit `auth.required` (401) / `auth.forbidden` (403) error envelopes but dispatch no hook when a protected route denies a request. Every other rejection class in the framework has an observability hook — `rateLimitExceeded` (api), `csrfMismatch`, `corsRejected` (all in `packages/core/src/hooks/types.ts:202-277`). The HookPayloads map (types.ts:300-324) confirms no `apiAuthRejected`/`authFailed` entry exists.

**Why it matters for a consumer:** A consumer wanting to audit-log failed authorization attempts, detect credential-stuffing/brute force against protected endpoints, or alert on a 403 spike has no seam and must fork the handler.

**Recommendation:** Add an `apiAuthRejected` hook fired from both transports on the auth-fail path, mirroring `rateLimitExceeded`'s shape: `{ routeName: string; reason: 'login-required' | 'forbidden'; errorCode: string; userId?: string; transport: 'socket' | 'http'; ip?: string }`. Dispatch via `void dispatchHook(...)` so it cannot block the rejection (same pattern as `rateLimitExceeded`).

---

### HOK-05 (Medium) — No pre/postAccountDelete lifecycle hooks: account deletion is the only auth mutation without a hook (all four shipped copies)

**File:**
- `packages/cli/assets/login/src/settings/_api/deleteAccount_v1.ts:37-40`
- `packages/create-luckystack-app/template/src/settings/_api/deleteAccount_v1.ts:37-40`
- `packages/create-luckystack-app/ls-np/src/settings/_api/deleteAccount_v1.ts:37-40`
- `src/settings/_api/deleteAccount_v1.ts:37-40` (consumer demo)
- `packages/login/src/hookPayloads.ts` (missing payload declarations)

**Area:** pkg-cli + pkg-login + consumer-app (merged from three agent reports)

**Evidence/description:** All four copies of `deleteAccount_v1.ts` were diffed and are content-identical — framework asset, both create-luckystack-app templates, and the consumer demo are **in sync (no drift)**. Each one calls `revokeUserSessions(user.id)` then `functions.db.prisma.user.delete` with zero `dispatchHook` calls. Every sibling mutation in the same shipped bundle has a vetoable pre-hook plus a fire-and-forget post-hook: `prePasswordChanged`/`passwordChanged` (changePassword_v1:52-71), `preEmailChange`/`postEmailChangeRequested`/`postEmailChanged` (email-change pair), `prePasswordResetCompleted`/`passwordResetCompleted` (confirmReset_v1). Verified framework-wide absence: grep for `accountDeleted`/`userDeleted`/`preAccountDelete` across `packages/` hits nothing; `packages/login` dispatches pre/postLogin, pre/postRegister, pre/postLogout, pre/postSessionCreate/Refresh/Delete — nothing for account deletion. The `postSessionDelete` hooks that fire as a side effect of `revokeUserSessions` carry no "account is being deleted" semantics, conflating logout with deletion.

**Why it matters for a consumer:** Account deletion is the most consequential, irreversible, GDPR-relevant account mutation. A consumer or add-on package cannot veto deletion (open invoice, legal hold, admin approval), cannot audit-log it, cannot cascade-clean external data (Stripe customer, S3 objects, mailing list, error-tracking user-unlink), and cannot send a goodbye email — without forking the route. Packages cannot subscribe at all, regardless of consumer edits to the copied file.

**Recommendation:** Define `preAccountDelete: { userId: string; email: string; provider: string }` (vetoable) and `postAccountDelete: { userId: string; email: string; provider: string }` in `packages/login/src/hookPayloads.ts`, matching the `prePasswordChanged` pattern: `const pre = await dispatchHook('preAccountDelete', {...}); if (pre.stopped) return { status: 'error', errorCode: pre.signal.errorCode };` before any revocation, and `void dispatchHook('postAccountDelete', {...})` after the prisma delete. Update the cli asset, both templates, and the consumer demo together so the copies stay in sync.

---

### HOK-06 (Medium) — registerHook/registerSyncHook have no unregistration: only the test-only clearAllHooks nuke

**File:** `packages/core/src/hooks/registry.ts:24` (and :75-82)
**Area:** pkg-core

**Evidence/description:** `registerHook` (lines 24-31) and `registerSyncHook` (75-82) push handlers into module-level Maps and return `void`; there is no `unregisterHook`, no returned unsubscribe, and `clearAllHooks` is explicitly test-only because it also drops framework-internal handlers (presence cleanup etc. — its own comment warns this). The client-side bus already solved this: `clientHookBus.ts:70` `onClientHook` returns an unsubscribe function — the server side is inconsistent with it. Verified no `unregister`/`removeHook`/`offHook` exists anywhere in core.

**Why it matters for a consumer:** Consumers cannot detach a handler for conditional plugins, per-tenant feature toggles, or dev hot-reload — re-registering on each reload accumulates duplicate handlers that all fire.

**Recommendation:** Match the client bus contract: `registerHook<TName>(name, handler): () => void` returning a closure that splices that exact handler (same for `registerSyncHook`). Backwards compatible since the current return type is `void`.

---

### HOK-07 (Medium) — No hot-reload / codegen lifecycle hooks (route reloaded, type map generated, template injected, reload error)

**File:** `packages/devkit/src/hotReload.ts:77` (also :299-307, `templateInjector.ts:541-564`)
**Area:** pkg-devkit

**Evidence/description:** Existing extension points were checked first: `registerRoutingRules` (incl. the `disableTemplateInjection` predicate), the template registry (`registerTemplate`/`registerTemplateRule`/`registerTemplateKind`), and core's `getLocaleReloader()` — none expose the reload lifecycle itself. Outcomes like "API reloaded", "type map ready in N ms", "type map regeneration failed", and "template injected" are only `console.log` side effects inside `setupWatchers` (hotReload.ts:77-95, :299-307) and `injectTemplate` (templateInjector.ts:541-564).

**Why it matters for a consumer:** A consumer who wants to run a follow-up codegen step after each type-map regen (GraphQL schema, i18n key extraction), surface reload failures in an IDE/desktop notification, or collect dev-loop metrics has no seam and must fork. Dev-only, hence medium.

**Recommendation:** Add a registry consistent with the existing `register*` pattern: `registerDevHooks({ onRouteReloaded?: (e: { kind: 'api'|'sync'; routeKey: string; filePath: string; action: 'upsert'|'remove' }) => void; onTypeMapGenerated?: (e: { durationMs: number; error?: Error }) => void; onTemplateInjected?: (e: { filePath: string; kind: TemplateKind }) => void; })`, invoked from `processPending*Changes`, `runTypeMapRegeneration`, and `injectTemplate`; export from `index.ts` and auto-load from the `.luckystack/templates/templateRules.ts` overlay so consumers configure it as code.

---

### HOK-08 (Medium) — "no-sender" and "no-template" early returns bypass both email hooks: the doc's own DLQ pattern can never observe the reasons it handles

**File:** `packages/email/src/sendEmail.ts:100` (and :110)
**Area:** pkg-email

**Evidence/description:** `sendEmail` returns `{ ok: false, reason: 'no-sender' }` at line 100 and `{ ok: false, reason: 'no-template' }` at line 110, both **before** the `preEmailSend` dispatch at line 137 — so neither `preEmailSend` nor `postEmailSend` fires for dropped messages. This contradicts `docs/hooks.md:9` ("two hooks for every message… a single audit consumer sees the entire transactional-mail surface") and breaks the doc's own pattern D (`hooks.md:231`), which instructs consumers to alert ops when `postEmailSend` delivers a `reason` in `new Set(['no-sender', 'no-template', 'missing-from'])` — the first two reasons can never reach a `postEmailSend` handler.

**Why it matters for a consumer:** An audit/alerting consumer following the docs misses precisely the misconfiguration drops it most needs to see — mail silently not sent due to a missing sender or template.

**Recommendation:** Dispatch `postEmailSend` with `{ message: <partial>, adapter: 'none', ok: false, reason: 'no-sender' | 'no-template' }` in the early-return paths (the no-sender path needs a minimal message built from the input), or document the bypass explicitly in `hooks.md` and fix pattern D. The hook signature stays `PostEmailSendPayload`; consider widening the `adapter` doc to include `'none'`.

---

### HOK-09 (Medium) — No registry-level pre-capture hook: global filtering/sampling/dedup must be duplicated per adapter

**File:** `packages/error-tracking/docs/adapter-pattern.md:197` (registry: `packages/core/src/errorTrackerRegistry.ts:62-97`)
**Area:** pkg-error-tracking

**Evidence/description:** `beforeSend` is per-adapter only; the doc explicitly punts cross-adapter filtering to "the dispatch site (e.g. inside a tryCatch wrapper that rate-limits or deduplicates before calling captureExceptionAcrossTrackers)" — but the dominant dispatch site is core's own `tryCatch` (`packages/core/src/tryCatch.ts`), which consumers cannot wrap without forking. Verified absence: `errorTrackerRegistry.ts:62-97` fans out unconditionally; no `preErrorCapture`/`errorCaptured` name exists in `core/src/hooks/types.ts` (only `apiError`/`syncError`, which fire on a different, server-route-level path).

**Why it matters for a consumer:** One global rule (drop ValidationErrors, sample noisy routes at 1%, redact a tenant field, count capture rates) must be re-attached identically to every adapter — and remembered for each future adapter — instead of being declared once.

**Recommendation:** Add a registry-level filter consistent with existing registries: `registerErrorCaptureFilter((event: ErrorTrackerEvent & { context?: ErrorTrackerContext }) => ErrorTrackerEvent | null)` in core's `errorTrackerRegistry`, applied once in `captureExceptionAcrossTrackers`/`captureMessageAcrossTrackers` before the fan-out loop; re-export from `@luckystack/error-tracking`.

---

### HOK-10 (Medium) — No hook fires on FAILED login/register attempts: lockout and auth-failure auditing impossible without forking

**File:** `packages/login/src/login.ts:285` (also :269, :276, :281-284, :634-651)
**Area:** pkg-login

**Evidence/description:** Verified dispatch inventory for the package: `preLogin`/`postLogin`, `preRegister`/`postRegister`, `pre/postLogout`, `pre/postSessionCreate/Delete/Refresh`, `passwordResetRequested`. Every failure path returns early with a reason key and dispatches nothing: wrong password (line 285), unknown user (269), null hash (276), bcrypt error (281-284), OAuth state/exchange/profile failures (634-651). `postLogin` fires only on success. `preLogin` can veto but cannot see outcomes. This is the one gap in an otherwise rich hook surface.

**Why it matters for a consumer:** A consumer cannot audit-log failed attempts, feed a SIEM, or build per-account brute-force lockout — a prior audit blessed per-IP rate limiting, but counter-based account lockout needs a failure signal.

**Recommendation:** Add an observational hook consistent with existing payloads: `loginFailed: { email?: string; userId?: string; provider: string; reason: string; stage: 'credentials' | 'oauth-state' | 'oauth-exchange' | 'oauth-profile' }`, dispatched fire-and-forget (`void`, like `passwordResetRequested`) on each failure return; document in `packages/login/docs/hooks.md`.

---

### HOK-11 (Medium) — prePresenceUpdate dispatch result ignored: consumers cannot veto a presence broadcast (no invisible/DND mode)

**File:** `packages/presence/src/activity/peerNotifier.ts:34`
**Area:** pkg-presence

**Evidence/description:** `await dispatchHook('prePresenceUpdate', { token, userId, kind, roomCodes });` discards the `DispatchResult`, so a handler returning a stop signal cannot suppress the `userAfk`/`userBack` fan-out. Core's hook bus supports vetoes and sibling hooks honor them (`preRoomJoin`/`preRoomLeave` check `preResult.stopped` in `packages/server/src/loadSocket.ts:210-221`). `docs/peer-notifier.md:65` explicitly admits the gap: "the helper does not check the result; this is 'audit' surface, not 'veto' surface — if you need a veto, file an issue." Not tracked in `docs/audits/`.

**Why it matters for a consumer:** Per-user invisible mode, do-not-disturb, or hiding admin/observer accounts from presence is impossible without forking `informRoomPeers` (which is deliberately not in the public barrel).

**Recommendation:** Honor the existing contract shape: `const pre = await dispatchHook('prePresenceUpdate', payload); if (pre.stopped) { await dispatchHook('postPresenceUpdate', { ...payload, recipientCount: 0 }); return; }` — identical semantics to `preRoomJoin`. Update `docs/peer-notifier.md` §prePresenceUpdate.

---

### HOK-12 (Medium) — No hook fires when the disconnect grace window expires: the final teardown moment is closed to consumers

**File:** `packages/presence/src/activity/lifecycle.ts:102` (timeout body :95-109)
**Area:** pkg-presence

**Evidence/description:** The grace-expiry timeout body — the moment a temporarily-disconnected user becomes permanently gone — dispatches no hook. Verified the existing surface: presence owns `prePresenceUpdate`/`postPresenceUpdate`/`postSocketReconnect` (hookPayloads.ts); server owns `onSocketDisconnect` (fires immediately at disconnect, **before** the grace verdict); login's `pre/postSessionDelete` fire only when the session is actually deleted — conflating logout-deletes with grace-deletes, and never firing at all on the tab-switch path (`deleteSessionOnDisconnect = false`).

**Why it matters for a consumer:** "Mark user offline in DB", "save game state when player truly leaves", and "audit final departure" have no injection point; the timer body must be forked.

**Recommendation:** Dispatch a new hook in the timeout body, consistent with existing payloads: augment HookPayloads with `postDisconnectGraceExpired: { token, userId: string | null, roomCodes: string[], reason: string, sessionDeleted: boolean }` and `void dispatchHook('postDisconnectGraceExpired', ...)` after the teardown completes.

---

### HOK-13 (Medium) — No edge request-blocking hook: preProxyRequest cannot reject or mutate

**File:** `packages/router/src/httpProxy.ts:51`
**Area:** pkg-router

**Evidence/description:** `preProxyRequest` is dispatched fire-and-forget (`void dispatchHook(...)`, httpProxy.ts:51) and the upstream request proceeds immediately at line 59; the hook bus is side-effect-only and collects no return value (confirmed in `docs/post-proxy-response-hook.md:186`).

**Why it matters for a consumer:** A consumer running the router as their edge load balancer cannot block a request: IP/geo banning, maintenance-mode short-circuit, a lightweight WAF rule, or edge auth all require forking the proxy — for a package whose stated selling point is "intercept proxy traffic without forking the router" (CLAUDE.md:26).

**Recommendation:** Add an awaited, decision-returning hook (e.g. `proxyRequestGate` returning `{ action: 'allow' } | { action: 'deny', statusCode, body }`) dispatched before `transport.request`, consistent with core's stop-signal hook pattern (`dispatchHook` already supports a stop signal). Keep `preProxyRequest` as the fire-and-forget observe-only hook.

---

### HOK-14 (Medium) — No onSecretsApplied/onChange hook: rotated secrets update process.env but consumers cannot re-init clients that cached the old value

**File:** `packages/secret-manager/src/index.ts:224` (applyResolved :224-232; config :37-74)
**Area:** pkg-secret-manager

**Evidence/description:** `applyResolved` writes rotated values into `process.env`, and `refreshSecretManager`/the dev poll re-resolve on rotation — but nothing tells the consumer **which** env names changed. Verified: `SecretManagerConfig` (lines 37-74) contains zero callbacks; grep for `on[A-Z]` across the package returns nothing. The framework idiom exists elsewhere (e.g. `packages/router/src/startRouter.ts:52-53` `onReady`/`onHealthChange` config callbacks).

**Why it matters for a consumer:** Any long-lived client that captured the secret at construction time (Prisma client built from `DATABASE_URL`, Redis connection, Stripe/OpenAI SDK instance) silently keeps using the old credential after rotation — defeating the package's headline rotation feature for anything except lazy `process.env` readers.

**Recommendation:** Add `onApplied?: (changes: { name: string; pointer: string }[]) => void | Promise<void>` to `SecretManagerConfig`, invoked from `applyResolved` with only the env **names** whose value actually changed (never the secret values themselves). Consumers use it to re-create connection pools / SDK clients after a rotation lands.

---

### HOK-15 (Medium) — No postHttpRequest hook: request latency/status metrics impossible for static and custom routes without forking

**File:** `packages/server/src/httpHandler.ts:250`
**Area:** pkg-server

**Evidence/description:** The pipeline dispatches `preHttpRequest` (httpHandler.ts:250) but has no post-request counterpart. Verified against core's HookPayloads map (`packages/core/src/hooks/types.ts:300-324`): `postApiRespond`/`postSyncFanout` cover only `/api` and `/sync`; no hook carries the final `statusCode` + duration for the **whole** HTTP surface (static files, SPA fallback, auth routes, custom routes, 403s from the origin gate).

**Why it matters for a consumer:** An access log, RED metrics, or slow-request alerting — the exact use case `preHttpRequest`'s own comment advertises ("latency timer") — requires starting a timer in `preHttpRequest` with no hook to ever stop it.

**Recommendation:** Dispatch `postHttpRequest` from a `res.on('finish')` listener registered right after the requestId is minted. Payload consistent with `PreHttpRequestPayload`: `{ method, url, requestId, origin, statusCode, durationMs }`. Add to HookPayloads in core and document in `request-pipeline.md`.

---

### HOK-16 (Medium) — No validate/execute lifecycle hooks for sync: failed _server executions are invisible to hook consumers

**File:** `packages/sync/src/handleSyncRequest.ts:407` (error paths :449-480; success-only preSyncFanout :522)
**Area:** pkg-sync

**Evidence/description:** Verified existing sync hooks: `preSyncAuthorize`, `postSyncAuthorize`, `preSyncFanout`, `postSyncFanout`, `preSyncStream`, `postSyncStream`, `rateLimitExceeded`. The API pipeline additionally has `preApiValidate`/`postApiValidate` (dispatched around `validateInputByType`, see `api/_shared/httpValidationStage.ts:36-51`) and `preApiExecute`/`postApiExecute` (`PostApiExecutePayload` carries `{ result, error, durationMs }`, core `hooks/types.ts:88-93`). Sync has no counterpart for either stage: `validateInputByType` runs at handleSyncRequest.ts:407 with no hook, and when `_server` throws or returns an error (lines 449-480) **no** hook fires at all — `preSyncFanout` only dispatches on success (line 522).

**Why it matters for a consumer:** Audit logs, latency metrics, or alerting on failing sync mutations (the exact use-cases `postApiExecute` serves) cannot be built without forking; error-tracking auto-instrumentation also loses span-close fidelity on sync error paths.

**Recommendation:** Add `preSyncValidate`/`postSyncValidate` (payload mirroring `Pre/PostApiValidatePayload` + `receiver`/`transport`) around `validateInputByType`, and `preSyncExecute`/`postSyncExecute` (`{ routeName, data, user, receiver, result, error, durationMs, transport }`) around the `serverMain` tryCatch in both transports.

---

### HOK-17 (Medium) — runAllTests has no onResult/progress passthrough: live per-endpoint output only works on individual layers

**File:** `packages/test-runner/src/runAllTests.ts:21` (RunAllTestsInput :21-39)
**Area:** pkg-test-runner

**Evidence/description:** Every sweep layer exposes `onResult?: (result: ContractCheckResult) => void` (e.g. `runContractTests.ts:17`) and `runCustomTests` exposes `onResult?: (result: CustomTestResult) => void` (`customTests.ts:73`), with `logContractResult` shipped as a ready-made consumer (`extension-hooks.md` §logContractResult). But `RunAllTestsInput` exposes none of them and the internal calls pass no `onResult` — so the orchestrator, the entry point `npm run test` actually uses, runs the full multi-minute sweep silently until the final summary.

**Why it matters for a consumer:** Live progress, CI streaming, or a per-endpoint metrics counter requires abandoning `runAllTests` and re-composing the five layers by hand.

**Recommendation:** Add `onResult?: (layer: 'contract'|'auth'|'rate-limit'|'fuzz', result: ContractCheckResult) => void` and `onCustomResult?: (result: CustomTestResult) => void` (plus optional `onLayerStart`/`onLayerEnd`) to `RunAllTestsInput`, forwarding to each layer — signatures consistent with the existing per-layer onResult hooks.

---

### HOK-18 (Medium) — Layer-5 custom test files have no beforeAll/afterAll/beforeEach lifecycle hooks

**File:** `packages/test-runner/src/customTests.ts:25` (runner :408-441)
**Area:** pkg-test-runner

**Evidence/description:** A test file's only contract is `export const customTests: CustomTestCase[]` where `CustomTestCase` is `{ name, run(ctx), expectedToFail? }` (lines 25-37). `runCustomTests` builds a fresh context per case and runs each case in isolation; there is no per-file setup/teardown seam. Grep confirms no `beforeAll`/`afterAll`/`setup`/`teardown` identifiers exist anywhere in the package source.

**Why it matters for a consumer:** Common needs — seed a Prisma user/workspace once for all cases in a file, clean up created rows afterwards, reset a feature flag — must be duplicated inside every case's `run()` (paying the cost repeatedly), or hacked in via module top-level side effects with no matching teardown.

**Recommendation:** Support optional `export const beforeAll: (ctx: TestContext) => Promise<void>` and `afterAll: (ctx: TestContext) => Promise<void>` per test file (run once around the file's cases, `afterAll` guaranteed via tryCatch like `closeAllWatchers`), and document them in `docs/ARCHITECTURE_TESTING.md` + the `scaffold:test` stub.

---

### HOK-19 (Medium) — Stale comment + missed passwordChanged hook: password-change notification not auto-wired

**File:** `server/hooks/notifications.ts:74` (comment :71-75; contrast registerHook('postLogin') at :32)
**Area:** consumer-server

**Evidence/description:** The doc comment on `sendPasswordChangedNotification` states "there is no postPasswordChange hook in the framework", so the notification is called directly by the settings API. That comment is now wrong: `@luckystack/login` registers both `prePasswordChanged` and `passwordChanged` hooks (`packages/login/src/hookPayloads.ts:164-165`, confirmed in the login CLAUDE.md hook list). Because the notification is invoked manually rather than via `registerHook('passwordChanged', ...)`, it only fires if a specific API call site remembers to call it.

**Why it matters for a consumer:** The behavior is coupled to one call site and diverges from the auto-wired postLogin notification directly above it — any future password-change path (admin reset, new route) silently skips the notification. The consumer demo is also the reference other projects copy.

**Recommendation:** Register it as a hook for parity with the postLogin path: `registerHook('passwordChanged', ({ userId }) => { void sendPasswordChangedNotification(userId); })` inside `registerNotificationHooks`, and delete the stale "no hook exists" comment.

---

### HOK-20 (Low) — No profile-updated hook around updateUser/updatePreferences mutations

**File:** `packages/cli/assets/login/src/settings/_api/updateUser_v1.ts:76` (also `updatePreferences_v1.ts`)
**Area:** pkg-cli

**Evidence/description:** `updateUser_v1` (name/theme/language/avatar) and `updatePreferences_v1` write the user row and re-save the session with no `dispatchHook` — only the avatar branch gets hooks indirectly via `processUpload`'s `onUploadStart`/`onUploadComplete`.

**Why it matters for a consumer:** Audit logging of identity-relevant changes (display-name changes are a classic impersonation vector), profile-change moderation, and cache invalidation have no framework seam. Low because the files are consumer-owned after copy and the change set is low-risk compared with credential mutations.

**Recommendation:** Dispatch `void dispatchHook('postProfileUpdated', { userId: user.id, changedFields: Object.keys(newData) })` after the prisma update (optionally a vetoable `preProfileUpdate` for moderation), consistent with the existing `post*` fire-and-forget hooks.

---

### HOK-21 (Low) — serveAvatar has no pre-serve hook: private/auth-gated avatars require a fork

**File:** `packages/core/src/serveAvatars.ts:16`
**Area:** pkg-core

**Evidence/description:** Uploads get `onUploadStart`/`onUploadComplete` (`processUpload.ts` dispatches both, stop-signal capable), but the read side — `serveAvatar` — dispatches nothing: any holder of a fileId can fetch any avatar. Verified: no `dispatchHook` call in `serveAvatars.ts` and no avatar-related name in any HookPayloads augmentation across packages.

**Why it matters for a consumer:** Access control (private avatars, signed URLs, per-workspace isolation), download auditing, or hit metrics cannot be intercepted without forking the route wiring in `@luckystack/server`. Low because avatars are conventionally public and a consumer can mount their own custom route instead.

**Recommendation:** Dispatch `preAvatarServe: { fileId: string; routePath: string }` before the format loop (stop signal → respond with `signal.httpStatus ?? 404`) and `postAvatarServe: { fileId, extension, contentType }` after a successful pipe, mirroring the `OnUpload*` payload style in `hooks/types.ts`.

---

### HOK-22 (Low) — No pre/post-scaffold extension seam (post-scaffold command or template manifest)

**File:** `packages/create-luckystack-app/src/index.ts:1067`
**Area:** pkg-create-app

**Evidence/description:** `main()` is a fixed pipeline: copyTree → injectOptionalDeps → pruneOptionalPackages → AI docs → wireAiBrowserTooling → npm install → prisma generate → next-steps banner. Grep confirms no hook/callback registration of any kind in this package (a one-shot CLI, so runtime hooks don't apply) — and no way to run anything after scaffold completes.

**Why it matters for a consumer:** `git init` + first commit, an org's secret-bootstrap script, or registering the project in an internal portal requires wrapping the CLI in a shell script that hardcodes knowledge of its exit behavior. Low since wrapping is workable; becomes more valuable if the custom-template flag lands (a template could declare its own post-step).

**Recommendation:** Add `--post-scaffold "<command>"` executed (`spawnSync`, `shell: true`, `cwd = targetDir`, after install) with the chosen `ScaffoldChoices` exposed as env vars (`LS_DB_PROVIDER`, `LS_AUTH_MODE`, …), or support an optional `template.config.mjs` exporting `postScaffold({ targetDir, choices })` when custom templates are introduced.

---

### HOK-23 (Low) — Supervisor has no pre/post-restart hook

**File:** `packages/devkit/src/supervisor.ts:137` (restart flow :126-151)
**Area:** pkg-devkit

**Evidence/description:** `scheduleRestart` → kill → `startChild` offers no seam to run work between child death and respawn. The supervisor intentionally imports nothing from core (env-invariant, supervisor.ts:2-12), so a code-level registry is awkward — but a command-style hook fits.

**Why it matters for a consumer:** Re-running `prisma generate` after schema-adjacent config changes, clearing a local cache dir, or emitting a notification when the server crash-loops all require forking the supervisor.

**Recommendation:** Support `LUCKYSTACK_SUPERVISOR_PRE_RESTART_CMD` (shell command executed and awaited before each respawn, with a timeout) and log its exit code; document it in `docs/supervisor.md`.

---

### HOK-24 (Low) — Per-tracker capture failures are swallowed with no log and no hook: a dead tracker is undetectable

**File:** `packages/core/src/errorTrackerRegistry.ts:69`
**Area:** pkg-error-tracking

**Evidence/description:** Every fan-out method catches per-tracker throws with a bare `catch { /* Swallow */ }` — no `getLogger().debug`, no counter, no hook. The swallow-to-protect-the-chain design itself is deliberate and documented; the gap is the zero-signal failure. (Adjacent but distinct from `docs/audits/CODE_QUALITY_AUDIT.md:178`, which flags the missing fan-out timeout on the same lines — that item's "per-tracker metrics" suggestion partially overlaps, hence low severity here.)

**Why it matters for a consumer:** A tracker that throws on every call (bad DSN, unreachable agent, SDK version mismatch) produces a 100% silent observability blackout; the consumer believes errors are being reported.

**Recommendation:** Inside each catch: `getLogger().warn('[error-tracking] tracker <name> threw during <method>', { err })` (rate-limited to avoid log storms) and/or dispatch an `errorTrackerFailed` sync hook `{ tracker: string; method: string; error: unknown }` so consumers can alert on it.

---

### HOK-25 (Low) — Routing-rejection responses (400/502) fire no hook

**File:** `packages/router/src/httpProxy.ts:26` (400 :26-31; 502 :34-43)
**Area:** pkg-router

**Evidence/description:** When the path has no parseable service (400 `routing.invalidRequestPath`) or no binding resolves (502 `serviceNotAssigned`), neither `preProxyRequest` nor `postProxyResponse` fires — confirmed by the table in `docs/post-proxy-response-hook.md:110-111`. Only requests that reach a resolved upstream are observable.

**Why it matters for a consumer:** Metrics/audit wired via the hook bus is blind to all rejected/misrouted traffic — a useful signal for detecting scanners, misconfigured clients, or topology drift.

**Recommendation:** Emit `postProxyResponse` (or a dedicated `proxyRequestRejected` hook) with statusCode 400/502 and an `error`/`rejectionReason` field on the two early-return rejection paths so consumers see the full traffic picture.

---

### HOK-26 (Low) — Hybrid-mode resolve failures only reach console.warn: no onResolveError hook for consumer observability

**File:** `packages/secret-manager/src/index.ts:260` (also :303, :339; CC-7 comment :250-253)
**Area:** pkg-secret-manager

**Evidence/description:** In `'hybrid'` mode a failed resolve is `console.warn('[secret-manager] Resolve failed, leaving local env as-is:', error)` and nothing else; the same applies to dev poll failures (line 339) and dev reload failures (line 303). The CC-7 comment documents that NOT auto-capturing to the error tracker is deliberate fail-OPEN design — fine as the default, but it also means a staging/canary deployment running hybrid can silently boot on stale local env forever with no way to route the failure to Sentry/metrics without forking. Low because the shipped seam uses `'remote'` (which throws) and hybrid is opt-in.

**Why it matters for a consumer:** An opt-in callback does not violate the no-side-effect default, but without one the failure mode is invisible to monitoring.

**Recommendation:** Add `onResolveError?: (error: unknown, context: { phase: 'boot' | 'refresh' | 'file-reload' }) => void` to `SecretManagerConfig`, invoked alongside the existing `console.warn` in the hybrid/poll/reload catch paths. Keep current behavior when unset.

---

### HOK-27 (Low) — Origin-policy 403 (missing-Origin state-changing request) dispatches no hook

**File:** `packages/server/src/httpHandler.ts:135` (branch :131-140)
**Area:** pkg-server

**Evidence/description:** `enforceOriginPolicy`'s no-origin fail-close branch ends the request with a bare `403 Forbidden` and dispatches nothing. The disallowed-origin branch does get telemetry indirectly (core's `allowedOrigin` dispatches `corsRejected` on miss — verified in core CLAUDE.md), but the missing-Origin rejection — the branch an operator hits when a webhook/integration forgets `registerOriginExemptPath` — is invisible to monitoring. The framework's other rejection paths (`csrfMismatch`, `rateLimitExceeded`, `corsRejected`) all have hooks.

**Why it matters for a consumer:** Debugging "403 with no log line" is the realistic pain when wiring webhooks.

**Recommendation:** Dispatch the existing `corsRejected` hook (with `origin: ''` and a `reason: 'missing-origin'` field) or a new `originRejected: { route, method, requestId, reason: 'missing-origin' | 'disallowed-origin' }` before ending the 403, plus a dev-mode warn log hinting at `registerOriginExemptPath`.

---

### HOK-28 (Low) — No stoppable per-recipient delivery hook: cross-cutting mute/block policies must be duplicated in every _client file

**File:** `packages/sync/src/_shared/clientFanout.ts:103`
**Area:** pkg-sync

**Evidence/description:** The fanout loop offers `preSyncFanout` (all-or-nothing, before any recipient) and `postSyncFanout` (after all), but nothing per recipient: the only per-recipient injection point is the route's own `_client_v{N}.ts` file. Verified absence: no `preSyncRecipient`/`postSyncRecipient`/`onSyncDeliver` in core `hooks/types.ts:301-322`.

**Why it matters for a consumer:** A global policy like "user A has blocked user B — never deliver B's events to A", tenant isolation double-checks, or per-recipient delivery metrics must be re-implemented inside every route's `_client` handler — and creating a `_client` file purely for that contradicts the docs' guidance to omit it when it would only return success.

**Recommendation:** Dispatch a stoppable `preSyncRecipient` hook per recipient before `processClientSyncForRecipient` / the server-only emit: `{ routeName, receiver, recipientToken, sourceUserId, serverOutput, transport }`; a stop signal skips that recipient (without bumping `recipientCount`).

---

### HOK-29 (Low) — Explicit empty-dimension marker: no hook gaps found in the tooling area

**File:** `scripts/testAll.ts`
**Area:** tooling

**Evidence/description:** Checked before claiming absence: the test runner already exposes an extension registry (`packages/test-runner/src/extensionRegistry.ts`, see HOK-03 for its wiring gap) consumed via per-route `.tests.ts` files; the pre-commit hook is a plain consumer-owned shell file (editable directly, `git commit --no-verify` as escape hatch, and it self-skips when npm is absent); `lintInvariants` has the `// luckystack-allow <rule>: <reason>` per-line escape hatch. The genuine extension gaps found in this area are filed under configurability (custom invariant rules, scaffold template flag) and missing-features (publish resume) in their respective reports.

**Why it matters for a consumer:** Recorded so future review passes know this dimension was audited, not skipped.

**Recommendation:** No action needed for this dimension in this area.
