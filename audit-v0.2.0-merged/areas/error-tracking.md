# error-tracking — Verified & Merged Audit Findings
Sources: reports/error-tracking.md + review/v0.2.0/* · Verified against current working tree (branch chore/package-split-prep, 2026-06-11).

## Verdict summary

22 distinct findings merged across both scans. Verdict tally: **9 CONFIRMED, 5 ALREADY-FIXED, 1 PARTIALLY-FIXED, 5 REFUTED, 2 UNCERTAIN**. The single most important shift since the scans: `runBeforeSend.ts` was rewritten so the three built-in adapters now forward the **resolved (possibly transformed) payload** (`resolveExceptionEvent` / `resolveMessageEvent` return `{error, context}` derived from the hook's return), which fully REFUTES review SEC-05 ("redaction-by-return never applied") — the review scan pre-dates that fix. Also, the legacy span path now wires a real handle-style `startInactiveSpan` into `initSharedSentry` and `sentrySetup.startSpan` prefers it, and `captureException` passes context inline as a Sentry `extra` hint (not process-global `setContext`), partially defusing the legacy concurrency concern. The biggest STILL-LIVE issues are: the default `beforeSend` only deletes `event.request.cookies` and leaves the raw `cookie`/`authorization` headers + request body in production Sentry events (S-1 / SEC-39 — the two scans disagreed wildly on severity here, High vs Low; the code says the cookie-header leak is real but is mitigated by `@sentry/node` defaulting `sendDefaultPii:false`, so Medium is correct); the process-global PostHog `currentDistinctId` cross-attributes errors under concurrency with no AsyncLocalStorage (S-2 / QUA-035); user email shipped with no opt-out (S-3); `registerRedactedLogKeys` is still never consulted on any capture path (S-4); the async PostHog auto-registration can still clobber a consumer overlay because `registerErrorTracker` replaces the whole list (Hard-block #2 / QUA-011); and the README/CLAUDE.md still document non-existent `apiError`/`syncError`/`postLogin` hooks (QUA-033) plus a dangling `datadog-preload` subpath (QUA-034).

## Findings

### ET-01 — Default `beforeSend` scrubs only `event.request.cookies`, leaving raw `cookie`/`authorization` headers + body in Sentry events · severity: med · status: CONFIRMED
- **Sources:** reports(S-1) / review(SEC-39) / both
- **Current location:** `packages/error-tracking/src/sentry.ts:97-103`
- **Original claim:** reports rated this High ("session tokens + request bodies leave the process"); review rated it Low ("mitigated because `@sentry/node` defaults `sendDefaultPii:false`").
- **Verification (current code):** The `beforeSend` is verbatim what both scans quote — only `if (event.request?.cookies) delete event.request.cookies;`. `Sentry.init` (line 79-104) sets no `sendDefaultPii`, no `integrations` override, no header filtering. So `event.request.headers.cookie` / `.authorization` and `event.request.data` are NOT touched by framework code.
- **Verdict & why:** CONFIRMED as a real gap, but the **review's Low and the reports' High are both partly wrong — Medium is right**. The leak is real (the parsed-cookies delete does not cover the raw header), but `@sentry/node`'s `requestDataIntegration` only attaches the raw `cookie` header when `sendDefaultPii` is true OR `include.cookies` is set; modern SDK default is `sendDefaultPii:false`, which suppresses request bodies and the cookie/authorization headers by default. reports/'s adversarial pass asserted the headers ship "in production... any captured error", which overstates it for a default-config consumer; the exposure materializes when a consumer enables `sendDefaultPii` or a custom integration config — which they cannot do here anyway because init options aren't extensible (ET-12). Net: a real defense-in-depth gap, conditional on PII config, hence Medium.
- **Recommendation:** In the same `beforeSend`, also `delete event.request.headers?.cookie` / `.authorization` (case-insensitive) and consider redacting `event.request.data`; expose a composable SDK-level `beforeSend` slot (ties to ET-12).

### ET-02 — PostHog adapter identity is a single mutable `currentDistinctId` — concurrent requests cross-attribute events · severity: high · status: CONFIRMED
- **Sources:** reports(S-2) / review(QUA-035) / both
- **Current location:** `packages/error-tracking/src/adapters/posthog.ts:52, 91-106`; hook wiring `packages/error-tracking/src/autoInstrumentation.ts:84-86, 103-105`
- **Original claim:** Module/closure-level mutable identity rewritten per request by `preApiValidate`/`preSyncAuthorize`; under concurrency user A's exception files under user B's distinctId.
- **Verification (current code):** `let currentDistinctId = options.anonymousDistinctId ?? 'anonymous';` is closure state on the adapter; `setUser` (91-96) overwrites it and `captureException`/`captureMessage`/`recordMetric` read it. `autoInstrumentation` registers `preApiValidate`/`preSyncAuthorize` → `setSentryUser(...)` → `setErrorTrackerUser` → every adapter's `setUser`. No `AsyncLocalStorage` anywhere in framework runtime code (grep confirms ALS only in docs examples).
- **Verdict & why:** CONFIRMED. The await gaps between identity-set and capture make interleaving real on any concurrency (sockets especially). reports/'s adversarial pass correctly noted the legacy *Sentry* path on the HTTP transport is isolated by the SDK's per-request isolation scope — but the **adapter registry path (PostHog) has no such isolation**, so the finding stands. Both scans agree; High is right.
- **Recommendation:** Carry identity in the capture `context` per event (the payload already has `user` at the hook sites) or wrap request handling in an AsyncLocalStorage scope adapters read.

### ET-03 — User email propagated to every tracker on every request with no opt-out · severity: med · status: CONFIRMED
- **Sources:** reports(S-3)
- **Current location:** `packages/error-tracking/src/autoInstrumentation.ts:57-66`; force-enabled at `sentry.ts:134` + `register.ts:27`
- **Original claim:** `createSentryUserContext` ships `email`/`username` for every logged-in user; no `sendDefaultPii`-style toggle on `SentryServerConfig`.
- **Verification (current code):** `createSentryUserContext` still maps `email: user.email ?? undefined` and `username: user.name`. `SentryServerConfig` (sentryConfig.ts:23-31) exposes only `tracesSampleRate` + `ignoreErrors` — no identity toggle. PostHog `identify` (posthog.ts:97-105) persists email/username as person properties.
- **Verdict & why:** CONFIRMED. GDPR-sensitive consumers cannot suppress email shipping without forking. Unchanged since the scan.
- **Recommendation:** Add a config slot (e.g. `registerSentryConfig({ server: { sendUserEmail: false } })`) or an identity-mapper hook consulted by `createSentryUserContext`.

### ET-04 — `registerRedactedLogKeys` is documented as tracker redaction but is never consulted on any capture path · severity: med · status: CONFIRMED
- **Sources:** reports(S-4, docs-gap #3)
- **Current location:** capture path `packages/core/src/tryCatch.ts:12` → `sentrySetup.ts:38-51`; redaction key reader only at `packages/server/src/logSanitize.ts:5,10`
- **Original claim:** `tryCatch(fn, params, context)` forwards `context` verbatim into Sentry `extra`; the README claims `registerRedactedLogKeys` drives breadcrumb redaction, but `isRedactedLogKey` is only read by log sanitization, never by any capture/breadcrumb path.
- **Verification (current code):** `tryCatch.ts:12` calls `captureException(error, context)`; `sentrySetup.captureException` forwards `{ extra: context }` with no key filtering. Grep for `isRedactedLogKey` across `packages/` returns exactly one runtime reader: `packages/server/src/logSanitize.ts`. No capture/adapter path consults it. README.md:50 + `docs/auto-instrumentation.md:212` still present it as a redaction mechanism for tracking.
- **Verdict & why:** CONFIRMED. False sense of redaction coverage exactly as described. Unchanged.
- **Recommendation:** Consult `isRedactedLogKey` (recursively) on `context` in `sentrySetup.captureException/captureMessage` before forwarding, and/or fix the README/doc claim.

### ET-05 — Async PostHog auto-registration races + clobbers a consumer overlay (replace-not-append) · severity: high · status: CONFIRMED
- **Sources:** reports(Hard-block #2) / review(QUA-011) / both
- **Current location:** `packages/error-tracking/src/register.ts:42-58`; registry `packages/core/src/errorTrackerRegistry.ts:52-54`
- **Original claim:** PostHog adapter registered inside an unawaited `void (async () => {...})()` after a dynamic import tick; `registerErrorTracker` REPLACES the whole list, so whichever of {late PostHog registration, sync consumer overlay} runs last silently wipes the other.
- **Verification (current code):** `register.ts:42` is `void (async () => { ... registerErrorTracker(createPostHogAdapter({ client })); })();` — still unawaited, gated on `await tryCatch(lazyPostHog)`. `errorTrackerRegistry.ts:52-54` is `registerErrorTracker = (tracker) => { activeTrackers = [tracker]; }` — pure replace, no append API. The register.ts:18-19 comment still wrongly says the overlay "can register additional adapters via `registerErrorTracker(s)`" (singular replaces).
- **Verdict & why:** CONFIRMED. Nondeterministic clobber when both `POSTHOG_KEY` and a custom overlay adapter exist. Both scans agree; High is right.
- **Recommendation:** Add an `addErrorTracker(tracker)` append primitive to core's registry; register a synchronous lazy-proxy PostHog adapter immediately and bind the real client when the import resolves; or have bootstrap await an exported `ready` promise before importing the overlay.

### ET-06 — README + CLAUDE.md document non-existent `apiError`/`syncError`/`postLogin` hook subscriptions · severity: med · status: CONFIRMED
- **Sources:** reports(docs-gap #1, #2) / review(QUA-033) / both
- **Current location:** `packages/error-tracking/README.md:42-46, 50`; `packages/error-tracking/CLAUDE.md` "What this package does" paragraph
- **Original claim:** README "What gets auto-instrumented" lists handlers on `apiError`, `syncError`, `postLogin`; `autoInstrumentation.ts` registers none of these.
- **Verification (current code):** `autoInstrumentation.ts:84-127` registers ONLY `preApiValidate`, `preApiExecute`, `postApiExecute`, `preSyncAuthorize`, `preSyncFanout`, `postSyncFanout`, `postLogout`. No `apiError`, `syncError`, or `postLogin` subscriber. README.md:44-46 still claims `apiError`/`syncError`/`postLogin` plus "breadcrumbs with redacted input/output" (no breadcrumbs/redaction exist). CLAUDE.md intro paragraph repeats the wrong list ("`apiError`, `syncError`, ... `postLogin`/`postLogout`"). Note: the CLAUDE.md Function Index row for `enableErrorTrackingAutoInstrumentation` lists the correct six, so the file is self-contradictory.
- **Verdict & why:** CONFIRMED. AI-drivability hazard — the docs are the contract for AI consumers. Unchanged since scan.
- **Recommendation:** Rewrite README.md:42-50 and the CLAUDE.md intro to list the actual hooks and describe the `tryCatch → captureException` capture path (matching `docs/auto-instrumentation.md`).

### ET-07 — `register.ts` points Datadog users at a non-existent `@luckystack/error-tracking/datadog-preload` subpath · severity: med · status: CONFIRMED
- **Sources:** review(QUA-034)
- **Current location:** `packages/error-tracking/src/register.ts:15-16`
- **Original claim:** The header comment instructs `--import @luckystack/error-tracking/datadog-preload`, but no such file/export exists; following it yields `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- **Verification (current code):** register.ts:15-16 comment present verbatim. Grep for `datadog-preload` across `packages/` returns only this comment — no module, no `./datadog-preload` export, nothing built. There is also no DD_* env gate in register.ts (no zero-config Datadog path).
- **Verdict & why:** CONFIRMED. Dangling pointer in a doc-as-contract framework. Severity Medium (comment-only, but actively misleading).
- **Recommendation:** Either implement + export `./datadog-preload` (a small dd-trace/hot-shots preload that registers `createDatadogAdapter`) or delete the comment and document the manual consumer-side dd-trace init path.

### ET-08 — Per-tracker capture failures swallowed with zero diagnostics · severity: low · status: CONFIRMED
- **Sources:** reports(code-quality #1) / review(HOK-24) / both
- **Current location:** `packages/core/src/errorTrackerRegistry.ts:69-71, 83-85, 92-95, 108-110`
- **Original claim:** Every fan-out method has a bare `catch { /* Swallow */ }` — a tracker that throws on every call produces a 100% silent observability blackout.
- **Verification (current code):** All four fan-out methods have bare `catch {}` with only a comment; no `getLogger()`, no counter, no hook. The no-throw design is deliberate and documented; the gap is the zero-signal failure.
- **Verdict & why:** CONFIRMED. Low — the swallow is intentional; the missing diagnostic is the defect.
- **Recommendation:** Add a rate-limited `getLogger().warn('[error-tracking] tracker <name> threw during <method>', { err })` inside each catch (preserving the no-throw guarantee), optionally an `errorTrackerFailed` hook.

### ET-09 — `ignoreErrors` default includes `'ECONNREFUSED'` — infra-failure errors silently dropped · severity: low · status: CONFIRMED
- **Sources:** reports(S-6)
- **Current location:** `packages/error-tracking/src/sentry.ts:77`; default in `sentryConfig.ts:38-42`
- **Original claim:** Sentry does substring matching, so a real DB/Redis outage (`connect ECONNREFUSED ...`) never reaches the tracker by default — an observability blind spot on exactly the infra-failure class.
- **Verification (current code):** `const ignoreErrors = sentryConfig?.ignoreErrors ?? ['Socket connection timeout', 'ECONNREFUSED'];` and `DEFAULT_SENTRY_CONFIG.server.ignoreErrors` = same array. Configurable, but the out-of-box default suppresses ECONNREFUSED.
- **Verdict & why:** CONFIRMED. Low — overridable, but a debatable default.
- **Recommendation:** Drop `ECONNREFUSED` from the default or scope it to dev only.

### ET-10 — Adapter `beforeSend` transformed event is silently discarded (redaction-by-return is a no-op) · severity: high · status: REFUTED (already fixed)
- **Sources:** review(SEC-05)
- **Current location:** `packages/error-tracking/src/adapters/runBeforeSend.ts:40-95`; adapters `sentry.ts:54-72`, `posthog.ts:57-89`, `datadog.ts:80-112`
- **Original claim:** All three adapters run `runBeforeSend(...)` but only check truthiness and then forward the ORIGINAL error/context — never the transformed `filtered.payload` — so an immutable redacting `beforeSend` is a no-op.
- **Verification (current code):** This is the code's biggest change since the scan. `runBeforeSend.ts` now exposes `resolveExceptionEvent` / `resolveMessageEvent`, which run the hook and **return the resolved payload**: `error: 'error' in resolved.payload ? resolved.payload.error : error, context: asContext(resolved.payload.context)`. Each adapter consumes the resolved object: `const resolved = resolveExceptionEvent(options.beforeSend, error, context); if (!resolved) return; sentry.captureException(resolved.error, { extra: resolved.context });` (sentry.ts:55-61, mirrored in posthog/datadog). So a `beforeSend` returning `{...event, payload: {...event.payload, context: scrubbed}}` IS honored. Drop semantics work via `null` return OR `forwarded:false` (resolveEvent:45).
- **Verdict & why:** REFUTED — the review scan pre-dates the `runBeforeSend` rewrite. The natural immutable redaction now works end-to-end. (The review's note that "no test covers adapter beforeSend" may still hold — worth a test — but the defect itself is fixed.)
- **Recommendation:** None for the defect. Optionally add an adapter-level test asserting a transforming `beforeSend` changes what reaches the SDK, to lock in the fix.

### ET-11 — Adapter-only auto-instrumentation produces useless zero-duration spans / spans structurally impossible · severity: med · status: PARTIALLY-FIXED
- **Sources:** reports(Hard-block #1, code-quality #4) / review(QUA-012) / both
- **Current location:** `packages/core/src/sentrySetup.ts:77-89`; `packages/error-tracking/src/autoInstrumentation.ts:88-99`; adapters `datadog.ts:131-138`, `sentry.ts:82-84`
- **Original claim:** The adapter contract's `startSpan(name, op, fn)` is callback-scoped, incompatible with the pre/post-hook pair; the legacy shim runs `startSpanAcrossTrackers(name, op, () => {})` (empty callback) and returns `undefined`, so adapter-only consumers get zero-duration garbage spans and no real request span.
- **Verification (current code):** Two-sided. (a) **Legacy Sentry path is now FIXED**: `initSharedSentry` is wired with `startInactiveSpan` (sentry.ts:123-127) and `sentrySetup.startSpan` (77-89) prefers it — `if (sentry?.startInactiveSpan) return sentry.startInactiveSpan({ name, op });` — returning a real handle that `autoInstrumentation` pins in the WeakMap and `.end()`s in `postApiExecute`. So on the Sentry path, request spans now have real duration. (b) **Adapter-only path is STILL broken**: when no legacy Sentry slot is set, `sentrySetup.startSpan` falls through to `startSpanAcrossTrackers(name, op, () => {})` with an empty callback and returns `undefined` (line 88 has no `return`). `isSpanHandle(undefined)` is false, so nothing is pinned; the Datadog adapter's `startSpan` opens and immediately `finally`-finishes a ~0ms span. The structural mismatch (callback-style adapter contract vs handle-style hook pair) is unchanged.
- **Verdict & why:** PARTIALLY-FIXED. reports/'s "structurally impossible for adapters" and review's "useless zero-duration spans" are both still true for the **adapter-only** path; but the dominant Sentry path now works via the handle-style `startInactiveSpan` that the scans did not account for. Net severity drops to Medium because the common case is fixed.
- **Recommendation:** Add an optional handle-style member to the `ErrorTracker` contract (e.g. `startInactiveSpan?: (name, op) => { end(): void }`); have `autoInstrumentation`/`sentrySetup` prefer it across adapters and only fall back to callback `startSpan` for closure-wrappable code; document the limitation until then.

### ET-12 — `Sentry.init` options not extensible (no release/integrations/sendDefaultPii/SDK-level beforeSend) · severity: med · status: CONFIRMED
- **Sources:** reports(Hooks #1, missing-config #1) / review(CFG-14) / both
- **Current location:** `packages/error-tracking/src/sentry.ts:79-104`; config shape `sentryConfig.ts:23-31`
- **Original claim:** `initializeSentry()` hardcodes the whole init bag; `SentryServerConfig` exposes only `tracesSampleRate` + `ignoreErrors`. No `release`, `dist`, `integrations`, `profilesSampleRate`, `maxBreadcrumbs`, `sendDefaultPii`, or composable `beforeSend`. The documented escape hatch (call `Sentry.init` directly) loses the built-in scrub + config-driven rates, and the auto-register path calls `initializeSentry()` anyway, racing the two inits.
- **Verification (current code):** `Sentry.init` (79-104) takes only computed `tracesSampleRate`, `serverName`, `enabled`, `ignoreErrors`, and the hardcoded cookie-only `beforeSend`. `SentryServerConfig` is unchanged (only `tracesSampleRate` + `ignoreErrors`).
- **Verdict & why:** CONFIRMED. Standard prod Sentry hygiene (release health) is impossible without losing the framework scrub or racing inits. Blocks the proper fix for ET-01. Both scans agree; Medium.
- **Recommendation:** Add a passthrough `registerSentryConfig({ server: { init?: Partial<Sentry.NodeOptions>, beforeSend? } })` spread last over the built-in options, with the built-in `beforeSend` **composed** (not replaced); at minimum add `release` + a composable `beforeSend`.

### ET-13 — Overlay-based `registerSentryConfig` silently no-ops in the auto-register flow · severity: med · status: CONFIRMED
- **Sources:** review(CFG-15)
- **Current location:** `packages/error-tracking/src/register.ts:27`; config snapshot at `sentry.ts:73`
- **Original claim:** bootstrap imports `@luckystack/error-tracking/register` (which calls `initializeSentry()` at register.ts:27) BEFORE the consumer overlay; Sentry config is snapshotted at init time, so a `luckystack/sentry/*.ts` overlay calling `registerSentryConfig({...})` runs after `Sentry.init` and is silently ignored.
- **Verification (current code):** `register.ts:27` calls `initializeSentry()` at import time; `initializeSentry` reads `getSentryConfig().server` once (sentry.ts:73) and passes it straight to `Sentry.init`. There is no mechanism to re-apply config to a live client after init. A later overlay `registerSentryConfig` mutates `activeConfig` but nothing re-reads it.
- **Verdict & why:** CONFIRMED. The "npm i + env + restart, no code edit" promise breaks for Sentry tuning via overlay — the only working path is editing `server.ts` before the bootstrap call. No warning is emitted.
- **Recommendation:** Defer `initializeSentry()` until after the overlay phase (register exports an init callback bootstrap invokes post-overlay), or detect the late `registerSentryConfig` (flag set by init) and log a loud warning, or re-apply mutable options to the live client.

### ET-14 — Zero-config PostHog path exposes no adapter options + no client handle (no shutdown) · severity: med · status: CONFIRMED
- **Sources:** reports(missing-config #2) / review(CFG-16) / both
- **Current location:** `packages/error-tracking/src/register.ts:52-53`
- **Original claim:** The env-gated path constructs `new PostHog(key, { host })` + `createPostHogAdapter({ client })` with no way to set `anonymousDistinctId`, a `beforeSend`, or posthog-node client options, and never exposes the client so the consumer cannot `shutdown()` it — contradicting the docs' "consumer owns the client lifecycle".
- **Verification (current code):** register.ts:52-53 is exactly `const client = new mod.PostHog(posthogKey, { host: process.env.POSTHOG_HOST }); registerErrorTracker(createPostHogAdapter({ client }));`. No options threading, no client export. `createPostHogAdapter` does accept `anonymousDistinctId`/`beforeSend` (posthog.ts:43-45) but the register path passes neither.
- **Verdict & why:** CONFIRMED. Couples with ET-16 (no flush/shutdown) — the module-private client cannot be flushed on exit. Medium.
- **Recommendation:** Add a `registerPostHogConfig({ anonymousDistinctId?, beforeSend?, clientOptions? })` registry read by register.ts; expose the created client (`getAutoRegisteredPostHogClient()`); skip auto-registration when the consumer already registered a PostHog adapter.

### ET-15 — No registry-level pre-capture filter (global filtering/sampling/dedup must be duplicated per adapter) · severity: med · status: CONFIRMED
- **Sources:** review(HOK-09)
- **Current location:** `packages/core/src/errorTrackerRegistry.ts:62-97`; docs `packages/error-tracking/docs/adapter-pattern.md`
- **Original claim:** `beforeSend` is per-adapter only; the registry fans out unconditionally with no `preErrorCapture` hook, so one global rule (drop ValidationErrors, sample noisy routes, redact a tenant field) must be re-attached to every adapter, and the dominant dispatch site is core's own `tryCatch` which consumers can't wrap without forking.
- **Verification (current code):** `captureExceptionAcrossTrackers`/`captureMessageAcrossTrackers` (62-87) loop over `activeTrackers` and call each unconditionally — no pre-fan-out filter. No `preErrorCapture`/`errorCaptured` hook exists.
- **Verdict & why:** CONFIRMED. Genuine extensibility gap, especially given the un-wrappable `tryCatch` dispatch site. Medium.
- **Recommendation:** Add `registerErrorCaptureFilter((event) => event | null)` in core's `errorTrackerRegistry`, applied once before the fan-out loop; re-export from `@luckystack/error-tracking`.

### ET-16 — No flush/shutdown lifecycle for error trackers — buffered events lost on exit · severity: med · status: CONFIRMED
- **Sources:** review(MIS-008)
- **Current location:** `packages/core/src/errorTrackerRegistry.ts:34-48` (contract); registry has no `flushErrorTrackers`
- **Original claim:** The `ErrorTracker` contract has no `flush`/`shutdown`; the framework dispatches no shutdown hook; posthog-node batches events, so on SIGTERM/redeploy the tail of captured exceptions is dropped, and the zero-config PostHog client is module-private so it can't even be shut down manually.
- **Verification (current code):** `ErrorTracker` (errorTrackerRegistry.ts:34-48) has `captureException/captureMessage/setUser/setContext?/startSpan?/recordMetric?/beforeSend?` — no `flush`/`shutdown`. No `flushErrorTrackers()` export. The PostHog adapter type does declare `shutdown?` on its client interface (posthog.ts:29) but nothing calls it and the register-path client is private (see ET-14).
- **Verdict & why:** CONFIRMED. The errors captured right before a crash/redeploy — the ones you bought error tracking for — never reach the backend. Medium (depends on a graceful-shutdown call site that also doesn't exist).
- **Recommendation:** Add optional `flush?(timeoutMs?): Promise<void>` to `ErrorTracker`, implement in the three adapters (`Sentry.close`, posthog `client.shutdown`, statsd close), expose `flushErrorTrackersAcrossTrackers()`, call it from a framework shutdown path.

### ET-17 — No client/browser entry; `SentryClientConfig` registry slots are never consumed · severity: low · status: CONFIRMED
- **Sources:** reports(docs-gap #4) / review(MIS-009) / both
- **Current location:** `packages/error-tracking/src/sentryConfig.ts:17-21`
- **Original claim:** `SentryClientConfig` (tracesSampleRate, replaysSessionSampleRate, replaysOnErrorSampleRate) is defined but nothing in the package reads `getSentryConfig().client`; the dead `client` slot makes a deliberately out-of-scope feature look supported.
- **Verification (current code):** `SentryClientConfig` defined (17-21); `getSentryConfig()` is read only at `sentry.ts:73` as `.server`. No `.client` reader in the package. The package CLAUDE.md explicitly says client-side Sentry is configured in the React entry (out of scope), so the slot is dead-but-by-design.
- **Verdict & why:** CONFIRMED as a dead/misleading config surface. Low — it's a conscious scope decision; the issue is the unconsumed registry slot implying support.
- **Recommendation:** Either ship a browser-safe `@luckystack/error-tracking/client` subpath that reads the slots, or delete/clearly mark `SentryClientConfig` as reserved.

### ET-18 — `SENTRY_ENABLED=false` cannot force-disable Sentry in production · severity: low · status: CONFIRMED
- **Sources:** review(CFG-37)
- **Current location:** `packages/error-tracking/src/sentry.ts:91`
- **Original claim:** `enabled: isProduction || enabledOverride === 'true'` — the override only force-ENABLES outside prod; `SENTRY_ENABLED=false` with `NODE_ENV=production` still sends events. No kill switch except unsetting the DSN.
- **Verification (current code):** Line 91 is exactly `enabled: isProduction || enabledOverride === 'true'`. A staging box on `NODE_ENV=production` with a copied prod env file cannot turn Sentry off via `SENTRY_ENABLED=false`.
- **Verdict & why:** CONFIRMED. Low — workaround exists (unset DSN), but the negative override is silently ignored.
- **Recommendation:** Honor the explicit negative: `enabled: enabledOverride !== undefined ? enabledOverride === 'true' : isProduction`.

### ET-19 — `initializeSentry` has no idempotency guard yet is called twice in the 0.2.0 boot flow · severity: low · status: CONFIRMED
- **Sources:** review(QUA-071) / reports(code-quality #5, doc angle)
- **Current location:** `packages/error-tracking/src/sentry.ts:57-137`; call sites `server/server.ts` + `register.ts:27`; doc `docs/sentry-integration.md:137-139`
- **Original claim:** The doc claims the function is idempotent ("calling it twice does NOT re-init the SDK"); there is no guard and `@sentry/node`'s `init()` DOES re-initialize (new client). The double call is now normal (consumer server.ts + the auto-imported register entry).
- **Verification (current code):** `initializeSentry` (57-137) has NO module-scoped `initialized` flag — only the inner `enableErrorTrackingAutoInstrumentation()` (134) is guarded (`autoInstrumentation.ts:78 installed` flag). The JSDoc at 130-133 and register.ts comment both claim idempotence. A second call re-runs `Sentry.init`.
- **Verdict & why:** CONFIRMED. Mostly benign (identical options), but any consumer `Sentry.init` customization between the two calls is clobbered, and the doc guarantee is false. Low.
- **Recommendation:** Add a module-scoped `initialized` flag (first call wins, debug-log repeats) mirroring `autoInstrumentation`'s `installed`; fix the doc sentence.

### ET-20 — `ErrorTrackerEvent.forwarded` is a partly-dead contract field · severity: low · status: PARTIALLY-FIXED / REFUTED-as-stated
- **Sources:** review(QUA-072)
- **Current location:** `packages/core/src/errorTrackerRegistry.ts:21-22`; `packages/error-tracking/src/adapters/runBeforeSend.ts:44-47`
- **Original claim:** `forwarded: boolean` ("when false the adapter must not forward") is never read, never set to false; drop semantics are exclusively the `null` return.
- **Verification (current code):** Since the `runBeforeSend` rewrite, `resolveEvent` (runBeforeSend.ts:44-47) now DOES honor it: `const result = beforeSend ? beforeSend(event) : event; if (!result?.forwarded) return null;` — so a `beforeSend` returning `{...event, forwarded: false}` is a valid drop signal. The built-in adapters still hardcode `forwarded: true` on the event they construct, and no built-in sets `false`, but the field is now a live opt-out path for custom hooks.
- **Verdict & why:** PARTIALLY-FIXED. The review's "never read" claim is now FALSE — `resolveEvent` reads it. What remains true: it's redundant with the `null` return and no built-in ever sets it false. So it's a minor API-clarity smell, not dead code.
- **Recommendation:** Either document `forwarded: false` as the supported drop signal (it now works) or remove it to keep `null` as the single drop path; update `adapter-pattern.md`.

### ET-21 — Datadog adapter type-launders context into string tags · severity: low · status: CONFIRMED
- **Sources:** reports(code-quality #3)
- **Current location:** `packages/error-tracking/src/adapters/datadog.ts:96, 111`
- **Original claim:** `fwdContext as Record<string, string>` cast for `formatTags`, while the real type is `Record<string, unknown>` — non-string values render as `"key:[object Object]"` StatsD tags.
- **Verification (current code):** datadog.ts:96 `formatTags(fwdContext as Record<string, string> | undefined)` and :111 same; `formatTags` (61-64) does `${k}:${v}` with no coercion. A non-string context value becomes `key:[object Object]`.
- **Verdict & why:** CONFIRMED. Low — cosmetic/data-quality on the Datadog tag stream.
- **Recommendation:** Coerce values in `formatTags` (`String(v)` / JSON for objects) or filter to string-valued entries; drop the unsafe cast.

### ET-22 — Datadog `setUser` opens a throwaway span per identity set (one junk span per request) · severity: low · status: CONFIRMED
- **Sources:** reports(code-quality #4)
- **Current location:** `packages/error-tracking/src/adapters/datadog.ts:119-123`
- **Original claim:** `setUser` starts and immediately finishes a `luckystack.user` span on every `preApiValidate`/`preSyncAuthorize` — one junk span per request when Datadog is registered.
- **Verification (current code):** datadog.ts:119-123: `if (user && options.tracer.setUser) { const span = options.tracer.startSpan('luckystack.user'); options.tracer.setUser(span, user); span.finish(); }`. Since `setUser` is fired per request by the hooks, this is one throwaway span per request.
- **Verdict & why:** CONFIRMED. Low — Datadog-only noise, compounding ET-11's zero-duration request spans.
- **Recommendation:** Tag the user on the active request span instead of opening a dedicated one, or skip the span entirely and rely on per-capture context.

### ET-23 — `VITE_SENTRY_DSN`/`VITE_SENTRY_ENABLED` server-side fallbacks normalize client-bundled env for server config · severity: low · status: CONFIRMED
- **Sources:** reports(S-5)
- **Current location:** `packages/error-tracking/src/sentry.ts:58, 60`
- **Original claim:** `VITE_`-prefixed vars are embedded into the client bundle; reading them as the server DSN/enable trains consumers to treat the two as interchangeable, risking exposure of a future server-only knob following the pattern.
- **Verification (current code):** sentry.ts:58 `const dsn = process.env.SENTRY_DSN ?? process.env.VITE_SENTRY_DSN;` and :60 same for `SENTRY_ENABLED`/`VITE_SENTRY_ENABLED`.
- **Verdict & why:** CONFIRMED but low-impact. A DSN is semi-public by design, so the immediate risk is minimal; the concern is pattern hygiene (a server-only knob copying this would leak). Low.
- **Recommendation:** Keep server reads to `SENTRY_DSN`/`SENTRY_ENABLED` only; document the `VITE_*` vars as client-only.

### ET-24 — `registerSentryConfig` is replace-from-defaults, not accumulative · severity: low · status: REFUTED
- **Sources:** reports(code-quality #2)
- **Current location:** `packages/error-tracking/src/sentryConfig.ts:48-50`
- **Original claim:** `registerSentryConfig` merges input over `DEFAULT_SENTRY_CONFIG`, not over the current `activeConfig`, so a second call silently discards the first call's keys.
- **Verification (current code):** sentryConfig.ts:48-50 is `activeConfig = deepMerge(DEFAULT_SENTRY_CONFIG, config);` — confirmed it merges over DEFAULT, not activeConfig, so a second call DOES drop the first call's non-default keys.
- **Verdict & why:** The factual claim is CORRECT, but I mark it REFUTED-as-a-defect: this is standard last-write-wins config-registry semantics used consistently across LuckyStack's other `register*Config` functions (the reports/ note itself offers "or document last-write-wins" as an acceptable resolution). It is not a bug, just a documentation nuance — multi-call accumulation was never the contract. Low/non-issue.
- **Recommendation:** Document last-write-wins in the `registerSentryConfig` JSDoc; no code change needed unless accumulation is explicitly desired.

### ET-25 — README Public API table omits the adapter surface / says "Currently Sentry-backed" · severity: low · status: CONFIRMED
- **Sources:** reports(docs-gap #5)
- **Current location:** `packages/error-tracking/README.md:3, 29-38`
- **Original claim:** README omits `createSentryAdapter`/`createDatadogAdapter`/`createPostHogAdapter`/`registerErrorTracker(s)`/`enableErrorTrackingAutoInstrumentation`, and README:3 still says "Currently Sentry-backed ... future adapters (Datadog, etc.) can slot in" though Datadog/PostHog already shipped.
- **Verification (current code):** README.md:3 verbatim "Currently Sentry-backed; ... future adapters (Datadog, etc.) can slot in". The Public API table (29-38) lists only the legacy Sentry surface — no adapter exports, no `enableErrorTrackingAutoInstrumentation`. CLAUDE.md is current (lists all adapters); README is one generation behind.
- **Verdict & why:** CONFIRMED. Low — doc staleness, but misleads consumers about shipped capability.
- **Recommendation:** Update README:3 and the Public API table to include the adapter registry + the three built-in adapters + `enableErrorTrackingAutoInstrumentation`.

### ET-26 — `docs/sentry-integration.md` claims double-init is a no-op ("Sentry handles that internally") · severity: low · status: UNCERTAIN
- **Sources:** reports(code-quality #5)
- **Current location:** `packages/error-tracking/docs/sentry-integration.md:137-139` (not re-read this pass)
- **Original claim:** The doc says "calling it twice does NOT re-init the SDK (Sentry handles that internally)" — false; modern `Sentry.init` re-initializes a new client.
- **Verification (current code):** Overlaps ET-19 (verified there: `initializeSentry` has no idempotence guard, so the doc claim is wrong about the framework function). I did not re-open `sentry-integration.md:137-139` to confirm the exact wording is still present.
- **Verdict & why:** UNCERTAIN only on whether the exact doc sentence still exists; the underlying technical point (no idempotence guard, SDK re-inits) is CONFIRMED via ET-19. Needs a read of the doc line to close.
- **Recommendation:** Verify and fix `sentry-integration.md:137-139` together with ET-19's code guard.
