# LuckyStack v2 — Code-Quality Audit

**Date:** 2026-06-09
**Scope:** SOLID adherence, duplication, complexity, large-file, typing, error-handling, naming, dead-code, and consistency review across all `@luckystack/*` framework packages (`packages/*`). Report-only — no code was changed.

---

## Executive Summary

This audit consolidates a per-package SOLID/duplication/complexity review covering 13 packages and ~110 distinct findings. The dominant themes are **cross-package utility duplication** (the `deepMerge`/`DeepPartial`/registry/peer-dep-guard/`escapeHtml` family), **socket-vs-HTTP transport handler duplication** in `api` and `sync`, and **a handful of god-functions** (`hotReload.setupWatchers`, `handleSyncRequest`, `handleHttpSyncRequest`, `renderDocsHtml`).

### Findings by package

| Package | Findings | Highest severity |
|---|---:|---|
| `api` | 13 | high |
| `cli` | 12 | medium |
| `core` | 13 | high |
| `create-luckystack-app` | 12 | medium |
| `devkit` | 14 | high |
| `docs-ui` | 12 | high |
| `email` | 8 | medium |
| `error-tracking` | 11 | medium |
| `login` | 12 | medium |
| `presence` | 11 | medium |
| `router` | 14 | medium |
| `secret-manager` | 9 | medium |
| `server` | 11 | medium |
| `sync` | 14 | high |
| `test-runner` | 13 | high |

### Findings by category

| Category | Count |
|---|---:|
| duplication | 40 |
| typing | 25 |
| error-handling | 26 |
| consistency | 18 |
| solid-srp | 8 |
| solid-dip | 7 |
| complexity | 9 |
| large-file | 5 |
| solid-isp | 3 |
| solid-ocp | 4 |
| abstraction | 5 |
| naming | 4 |
| dead-code | 3 |
| other | 4 |

*(Counts are approximate where a finding spans two categories.)*

### Top 10 highest-impact refactors

1. **Cross-package config-utility duplication** — `deepMerge` / `isPlainObject` / `DeepPartial` are copy-pasted across `core/projectConfig.ts`, `core/avatarConfig.ts`, `email/emailConfig.ts`, `presence/presenceConfig.ts`, `error-tracking/sentryConfig.ts`. One shared `@luckystack/core` util eliminates 5 copies and a single-point-of-failure for merge bugs. *(high — duplication)*
2. **Generic registry factory in `core`** — the `let active* / get* / register*` DI-registry pattern is hand-rolled 15+ times in `core` and again in `server` (3 registries). A `createRegistry<T>()` factory removes ~300 LOC of boilerplate. *(high — duplication)*
3. **Transport-handler parity & dedup in `sync`** — `handleSyncRequest.ts` (535 lines) and `handleHttpSyncRequest.ts` (448 lines) are near copy-paste. Extract a shared `executeSyncTransaction()` and make both thin transport adapters. *(high — solid-srp + duplication)*
4. **`api` transport parity bug** — HTTP handler omits the `transformApiResponse` hook and ignores `validation: 'relaxed'`, diverging from the socket handler and from `CLAUDE.md`. Real behavioral inconsistency, not just style. *(high — consistency)*
5. **`devkit/hotReload.ts` god-function** — `setupWatchers()` is ~510 lines with 14 nested closures. Decompose into a `WatcherController` + `ChangeQueue` + `FileClassifier`. *(high — solid-srp + large-file)*
6. **`docs-ui` embedded untyped/unsafe-`innerHTML` client JS** — 200-line inline JS block with implicit-any functions and inconsistent `innerHTML` escaping (XSS-adjacent surface). Extract to a typed module and standardize escaping. *(high — typing + error-handling)*
7. **Cross-package peer-dep-guard duplication** — the `localRequire.resolve()` try/catch guard is repeated across `error-tracking` (3 adapters), `email` (2 adapters), and `error-tracking/sentry.ts`. Extract one `ensurePeerDepInstalled(pkg, hint)` util. *(medium — duplication)*
8. **`test-runner` shared-helper extraction** — `shouldSkip`, `ApiMethodMap`/`ApiMetaMap` types, meta-map query helpers, and summary-count math are duplicated across 4–5 layer files. Centralize in `types.ts` + a `testLayerHelpers.ts`. *(high — duplication)*
9. **Cross-package `escapeHtml` duplication** — two copies in `docs-ui/docsHtml.ts` plus one in `email/renderEmailLayout.ts`. Promote one canonical `escapeHtml` to `core`. *(medium — duplication)*
10. **`sync` double-cast (`as unknown as`) error builders** — `buildSyncError` in both sync handlers double-casts to satisfy `applyErrorFormatter`, violating the framework's own no-`as unknown as` rule. Strengthen `applyErrorFormatter`'s signature and extract a generic `buildFormattedError`. *(high — typing)*

---

## Cross-Cutting Issues (span multiple packages)

These are the highest-leverage fixes because each one collapses several per-package findings into a single change.

### CC-1 — `deepMerge` / `isPlainObject` / `DeepPartial` duplicated across 5 config files (HIGH)
Identical implementations in:
- `packages/core/src/projectConfig.ts` (deepMerge at 548-561)
- `packages/core/src/avatarConfig.ts`
- `packages/email/src/emailConfig.ts:82-108`
- `packages/presence/src/presenceConfig.ts:61-87`
- `packages/error-tracking/src/sentryConfig.ts:50-68`

**Fix:** add `packages/core/src/configUtils.ts` exporting `deepMerge`, `isPlainObject`, `DeepPartial`, and ideally a `registerPartialConfig()` helper. All config registries import from there. Also fixes `core`'s lack of circular-ref/depth guard in `deepMerge` once, for everyone.

### CC-2 — Hand-rolled DI registry pattern repeated 18+ times (HIGH)
`let active* + get* + register*` triads in `core` (`projectConfig`, `rateLimiter`, `emailRegistry`, `errorFormatterRegistry`, `notifier`, `loggerRegistry`, `avatarConfig`, `csrfConfig`, `deployConfigRegistry`, `servicesConfigRegistry`, `runtimeMapsRegistry`, `localesRegistry`, `apiMethodMapRegistry`, …) and in `server` (`customRoutesRegistry`, `originExemptRegistry`, `securityHeadersRegistry`).

**Fix:** `createRegistry<T>(defaultValue, opts?)` factory in `core` returning `{ register, get, isRegistered?, reset? }`. Centralizes debug-logging, test-reset, and immutability of getters.

### CC-3 — Peer-dependency-guard duplication across optional-package adapters (MEDIUM)
`try { localRequire.resolve(pkg) } catch { throw hint }` repeated in:
- `error-tracking/src/adapters/{sentry,posthog,datadog}.ts`
- `error-tracking/src/sentry.ts` + `adapters/sentry.ts` (duplicated `loadSentry()`)
- `email/src/adapters/{resend,smtp}.ts`

**Fix:** `ensurePeerDepInstalled(packageName, hint)` (and a shared `loadPeer<T>(pkg)`), in `core` or a per-package `utils/peerDepGuards.ts`.

### CC-4 — `escapeHtml` duplicated across packages, plus one inline copy (MEDIUM)
- `docs-ui/src/docsHtml.ts` — inline copy at line 261 **and** typed copy at line 415
- `email/src/renderEmailLayout.ts:29-35`

**Fix:** one canonical `escapeHtml` in `core`; both packages import it; remove the inline `docs-ui` copy.

### CC-5 — Config-getter convenience lambdas duplicated across transports (MEDIUM)
`shouldLogDev` / `shouldLogStream` / `shouldNotifyDev` wrapping `getProjectConfig().logging.*` are redefined in `api/handleApiRequest.ts` + `handleHttpApiRequest.ts` and in `sync/{syncRequest,handleSyncRequest,handleHttpSyncRequest,_shared/streamEmitters}.ts`.

**Fix:** a shared `_shared/logFlags.ts` per package (or in `core`) exposing `isDev()/isStream()/isNotifyDev()`.

### CC-6 — Socket-vs-HTTP transport handlers are near copy-paste (HIGH)
Affects `api` and `sync` symmetrically: response-envelope assembly, rate-limit logic, per-recipient client dispatch, error-builders, and shared response/stream types are all duplicated between the socket and HTTP handler files.

**Fix:** transport-agnostic core (`executeSyncTransaction()` / shared `_shared/apiTypes.ts` + `responseEnvelope.ts`) with thin per-transport adapters. Resolves a large fraction of `api` and `sync` findings at once.

### CC-7 — Framework violates its own `no-raw-try-catch` rule (MEDIUM)
Raw `try/catch` where injected/imported `tryCatch` is the documented standard:
- `core/errorFormatterRegistry.ts:76-91`
- `devkit/typeMap/apiMeta.ts` (multiple extractors)
- `router/healthPoller.ts:38-48`, `redisHealthStore.ts:56-63`, `resolveTarget.ts:146-151`
- `secret-manager/src/index.ts:177-187`
- `server/httpHandler.ts:58-68`
- `email/src/adapters/*` (boot-time guards — arguably exempt; see CC-3)

**Fix:** migrate to `tryCatch`, or add an explicit, commented exemption for genuinely synchronous boot-time guards.

### CC-8 — Blanket `eslint-disable` pragmas masking type-safety (MEDIUM)
- `login/src/login.ts:1-2` and `logout.ts` — whole-file `/* eslint-disable */`
- `presence/src/activity/peerNotifier.ts:1` (9 rules) and `lifecycle.ts:1` (5 rules incl. `no-floating-promises`)

**Fix:** narrow to per-line disables with justification; fix the underlying typing/promise issues.

---

## Per-Package Findings

### `api`

| File:line | Category | Sev | Issue | Recommendation |
|---|---|---|---|---|
| handleHttpApiRequest.ts:150-192 vs handleApiRequest.ts:369-430 | consistency | high | HTTP handler omits `transformApiResponse` hook; contradicts `CLAUDE.md` "both transports execute the same sequence" | Add `transformApiResponse` dispatch to HTTP handler (preferred) or document socket-only in `CLAUDE.md` |
| handleHttpApiRequest.ts (vs handleApiRequest.ts:597-645) | other | low | HTTP handler always validates; ignores `validation: 'relaxed'` / `{input:'skip'}` honored by socket | Gate `validateInputByType` on `runtimeApiRoute.validation` like the socket handler |
| handleApiRequest.ts:432-687 | large-file | medium | 256-line `handleApiRequest` mixes validate/auth/rate-limit/execute/respond with stateful closures | Extract pipeline stages like HTTP's `runHandleHttpApiRequestInner` |
| handleApiRequest.ts + handleHttpApiRequest.ts | duplication | medium | Identical response-envelope/`RuntimeApiResponse`/`ApiStreamPayload` types in both | `_shared/apiTypes.ts` |
| handleApiRequest.ts:297-367 vs handleHttpApiRequest.ts:555-595 | duplication | medium | Response-envelope assembly duplicated (socket helper vs HTTP inline) | `_shared/responseEnvelope.ts` `normalizeApiResponse()` |
| handleApiRequest.ts:114-121 / handleHttpApiRequest.ts:139-146 | duplication | medium | `warnedMissingInputType` Set + `warnIfInputTypeMissing()` duplicated | `_shared/inputTypeWarning.ts` |
| handleApiRequest.ts:109-110 / handleHttpApiRequest.ts:136-137 | duplication | low | `shouldLogDev`/`shouldLogStream` lambdas duplicated | See CC-5 |
| handleApiRequest.ts:563-583 | solid-isp | low | `apiFlushPressure` backpressure closure couples transport mechanics into handler | Extract `_shared/backpressure.ts` `createApiFlushPressure()` |
| handleApiRequest.ts:534-544 | other | low | Mutable `cleanupDone` flag for per-request cleanup | Acceptable; only refactor if cleanup grows |
| handleHttpApiRequest.ts:337 | typing | low | Bare `user!` non-null assertion | `user ?? ({} as SessionLayout)` or null-safe wrapper |
| handleHttpApiRequest.ts:271 | other | low | `const requestData = data ?? {}` — `?? {}` unreachable (data already non-null) | Drop default / alias |
| handleApiRequest.ts:661-667 / handleHttpApiRequest.ts:514-518 | error-handling | low | Stop-signal `errorCode` not validated against known codes | Rely on localization fallback or add whitelist; document |

### `cli`

| File:line | Category | Sev | Issue | Recommendation |
|---|---|---|---|---|
| index.ts:78-112 | duplication | medium | "Not a LuckyStack project…" message + `findProjectRoot()` duplicated across scan/add paths | Single `validateProject()` helper + `PROJECT_NOT_FOUND` const |
| commands/checkEnv.ts:98-143 | duplication | medium | checkEnv/checkI18n share report-building structure | Generic `buildScanReports<T>()` in scan.ts |
| commands/checkI18n.ts:35-58 | duplication | low | `findLocaleFiles` vs `collectSourceFiles` directory-walk duplicated | Generic `walkDir(root, predicate, ignored)` |
| lib/scan.ts:41-45,59-63 | error-handling | low | Bare `catch` swallows fs errors without logging | Add debug log; keep skip behavior |
| index.ts:64-131 | solid-srp | low | `main()` mixes parse/validate/detect/dispatch | `parseArgs()` + `handleAddCommand()`/`handleScanCommand()` |
| lib/scan.ts:43,61 | error-handling | low | Bare `catch { continue }` treats all errors identically | Differentiate ENOENT/EACCES; debug-log unexpected |
| index.ts:19 | typing | low | `require('../package.json') as { version }` unvalidated | Parse + assert `version` is string |
| index.ts:30-37 | typing | low | `FEATURES` switch has no exhaustiveness check | `default: const _: never = spec.kind` |
| commands/checkI18n.ts:83-88 | error-handling | low | Inconsistent parse-failure logging (checkEnv silent vs checkI18n warns) | Standardize parse-failure logging |
| lib/project.ts:85-100 | error-handling | low | `editFile()` may leave file half-edited if a token is missing | Validate all tokens first, then write once |
| commands (various) | consistency | low | Ad-hoc `console.log`/`warn`/`error` with no taxonomy | `logger.info/warn/error` layer |
| commands/addPresence.ts:21 | error-handling | low | Add handlers return `void`; thrown `editFile` crashes process | Return `Result<void, Error>`; catch at handler level |

### `core`

| File:line | Category | Sev | Issue | Recommendation |
|---|---|---|---|---|
| projectConfig.ts, rateLimiter.ts, emailRegistry.ts, … (15+) | duplication | high | DI-registry triad repeated 15+ times | `createRegistry<T>()` factory — see CC-2 |
| projectConfig.ts:372-540 | large-file | medium | `ProjectConfig` god-object (50+ fields) + fragile `deepMerge` | Split into domain configs; use proven merge |
| hooks/registry.ts:43-49,92-96 | error-handling | medium | Hook dispatchers swallow per-handler errors; caller gets no partial-failure signal | Return `{ failures?: Error[] }` or per-handler `onError` |
| errorFormatterRegistry.ts:76-91 | consistency | medium | Raw try/catch despite own `no-raw-try-catch` rule | Use `tryCatch` — see CC-7 |
| errorFormatterRegistry.ts, notifier.ts, emailRegistry.ts, loggerRegistry.ts | solid-dip | medium | Code hard-depends on mutable module state; fragile test isolation | Lightweight container abstraction |
| offlineQueue.ts:113-141 | error-handling | medium | `flush*Queue` shifts items before `run()`; throw loses the item | try/catch + requeue/failed-queue + max-retries |
| redis.ts:82-91 | solid-ocp | medium | Hard-coded `STRAY_PREFIX_COMMANDS` set; new commands silently unprefixed (breaks multi-tenant) | `registerStrayPrefixCommand()` or prefix-by-default |
| runtimeTypeValidation.ts (whole file) | complexity | medium | 330-line hand-rolled regex TS-type parser; fragile | Delegate to TS compiler API or add exhaustive tests + parse-fail→success fallback |
| errorTrackerRegistry.ts:62-123 | error-handling | low | No timeout on tracker fan-out; one slow tracker blocks error path | `Promise.race([call, timeout(5s)])` + per-tracker metrics |
| projectConfig.ts:548-561 | error-handling | low | `deepMerge` no depth/circular guard → stack overflow risk | Depth counter + `WeakSet`; consolidate via CC-1 |
| eslint/rules/no-arbitrary-tailwind-color.ts:69,79,86 | typing | low | `as unknown as Rule.Node` casts | Typed `assertIsNode<T>()` guard + comment |
| responseNormalizer.ts (whole file) | typing | low | `ErrorResponseInput` uses `unknown` fields; trust-based | Branded types / Zod schema on entry; mandatory `resolveMessage` |
| socketMiddlewareRegistry.ts:15 | solid-isp | low | `SocketMiddleware` forces full `(socket,next)` contract | Add `SocketObserver`/`SocketValidator`/`SocketEnricher` adapters |
| rateLimiter.ts:31-32,190,323 | naming | low | String-interpolated log messages (no structured fields) | Structured logging context |

### `create-luckystack-app`

| File:line | Category | Sev | Issue | Recommendation |
|---|---|---|---|---|
| src/index.ts:185,199,407,490 | duplication | medium | OAuth/db/email provider lists repeated 4× | Single `PROVIDER_OPTIONS` module constant |
| src/index.ts:492-590 | duplication | medium | `buildOAuthEnvVars`/`buildMonitoringEnvVars`/`buildEmailEnvVars` each redeclare providers + commentary | Declarative provider registry + one `EnvVarBuilder` |
| src/index.ts:406-420 | typing | medium | `asOption` manual casts; `oauthPicked` can be undefined at runtime | `convertAnswersToChoices()` validating all keys |
| src/index.ts:254-390 | complexity | medium | 137-line `runWizard` with nested state machines + 64-line `onKey` | Extract pure `processKeyEvent(state,key)` reducer + render fn |
| src/index.ts:745-763 | error-handling | medium | `editScaffoldFile` `replaceAll` without single-occurrence check | Require each find token to match exactly once |
| src/index.ts:230-233 | typing | low | Raw ANSI escape strings concatenated | `ansiStyle(text, ...styles)` helper |
| src/index.ts:558-562 | naming | low | `buildEmailEnvVars` boolean-flag soup obscures intent | Iterate a provider-state structure |
| src/index.ts:610-628,926-953 | solid-srp | low | `copyTree`/docs-copy mix walk + rename + substitute + binary branch | `FileTransformer` abstraction |
| src/index.ts:806-995 | solid-srp | low | 190-line `main()` mixes validation/gather/setup/execute | Split parse→gather→plan→execute stages |
| src/index.ts:695-728 | solid-ocp | low | `MONITORING_DEPS` + `injectOptionalDeps` need tandem edits per provider | Provider registry drives deps + env blocks |
| src/index.ts:77-80 | error-handling | low | `parseArgs` calls `process.exit(2)` directly; hard to test | Return `Result`/throw `ParseError` |
| src/index.ts:874-877 | error-handling | low | Provider missing from `OAUTH_PROVIDER_ORIGINS` silently dropped | Assert every selected provider has an origin entry |

### `devkit`

| File:line | Category | Sev | Issue | Recommendation |
|---|---|---|---|---|
| hotReload.ts:39-549 | solid-srp / large-file | high | `setupWatchers()` ~510 lines, 14 nested closures, 3 state bags | `WatcherController` + `ChangeQueue` + `FileClassifier` |
| hotReload.ts:217-286 vs 332-404 | duplication | medium | `handleAdd`/`handleChange` share ~80% logic | Shared `handleRouteFileChange(path, isNewFile)` |
| hotReload.ts:288-330 | duplication | medium | `processPendingApiChanges`/`processPendingSyncChanges` structurally identical | Generic `processRouteChanges<T>(kind, handlers)` |
| loader.ts:208,284,341,423 | duplication | medium | `module?.default ? {...} : module` resolution repeated 4+× | `resolveModuleExports()` / `resolveLoadedModule<T>()` |
| loader.ts:13-15 | typing | medium | `devApis`/`devSyncs`/`devFunctions` typed `Record<string,unknown>` | Explicit `ApiRoute`/`SyncRoute` interfaces |
| loader.ts:129-142,245-304,382-439 | complexity | medium | 3 near-identical recursive dir walks | Single `walkRouteFiles(dir, matcher, cb)` |
| templateInjector.ts:349-443,588-700 | solid-dip | medium | Template injector mixes hot-reload sync-pairing orchestration | Move orchestration to `hotReloadOrchestrator.ts` |
| templateInjector.ts:362-376,422-434 | duplication | low | Balanced-brace extraction duplicated | `extractBalancedBraces(str, start)` util |
| typeMap/apiMeta.ts:40-193 | error-handling | low | Extractors use raw try/catch + silent `console.error` | Use `tryCatch` — see CC-7 |
| runtimeTypeResolver.ts:41,49-253 | abstraction | low | Global mutable resolver state, no class wrapper | Optional `RuntimeTypeResolver` class + singleton |
| loader.ts:503-521 | typing | low | `scanFunctionsFolder` repeated `as Record<string,unknown>` casts | `FunctionTree` class with typed get/set |
| supervisor.ts:13-25,37,107 | solid-dip | low | Hard-codes `tsx` path + `server/server.ts` + spawn | Accept paths via config / `ChildProcessFactory` |
| importDependencyGraph.ts:61-63 | complexity | low | Scoped-files cache 1s TTL can lag deletes | Invalidate on every fs event or expose invalidator |
| validateDeploy.ts:115-133 | error-handling | low | Binding URL validation is syntax-only | Optional async DNS/protocol check + `--skip-dns-check`, or document limit |

### `docs-ui`

| File:line | Category | Sev | Issue | Recommendation |
|---|---|---|---|---|
| docsHtml.ts:211-402 | typing | high | 200-line embedded client JS with implicit-any functions | Extract to typed module; or JSDoc-type all inline fns |
| docsHtml.ts:346,378,399 | error-handling | high | Inconsistent `innerHTML` assembly from dynamic data | DOM APIs / `textContent`; convention: never `innerHTML` + concat |
| docsHtml.ts:261,415 | duplication | medium | Two `escapeHtml` in one file (+ email copy) | One canonical `escapeHtml` in core — see CC-4 |
| docsHtml.ts:219-249 | error-handling | medium | `runEndpoint` raw try/catch; `err.message` unguarded; no `response.ok` check | Guard error shape; check `response.ok`; specific messages |
| docsHtml.ts:256 | error-handling | medium | `onclick` attribute builds `route`/`version` unescaped | Escape values or use data-attrs + event delegation |
| docsHtml.ts:21-405 | solid-srp | medium | `renderDocsHtml` (416 lines) bundles HTML+CSS+JS+branding | Split `renderDocsHtml`/`renderDocsCss`/`renderDocsScript` |
| index.test.ts:62-67 | typing | medium | `as unknown as` for `IncomingMessage`/`ServerResponse` doubles | Proper HTTP test util / sealed typed mock |
| renderEmailLayout.ts:29-35 (cross-pkg) | duplication | medium | Email duplicates the same escaping | See CC-4 |
| register.ts:16 | solid-dip | medium | Static import of `@luckystack/server` (optional peer) at module load | Lazy `import()` / factory; or document build-order requirement |
| index.ts:114-119 | typing | low | Method checked only `=== 'GET'`; `undefined` falls to 405 | Explicit undefined handling / method enum |
| docsHtml.ts:27,48 | error-handling | low | `brandColor` injected into CSS unvalidated | Validate against CSS-color whitelist; safe default |
| index.ts:38-42 | typing | low | `DocsTemplateBuilder` not generic over input shape | Generic param or documented extension point |

### `email`

| File:line | Category | Sev | Issue | Recommendation |
|---|---|---|---|---|
| emailConfig.ts:82-108 | duplication | medium | `deepMerge`/`DeepPartial` duplicated (4 packages) | See CC-1 |
| adapters/resend.ts:37-44 (+smtp) | error-handling | medium | Raw try/catch peer-dep guards vs `tryCatch` elsewhere | Shared `peerDepGuard()` — see CC-3; or document boot-time exemption |
| adapters/resend.ts:46-80 | solid-dip | medium | Adapters hard-code service field-mapping | Adapter-neutral `mapEmailMessageTo*Payload()` |
| renderEmailLayout.ts:105 | consistency | low | `brand ?? ''` unreachable fallback (guard already truthy) | `textParts.push(brand)` |
| adapters/resend.ts:11-18 | typing | low | `ResendClient` uses `Record<string,unknown>` | JSDoc the SDK-shape assumption / pin version |
| adapters/console.ts:15 | abstraction | low | Regex HTML-strip heuristic for dev log | Proper html-to-text or document limitation |
| sendEmail.ts:30-43 | consistency | low | `to` accepts any string; no email validation | Optional `validateEmailAddress()` helper; document deferral |
| emailConfig.ts:88 | consistency | low | `activeConfig` not frozen; consumer can mutate shared config | Document immutability contract |

### `error-tracking`

| File:line | Category | Sev | Issue | Recommendation |
|---|---|---|---|---|
| adapters/{sentry,posthog,datadog}.ts | duplication | medium | Peer-dep guard repeated across 3 adapters | `ensurePeerDepInstalled()` — see CC-3 |
| sentry.ts:37-50 vs adapters/sentry.ts:28-41 | duplication | medium | Duplicated `loadSentry()` (different return types) | Shared `utils/loadSentry.ts` |
| sentryConfig.ts:50-68 (+presence,email) | duplication | medium | `deepMerge`/`isPlainObject` duplicated cross-package | See CC-1 |
| register.ts:42-50 | error-handling | medium | `void (async()=>{})()` PostHog init — downstream rejection unhandled | Outer try/catch inside IIFE or `.catch()` |
| adapters/{sentry,posthog,datadog}.ts | duplication | low | `runBeforeSend()` repeated in all 3 adapters | Shared `runBeforeSend` util |
| sentry.ts:48 / adapters/sentry.ts:39 | typing | low | `as SentryModule/SDK` without runtime validation | Validate critical methods after load; or `satisfies` real types |
| autoInstrumentation.ts:69-73,95-99 | duplication | low | User→context mapping duplicated in two hooks | `createSentryUserContext(user)` |
| autoInstrumentation.ts:74-125 | consistency | low | Redundant explicit `return;` in callbacks | Remove; rely on implicit undefined |
| autoInstrumentation.ts:68-123 | typing | low | Hook callbacks lack explicit `: void` return type | Annotate `: void` |
| autoInstrumentation.ts, sentry.ts, sentryConfig.ts, adapters/posthog.ts | solid-ocp | low | Multiple module-level mutable state vars | Wrap in owned objects + reset fns |

### `login`

| File:line | Category | Sev | Issue | Recommendation |
|---|---|---|---|---|
| login.ts:216-218 | error-handling | medium | Returns raw `checkPasswordError` instead of `toReasonKey()` (inconsistent w/ 164/183/209) | `toReasonKey(checkPasswordError)` |
| login.ts:1-2 (+logout.ts) | consistency | medium | Whole-file `/* eslint-disable */` masks issues | Narrow disables — see CC-8 |
| login.ts:75-80,352-400 | typing | medium | `asRecord` → `Record<string,unknown>` for OAuth data; implicit-any field access | Per-provider response types / schema validation |
| session.ts:90-152 | complexity | medium | 63-line single-session enforcement state machine inside `saveSession` | Extract `enforceSessionLimit()` |
| login.ts:260-279 | complexity | medium | `loginWithCredentials` dispatcher branches on param shape implicitly | Explicit `getAuthAction()` discriminator |
| login.ts:177,475 | duplication | low | Random avatar-color fallback duplicated | `generateAvatarFallbackColor()` |
| login.ts:228,451 | typing | low | `{ lastLogin } as never` casts | Proper optional-update type or try/catch |
| login.ts:19-24 | naming | low | `paramsType` violates PascalCase + no valid-combo docs | Rename `LoginOrRegisterParams`; union `LoginParams|RegisterParams` |
| login.ts:532,538 | error-handling | low | Provider/query via fragile `split('/')`/`split('?')` | `new URL(...)`-based helpers |
| login.ts:317-381 | complexity | low | Single-use nested async `getToken`/`getUserData` | Inline into `tryCatch` |
| oauthProviders.ts:127-317 | duplication | low | Endpoint-override ternary repeated 5× | `applyEndpointOverrides()` helper |
| login.ts:56-72 / 228,451 | error-handling | low | Redis multi-result parsing implicit; lastLogin failures silent | `parseRedisMultiResult()` helper; log best-effort outcome |

### `presence`

| File:line | Category | Sev | Issue | Recommendation |
|---|---|---|---|---|
| presenceConfig.ts:69-87 | duplication | medium | `deepMerge`/`isPlainObject` duplicated | See CC-1 |
| activity/leaveRoom.ts:9-13 | dead-code | medium | `socketLeaveRoom` ignores `socket`/`newPath` params; return unused | Implement or simplify signature to `token` only |
| activityEvents.ts:80-84 | error-handling | medium | `dispatchActivitySample` silently swallows `onTrigger` errors | `getLogger().warn(...)` + `captureExceptionAcrossTrackers` |
| activity/lifecycle.ts:126-133 | error-handling | medium | `async` socket handler not awaited; `informRoomPeers` errors unobserved | try/catch + log inside handler |
| presenceConfig.ts:61-63 | duplication | low | `DeepPartial` duplicated | See CC-1 |
| activity/peerNotifier.ts:1 | consistency | low | Blanket eslint-disable (9 rules) | Narrow — see CC-8 |
| activity/lifecycle.ts:1 | consistency | low | Blanket eslint-disable (5 rules) | Narrow — see CC-8 |
| activity/peerNotifier.ts:52,55,58 | consistency | low | `==` instead of `===` | Use strict equality |
| activity/lifecycle.test.ts:243 | typing | low | `as unknown as Socket` mock cast | `createSocketMock(): Partial<Socket>` |
| activity/peerNotifier.ts:40 | error-handling | low | `rooms.get(room)` undefined (handled) but `io` not re-guarded | Defensive `if (!io) return` |

### `router`

| File:line | Category | Sev | Issue | Recommendation |
|---|---|---|---|---|
| httpProxy.ts:37-56 (+wsProxy.ts:15-33) | duplication | medium | `HOP_BY_HOP_HEADERS`/`stripHopByHopHeaders` duplicated | Shared `proxyUtils.ts` |
| healthPoller.ts:38-48 | error-handling | medium | Raw try/catch vs `tryCatch` convention | Use `tryCatch` — see CC-7 |
| startRouter.ts:64-184 | solid-srp | medium | `startRouter()` has 10+ responsibilities | Extract `initializeHealthStore/Poller/ProxyServer` |
| redisHealthStore.ts:56-63 | error-handling | low | Raw try/catch for JSON.parse | `tryCatch` or comment the sync exemption |
| resolveTarget.ts:146-151 | error-handling | low | Raw try/catch for URL parse | `tryCatch` or comment exemption |
| wsProxy.ts:93-100 | abstraction | low | `socket.destroy()` teardown inlined in 4 handlers | `safeDestroy(socket)` helper |
| httpProxy.ts:143-162 | typing | low | `inferErrorCause` catch-all masks unknown codes | Log unknown codes before `upstream-throw` |
| healthPoller.ts:31 | solid-dip | low | `DEFAULT_REQUEST_TIMEOUT_MS` hard-coded (interval is configurable) | Add `probeTimeoutMs` to input from deploy config |
| resolveTarget.ts:59-65 | solid-isp | low | `ServiceTargetResolver` mixes resolution + health | Split `ServiceResolver` / `HealthManager` |
| httpProxy.ts:13-34 | complexity | low | Error-classification mixed with proxy concerns | Extract `errorClassification.ts` |
| resolveTarget.ts:48,60 | typing | low | null vs undefined semantics inconsistent | Document/standardize convention |
| redisHealthStore.ts:66-76 | dead-code | low | `hydrate()` necessity unclear given pub/sub sync | Document race it prevents, or remove |

### `secret-manager`

| File:line | Category | Sev | Issue | Recommendation |
|---|---|---|---|---|
| src/index.ts:177-187 | error-handling | medium | Raw try/catch vs framework `tryCatch` | Adapt to tuple pattern or document boot-time exemption — see CC-7 |
| src/index.ts:132 | typing | medium | `as { values?: ... }` cast before validation | Parse `unknown` → guard → narrow |
| src/index.ts:85-96 | solid-dip | medium | Many module-level mutable bindings; test-reset relies on memory | Encapsulate in `SecretManagerState` / per-config WeakMap |
| src/index.ts:170 vs 320 | typing | low | `pointerMap ??=` vs unconditional overwrite — inconsistent | `ensurePointerMapInitialized()` + explicit guard |
| src/index.test.ts:40 | typing | low | `callsOf` casts real-`fetch` type to vitest mock | Type param as `ReturnType<typeof vi.fn<typeof fetch>>` |
| src/index.ts:140-163 | solid-srp | low | `applyResolved(source)` branches strict vs permissive | Split `applyResolvedStrict`/`Permissive` |
| src/index.ts:193-214 | abstraction | low | Built-in `parseEnvFile` vs README claiming dotenv dependency | Update docs or conditionally use dotenv |
| src/index.ts:216-225 | consistency | low | Debounce timer cleanup pattern incomplete/undocumented | Document unref+clearTimeout intent |

### `server`

| File:line | Category | Sev | Issue | Recommendation |
|---|---|---|---|---|
| runtimeMapsLoader.ts:170,184 | consistency | medium | `console.warn` instead of `getLogger().warn` | Use framework logger |
| httpHandler.ts:58-68 | consistency | medium | `setSecurityHeaders` raw try/catch vs `tryCatch` | Use `tryCatch` — see CC-7 |
| httpRoutes/apiRoute.ts:37-116 (+syncRoute.ts) | duplication | medium | Near-identical error-response construction (stream/JSON branching) | `createErrorResponse()` + `sendErrorResponse()` |
| loadSocket.ts:179-297 | duplication | medium | `joinRoom`/`leaveRoom` handlers share validation/auth/hooks/lock | `handleRoomOperation(action, ...)` factory |
| loadSocket.ts:36 | typing | low | `sessionLocks` type doesn't match chaining semantics | Annotate + comment lock-chaining |
| bootstrap.ts:103-119 | consistency | low | `importOptionalPackageRegisters` not idempotent (no hasRun) | Module-level `hasRun` guard (mirror `applyServerArgv`) |
| capabilities.ts:72-91 | typing | low | `T | null | undefined` three-state memo sentinel | `Symbol('notLoaded')` sentinel or comment |
| httpRoutes/apiRoute.ts:43-108 | abstraction | low | Stream-closed checked at call sites + inside `sendSseEvent` | Encapsulate check in `sendSseEvent`; return success bool |
| customRoutesRegistry.ts, originExemptRegistry.ts, securityHeadersRegistry.ts | abstraction | low | 3 registries repeat the pattern | `createRegistry<T>()` — see CC-2 |
| httpHandler.ts:114,263-270 (+csrfMiddleware.ts:22) | duplication | low | `isStateChangingMethod` predicate copied 3× | Shared util |
| httpRoutes/healthRoutes.ts:30 | typing | low | `as unknown as PrismaPingShape` (justified) | Document exemption per rule 7a; or service-provided health check |

### `sync`

| File:line | Category | Sev | Issue | Recommendation |
|---|---|---|---|---|
| handleSyncRequest.ts:223-758 | solid-srp | high | 535-line handler with 8+ concerns | Decompose into validate→authorize→execute→fanout→per-recipient stages |
| handleHttpSyncRequest.ts:210-658 | solid-srp | high | 448-line HTTP handler mirrors socket via copy-paste | Shared `executeSyncTransaction()` — see CC-6 |
| handleSyncRequest.ts:292,297 / handleHttpSyncRequest.ts:276,281 | typing | high | Double-cast `as unknown as` to satisfy `applyErrorFormatter` (violates own rule) | Strengthen `applyErrorFormatter` signature; no double-cast |
| syncRequest.ts:451-472 | error-handling | high | External AbortSignal listener leaks if socket dies before response | Single coordinating AbortController; cleanup fires once |
| handleSyncRequest.ts vs handleHttpSyncRequest.ts (buildSyncError) | duplication | medium | Identical `buildSyncError` (normalize→envelope→format) in both | `_shared/errorBuilders.ts` generic `buildFormattedError` |
| handleSyncRequest.ts:651-717 / handleHttpSyncRequest.ts:537-611 | duplication | medium | Per-recipient client dispatch duplicated verbatim | `processClientSyncForRecipient()` |
| handleSyncRequest.ts:130-219 / handleHttpSyncRequest.ts:119-206 | duplication | medium | Rate-limit logic duplicated (minor IP/loopback diff) | `checkSyncRateLimits(...)` shared |
| syncRequest.ts:36-39,106-116 (+ handlers, streamEmitters) | duplication | medium | `shouldLogDev`/`shouldLogStream`/`shouldNotifyDev` repeated | `_shared/logFlags.ts` — see CC-5 |
| syncRequest.ts:564-764 | solid-dip | medium | `upsertSyncEventCallback`/`...StreamCallback` near-duplicate registry plumbing | Generic `useEventRegistry<T>(dispatcher)` |
| syncRequest.ts:314-379 | consistency | medium | Validation guards scattered through `syncRequestInternal` | "validate first, execute second" phase |
| syncRequest.ts:304,399,474 | error-handling | medium | Synchronous offline-retry callback chaining → stack-growth risk | `setImmediate`/`queueMicrotask` to break chain |
| syncRequest.ts:61-67 | complexity | medium | `SyncRouteRecord` union is O(routes²); slow IDE/compile | Per-page maps + parameterized `useSyncRequest<PageType>()` |
| handleSyncRequest.ts:369,523-524,739-740 | consistency | low | Mixed inline vs hardcoded success/error message construction | `SyncMessageBuilder` utility |
| _shared/streamEmitters.ts:60-66 | consistency | low | Magic constants scattered (threshold/packet/poll) | `_shared/constants.ts` or config schema |

### `test-runner`

| File:line | Category | Sev | Issue | Recommendation |
|---|---|---|---|---|
| runContractTests.ts:21, runAuthEnforcementTests.ts:21, runFuzzTests.ts:15, runRateLimitTests.ts:51 | duplication | high | `shouldSkip` defined 4× | Shared `testLayerHelpers.ts` |
| runAuthEnforcementTests.ts:28, runRateLimitTests.ts:40,46 | duplication | high | `requiresLogin`/`getRateLimit` meta-map queries duplicated | Shared meta-map query util |
| runAllTests.ts:18-24, runAuthEnforcementTests.ts:5-10, runContractTests.ts:5, runRateLimitTests.ts:6-10, customTests.ts:24 | duplication | medium | `ApiMethodMap`/`ApiMetaMap` redefined 5+× | Export from `types.ts` |
| customTests.ts:285,308 | typing | medium | `response.json() as never` | `as unknown` |
| contractCheck.ts:68-69, authEnforcementCheck.ts:54-55, rateLimitCheck.ts:68-69, fuzzCheck.ts:49-50 | typing | medium | Inline response-envelope literal cast in 4 files | Shared `ResponseEnvelope` type |
| runContractTests.ts:58-64, runAuthEnforcementTests.ts:68-74, runRateLimitTests.ts:127-133, runFuzzTests.ts:49-55, customTests.ts:445-451 | duplication | medium | Pass/fail/skip summary math duplicated | `calculateSummary(results)` |
| customTests.ts:1-453 | solid-srp | medium | 453-line file with 5 responsibilities | Split discovery/context/session/expect/orchestration |
| schemaSampleInput.ts:14 | typing | medium | `def: unknown` cast inline to Zod internal shape | `ZodDef` interface |
| runRateLimitTests.ts:64-114 | abstraction | medium | Login-gated endpoints unskippable without auth (leaky) | Add optional `authToken` to input |
| streamWatcher.ts:189-197 | consistency | low | `close()` returns `Promise.resolve()` not `async` | Make `async` |
| streamWatcher.ts:82-86 | other | low | Global unbounded `responseIndexCounter`, no reset | Move to registry / use UUID |
| authEnforcementCheck.ts:8, rateLimitCheck.ts:5 | consistency | low | Hardcoded expected error-code literals | `ErrorCodes` const in `types.ts` |

---

## Prioritized Refactor Backlog

### Quick wins (low effort, low risk)

- [ ] CC-4: Promote single canonical `escapeHtml` to `core`; remove inline copy at `docs-ui/docsHtml.ts:261`, update `email/renderEmailLayout.ts:29-35`.
- [ ] `api/handleHttpApiRequest.ts:271`: drop unreachable `?? {}`.
- [ ] `email/renderEmailLayout.ts:105`: `brand ?? ''` → `brand`.
- [ ] `presence/peerNotifier.ts:52,55,58`: `==` → `===`.
- [ ] `error-tracking/autoInstrumentation.ts`: remove redundant `return;`, add `: void` return types, extract `createSentryUserContext()`.
- [ ] `test-runner/customTests.ts:285,308`: `as never` → `as unknown`.
- [ ] `test-runner`: extract `ErrorCodes` const + `ResponseEnvelope` type to `types.ts`; make `streamWatcher.close()` async.
- [ ] `login/login.ts:216-218`: use `toReasonKey(checkPasswordError)`.
- [ ] `login`: extract `generateAvatarFallbackColor()` (177,475).
- [ ] `server/runtimeMapsLoader.ts:170,184`: `console.warn` → `getLogger().warn`.
- [ ] `cli/index.ts`: `PROJECT_NOT_FOUND` const + single `validateProject()`.
- [ ] `router/wsProxy.ts`: extract `safeDestroy(socket)`; extract `proxyUtils.ts` for hop-by-hop headers.

### Medium effort

- [ ] CC-1: `core/configUtils.ts` (`deepMerge`/`isPlainObject`/`DeepPartial` + depth/circular guard); migrate `core`, `email`, `presence`, `error-tracking`.
- [ ] CC-2 / `core` + `server`: `createRegistry<T>()` factory; migrate the 18+ registries incrementally.
- [ ] CC-3: `ensurePeerDepInstalled()` + shared `loadPeer<T>()`; migrate `error-tracking` (3 adapters + `loadSentry`) and `email` (2 adapters).
- [ ] CC-5: per-package `_shared/logFlags.ts` for `api` and `sync`.
- [ ] CC-7: migrate raw try/catch to `tryCatch` in `core/errorFormatterRegistry`, `router/healthPoller`, `server/httpHandler`, `secret-manager`, `devkit/typeMap/apiMeta` (or add commented sync-exemptions).
- [ ] CC-8: replace whole-file eslint-disables in `login` and `presence` with narrow, justified disables.
- [ ] `api`: `_shared/apiTypes.ts` + `_shared/responseEnvelope.ts` + `_shared/inputTypeWarning.ts`; fix `transformApiResponse` parity and `validation:'relaxed'` honoring in HTTP handler.
- [ ] `sync`: extract `buildFormattedError`, `checkSyncRateLimits`, `processClientSyncForRecipient`, and remove the `as unknown as` double-casts (typing-high).
- [ ] `sync/syncRequest.ts:451-472`: single-AbortController cleanup (memory-leak fix, error-handling-high).
- [ ] `test-runner`: `testLayerHelpers.ts` (`shouldSkip`, meta-map queries, `calculateSummary`); export `ApiMethodMap`/`ApiMetaMap` from `types.ts`.
- [ ] `server`: `createErrorResponse`/`sendErrorResponse` + `handleRoomOperation` factory; shared `isStateChangingMethod`.
- [ ] `devkit`: `resolveModuleExports`, `walkRouteFiles`, `extractBalancedBraces`, `handleRouteFileChange`, `processRouteChanges<T>`.
- [ ] `create-luckystack-app`: `PROVIDER_OPTIONS` constant + declarative provider registry driving `injectOptionalDeps`/env-builders; `convertAnswersToChoices()`.
- [ ] `error-tracking/register.ts:42-50`: wrap PostHog async IIFE in try/catch.
- [ ] `presence`: log+capture in `activityEvents.ts:80-84` and `lifecycle.ts:126-133`; resolve `socketLeaveRoom` dead params.

### Large effort (high value, higher risk)

- [ ] CC-6 / `sync`: `executeSyncTransaction()` transport-agnostic core; make socket + HTTP handlers thin adapters (collapses `handleSyncRequest`/`handleHttpSyncRequest` SRP + duplication findings).
- [ ] `devkit/hotReload.ts`: decompose `setupWatchers()` into `WatcherController` + `ChangeQueue` + `FileClassifier` + `hotReloadOrchestrator.ts`.
- [ ] `docs-ui/docsHtml.ts`: extract embedded client JS to a typed module; split `renderDocsHtml`/`renderDocsCss`/`renderDocsScript`; replace `innerHTML`+concat with DOM APIs.
- [ ] `core/projectConfig.ts`: split `ProjectConfig` god-object into cohesive domain configs.
- [ ] `core/runtimeTypeValidation.ts`: evaluate delegating the hand-rolled type parser to the TS compiler API (or add exhaustive tests + parse-fail fallback).
- [ ] `api/handleApiRequest.ts`: extract socket pipeline stages mirroring the HTTP handler; extract `_shared/backpressure.ts`.
- [ ] `sync/syncRequest.ts:61-67`: split `SyncTypeMap` per page to cut O(routes²) compile complexity.
- [ ] `core/offlineQueue.ts`: add requeue/retry/error-emit so failed items aren't silently lost.
- [ ] `core/redis.ts`: make stray-prefix command set extensible (multi-tenant correctness).
- [ ] `router/startRouter.ts`: extract subsystem-init factories; `secret-manager`: encapsulate module state in `SecretManagerState`.

---

*End of report.*
