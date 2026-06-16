# Code Quality — FINAL Authoritative Report (wave-1 6-scan + wave-2 3-scan, fully reconciled)

> Single source of truth for every code-QUALITY finding (maintainability, god-functions, duplication, type-safety, twin-drift, dead/shadow surfaces, comment-vs-code drift) across all nine independent scans, reconciled against the **current working tree** (branch `chore/package-split-prep`, HEAD `302cbf1` + ~248 uncommitted "this-week" fixes). Built by merging the 18 per-area reconciled files in `per-area-reconciled/` with the wave-1 quality report (`codebase-scan-14-06-MERGED/CODE_QUALITY.md`, items Q1–Q82).
>
> **Lens.** Security-exploit facets live in the Security report; an item appears here only for its *quality* facet (cross-referenced where it is the root cause of a confirmed bug). Pure functional bugs with no quality angle are out of scope.
>
> **Corroboration** is shown as wave-1 (`n/6`) + wave-2 (`n/3`); wave-2 status was re-verified by opening each cited file in the current tree — wave-2 reports' fixed/present claims were NOT trusted on faith. **Severity** is the highest any run assigned for the quality facet. **STATUS** legend:
> - **NEW** — surfaced only in wave-2, verified real in current code (wave-1's 6 scans missed it).
> - **OPEN** — known since wave-1, re-verified still present.
> - **FIXED** — wave-1/early item, verified resolved in the current tree.
> - **DEFERRED-DECISION** — real, but the fix is a policy/contract/ADR/feature call deliberately deferred.
> - **FALSE-POSITIVE** — claimed by a run, refuted against current source (one-line reason each).
>
> Sorted so actionable work is on top: **NEW + OPEN (by severity) → DEFERRED-DECISION → FIXED (compact) → FALSE-POSITIVE (compact)**.

---

## Status count table

| Status | Critical | High | Med-High | Medium | Low-Med | Low | Info | Total |
|---|---|---|---|---|---|---|---|---|
| **NEW** | 1 | 4 | — | 11 | — | 13 | — | **29** |
| **OPEN** | — | 5 | 3 | 19 | 2 | 22 | 1 | **52** |
| **DEFERRED-DECISION** | — | — | — | 8 | 1 | 5 | 1 | **15** |
| **FIXED** | — | — | — | — | — | — | — | **27** (groups) |
| **FALSE-POSITIVE** | — | — | — | — | — | — | — | **16** (groups) |
| **Total** | | | | | | | | **139** |

Headline NEW/OPEN actionable items: **CQ-N1** docs-ui live renderer reads the wrong (nested vs flat-array) artifact shape — CRITICAL, ship-blocking; **CQ-N2** the framework-wide *shadow-API* class (typed/documented/tested surfaces never wired into prod) — HIGH; **CQ-O1** the hand-synced transport/handler twins (the #1 systemic root cause) — HIGH; **CQ-N3** asset/template/`src/` triplet drift (credentials self-delete dead button, ErrorPage stack leak, Redis-key formatter divergence) — HIGH; **CQ-O8** generated types model only the success branch → `as`-cast pressure everywhere — HIGH.

---

## NEW + OPEN — actionable, by severity

### CRITICAL

#### CQ-N1 — docs-ui live renderer walks nested `apis[page][name][version]` but the emitter+artifact are flat `apis[page] = Entry[]`
- **Severity:** CRITICAL (ship-blocking) · **STATUS: NEW** · **wave-1 0/6 · wave-2 3/3** · area: docs-ui
- **Location:** `packages/docs-ui/src/docsHtml.ts:339-342` (nested `Object.entries`×3) vs `packages/devkit/src/typeMap/emitterArtifacts.ts:62,269,281` (flat array) + committed `src/docs/apiDocs.generated.json:3`
- **Why (quality):** The package's sole function is broken against every real artifact — `Object.entries(array)` yields `name="0", version="page", meta=<string>`, every route renders as scrambled rows and `meta.method` on a string falls back to POST. The correct flat-array renderer (`renderCore.ts`) is DEAD code (only `renderCore.test.ts` imports it) and `liveRenderCore.test.ts:156-164` feeds the *shipped* renderer a fictional nested fixture, so the 59-test suite is green over the broken path. `dist/chunk-XARUZSGO.js` ships the bug in published 0.2.0. Blast-radius temper: dev-only, `enabledInProd:false` default — garbled dev docs + a false sense of a delivered fix, not an end-user breach.
- **Fix:** Serialize `renderCore.ts`'s `renderDocsEndpoint` into the page (its own documented `.toString()` strategy) OR rewrite `buildGroups` to `for (const [page, entries] of Object.entries(apis)) for (const entry of entries)`; also render `data.syncs` (currently never read); replace the nested test fixture with the real array shape (the corrected fixture FAILS today and passes once fixed). Add an `ai:lint` "exported-but-only-tests-import-it" rule to catch the dead-twin class.

### HIGH

#### CQ-N2 — "Shadow-API" class: typed + documented + (often) tested surfaces never wired into production
- **Severity:** HIGH · **STATUS: NEW umbrella (some members carried from wave-1 Q10)** · **wave-1 4/6 (Q10 facet) · wave-2 3/3 across areas** · area: cross-cutting
- **Members (each verified real in current tree):**
  - **api** `packages/api/CLAUDE.md` documents `apiAuthRejected` + `preSocketMessage` hooks, an `applyGlobalIpRateLimit` helper, and `rateLimiting.{identity,skipLoopbackInDev}` config — grep of `packages/api/src` = **0** matches. An AI wires abuse-detection against a hook that never fires.
  - **sync** `sync.flushPressure.maxBufferedBytes` (doc default 5 MiB) never read — `streamEmitters.ts:59,245-248` uses a hard-coded 1 MiB const, no `getProjectConfig` import. Also `redactToken`/`redactTokens` helpers imported only by their own test while raw tokens leak via `targetToken`/`tokens` log keys.
  - **error-tracking** `flushErrorTrackers()` never called on shutdown (`packages/server/src` grep = 0 → PostHog batch dropped every redeploy); barrel omits 5 documented exports (`import … from '@luckystack/error-tracking'` → TS2305); `posthogConfig.ts` (`registerPostHogConfig`/`getPostHogConfig`) is ENTIRELY dead; `startSpanHandle` has zero prod callers.
  - **test-runner** CSRF-enforcement layer (`csrfEnforcementCheck.ts`) + the `runRegisteredLayers` extension runtime are written/typed/tested but neither exported from `index.ts` nor called by `runAllTests` → default sweep gives ZERO CSRF coverage; a consumer cannot even deep-import the layer.
  - **secret-manager** `SecretManagerBootConfig` forwards only `{url,token,dev}` → `source:'hybrid'|'local'`, `retries`, `timeoutMs`, `envNames`, `pollIntervalMs`, `onApplied`, `getCachedResolution`, `refreshSecretManager`, `startRotationPoll` all unreachable. (Also tracked DEFERRED — CQ-D7.)
  - **presence** `getRoomPresence`/`getLastActivity`/`listActivityEvents` exported + documented as roster surfaces, never wired into any prod path (callers = tests/docs only).
  - **docs-ui** `renderCore.ts` (the correct renderer) — see CQ-N1.
- **Why:** The single most AI-hostile pattern in the repo — a symbol is exported, documented, and unit-tested (the test wraps the calls itself), so an AI reading the index believes it works while no production path calls it. Wave-2 unanimously calls this "shadow-API wiring gaps".
- **Fix:** Per member, WIRE it into the request/shutdown/sweep lifecycle OR delete it + the docs/CLAUDE.md that claim it. Add an `ai:lint` invariant: every hook/config/export named in a package `CLAUDE.md` must be dispatched/read/exported in that package, and flag any exported symbol whose only importers are `*.test.ts`/barrels.

#### CQ-O1 — Hand-synced transport/handler/proxy twins that silently drift (the #1 systemic theme)
- **Severity:** HIGH · **STATUS: OPEN** · **wave-1 6/6 (Q1) · wave-2 3/3** · area: cross-cutting (api, sync, router, server, core)
- **Location(s):** socket-vs-HTTP api (`handleApiRequest.ts` ↔ `handleHttpApiRequest.ts`), socket-vs-HTTP sync (`handleSyncRequest.ts` ↔ `handleHttpSyncRequest.ts`), `apiRequest.ts` ↔ `syncRequest.ts` offline queue, `httpProxy.ts` ↔ `wsProxy.ts`, SSE lifecycle `apiRoute.ts` ↔ `syncRoute.ts`, IP-resolution `apiRoute.ts`/`syncRoute.ts`/`authApiRoute.ts`.
- **Why:** The dominant root cause. Validation/lifecycle/envelope ARE now shared in `_shared/` (real progress), but **rate-limit + auth blocks remain inline twins and ALREADY diverge** — socket resolves IP via `resolveClientIp` with no loopback skip; HTTP trusts a pre-resolved string + has a non-prod loopback skip. The parity tests (`transportParity.test.ts:22-24`) explicitly EXCLUDE rate-limit keying + envelope shape, so the divergent stage is never exercised. Fresh wave-2 drift: **SRV-01** SSE error/abort hardening ported to `syncRoute` but not `apiRoute` (HIGH worker-crash regression); HTTP sync handler omits `postSyncAuthorize`+`preSocketMessage` hooks the socket fires; WS proxy diverged then reconverged via `proxyUtils.ts` (nothing pins it).
- **Fix:** Collapse each pair into ONE transport-/direction-agnostic staged pipeline (`runApiPipeline`/`runSyncPipeline` + thin adapters; `enqueueWithSettle`; the `proxyUtils` forward-prelude). Extract `bindSseStreamLifecycle(req,res,markClosed)` into `sse.ts` and call from both routes. Add an `ai:lint` "behavioral-parity" + transport-parity conformance test so divergence is a build error. **Highest-leverage structural change in the repo.**

#### CQ-N3 — Shipped consumer asset / template / dogfood `src/` triplet drift (one screen, three differently-secure copies)
- **Severity:** HIGH · **STATUS: NEW + OPEN (Q12 amplified)** · **wave-1 6/6 (Q12 ActiveSession facet, now FIXED) · wave-2 1–3/3 per member** · area: cli / root-src / scaffolder
- **Members (verified):**
  - **Credentials self-delete dead button (GDPR break).** UI sends only `{confirmation:'DELETE'}`; server requires `data.password` for any hashed account → guaranteed `login.wrongPassword`. Identical in `assets/login/src/settings/page.tsx:284`, `template/src/settings/page.tsx:281-285`, AND dogfood `src/settings/page.tsx:271-289`. NO real-flow regression test (the `_v1.tests.ts` passes `password` directly → green while the UI is broken).
  - **ErrorPage prod stack-trace leak (CWE-209)** in `template/src/_components/ErrorPage.tsx:34` — no `import.meta.env.DEV` guard; the framework's OWN `src/_components/ErrorPage.tsx:37` already has the fix, never propagated.
  - **Dogfood `src/settings/_api/*` is the regressed branch** — hand-builds Redis keys with `process.env.PROJECT_NAME` (bypasses `sessionKeyFor`/`activeUsersKeyFor` → multi-tenant/`session.projectName` divergence), reaches past `getUserAdapter()` to `prisma.user.delete`, skips pre/postAccountDelete hooks + avatar unlink, uses `id` (64-char) where the asset uses `handle` (16-char). The asset == template == correct.
  - **`updateUser_v1` asset↔template divergence** exempted indefinitely via `ASSET_AHEAD_OF_TEMPLATE` (`assetParity.test.ts:33-36`) — asset validates, template doesn't (the *security* framing is FALSE — theme/language are Prisma enums; residual is consistency + permanent drift license).
- **Why:** `AI_PROJECT_INDEX`/Rule-12 point agents at the stale `src/` copy FIRST. Two consumers ship materially different, differently-secure handlers for the same screen, and the parity test EXEMPTS the divergent file, so the drift ships and widens.
- **Fix:** Reconcile to one canonical implementation (prefer the hardened asset/template; import `sessionKeyFor`/`activeUsersKeyFor`; propagate the ErrorPage DEV guard; collect+send the delete password via a `menuHandler.confirm` variant returning the typed value). Drop `ASSET_AHEAD_OF_TEMPLATE`; add a blocking `ai:check-template-drift` CI gate diffing `packages/cli/assets/login` ⇄ `src/` ⇄ `template/`; best: single-source/generate all copies.

#### CQ-O8 — Generated `apiRequest`/`syncRequest`/`system/session` types emit only the success branch → `as`-cast pressure everywhere
- **Severity:** HIGH · **STATUS: OPEN** · **wave-1 5/6 (Q8) · wave-2 3/3** · area: devkit / core / root-src
- **Location:** generator emits only `status:'success'`; consumer widens at `SessionProvider.tsx:89-95` (`type WideSessionResponse`, `rawResponse as WideSessionResponse`); also the `LoginForm` `!response.status` envelope-as-success gap.
- **Why:** The artifact generator models only the success branch while the runtime also returns `status:'error'`. Forces a Rule-21-forbidden hand-widening cast at the one endpoint every consumer touches first, contradicting the project's own no-cast rule and teaching an AI the wrong pattern at bootstrap.
- **Fix:** Fix at the generator — union every `apiRequest`/`syncRequest` response type with `{ status:'error'; errorCode?:string }`. Removes `WideSessionResponse` and the `LoginForm` gap by construction.

#### CQ-O9 — `login.ts` god-module (~1077 lines, GREW) + `saveSession`/`loginCallback` god-functions
- **Severity:** HIGH (module) · **STATUS: OPEN** · **wave-1 6/6 (Q9) · wave-2 3/3** · area: login
- **Location:** `packages/login/src/login.ts` (whole); `saveSession` (~213, `session.ts:43-256`); `loginCallback` (~138); duplicated `allowMultiple?'multiple'` BC shim at `session.ts:85,173`.
- **Why:** Splitting started (register/redirect/accountStrategy/authLockout/emailModuleLoader extracted) but `login.ts` GREW to ~1077 lines holding credentials + OAuth state/PKCE + token exchange + profile fetch + find-or-create + redirect. `saveSession` still folds the concurrent-cap TOCTOU across the persist boundary; the BC shim is duplicated.
- **Fix:** Continue the extraction per concern (`credentials.ts`, `oauth/{state,exchange,profile,findOrCreate,callback}.ts`) with `login.ts` as a barrel; extract one enforcement helper owning the atomic count→decide→persist; compute `effectivePerUser` once; dedupe the shim.

#### CQ-N4 — `shared/tryCatch.ts` drags `node:async_hooks` into the Vite client bundle (repo-internal drift)
- **Severity:** HIGH · **STATUS: NEW** · **wave-1 2/6 (misc) · wave-2 1/3** · area: root-server / core
- **Location:** `shared/tryCatch.ts:8` → `packages/core/src/tryCatch.ts` → `sentrySetup` → `errorTrackerRegistry.ts:11,88` (`new AsyncLocalStorage()` at module top level); imported by `src/_components/LoginForm.tsx:7`; `vite.config.ts:64-68` aliases only `@luckystack/*/client`, not bare `shared/*`.
- **Why:** CONCRETE PROOF — the built `dist/assets/client-D1shg7jL.js` (an eager entry in `dist/index.html`) contains both the `node:async_hooks has been externalized` throwing stub AND a top-level `new …AsyncLocalStorage`, so the repo's own login/register client throws at module-eval. Scope-capped HIGH (not CRIT): the shipped template `template/shared/tryCatch.ts` is clean — repo-internal drift only.
- **Fix:** Mirror the client-safe template body (no `captureException`), OR break the static `tryCatch → sentrySetup` edge in core (lazy `import()` in the catch), OR add a `shared/tryCatch` client alias to `vite.config.ts`.

### Medium-High

#### CQ-O13 — `loadSocket` god-function (~430 lines) with near-duplicate join/leave handlers + un-sanitized `updateLocation`
- **Severity:** Medium-High · **STATUS: OPEN** · **wave-1 5/6 (Q13) · wave-2 3/3** · area: server
- **Location:** `loadSocket.ts:82-434` (join `:187-245`, leave `:247-305`, validate `:420-444`, `updateLocation` `:361-379`)
- **Why:** Wires the entire Socket.io connect lifecycle inline (~12 listeners); join/leave are ~40-58-line near-dupes; each async IIFE is an unguarded floating promise; validate-before-join is buried; `updateLocation` persists WITHOUT the `sanitizeSessionRoomKeys` that join/leave apply (in-place mutation of a shared object); handshake CORS accepts origin-less connections (twin-divergence with HTTP).
- **Fix:** Extract per-event registrars taking a shared `SocketContext`; collapse join/leave into one `handleRoomMembershipChange`; route all three session writes through one `persistSessionPatch` that sanitizes; make validate-before-join a named, unit-tested fn; wrap each IIFE in `tryCatch`.

#### CQ-O14 — `handleApiRequest` (socket) god-function (~160 lines, improved) + captured-mutable-`let` formatter refs
- **Severity:** Medium-High · **STATUS: OPEN** · **wave-1 5/6 (Q14) · wave-2 1/3** · area: api
- **Location:** `handleApiRequest.ts:410-428` (`emitApiError` closure over mutable refs); `system/logout` shortcut `:452-459`
- **Why:** Improved (stages extracted) but still threads mutable `let` refs read by `emitApiError` defined before assignment; the `system/logout` shortcut bypasses the respond-hook chain + rate-limit and always emits `success:true`.
- **Fix:** Pass formatter/route into `emitApiError` explicitly (drops the `prefer-const` disable); route `system/logout` through `emitApiResult`; share rate-limit/auth stages with the HTTP twin (CQ-O1).

#### CQ-O15 — `templateInjector.ts` ~840-line god-module; PAIRED-twin still regex-mutates consumer source
- **Severity:** Medium-High · **STATUS: OPEN** · **wave-1 4/6 (Q15) · wave-2 3/3** · area: devkit
- **Location:** `templateInjector.ts` whole; PAIRED twin `updateClientFileForPairedServer` `:656-731` (`[^}]*` nested-brace breaks `:704/711/719`); `injectServerTemplateWithClientInput` `$`-string splice `:827-830`; failed paired rewrite swallowed `:692-694` + `hotReload.ts:249-251`
- **Why:** The AST migration is HALF-done — the DELETE twin was migrated (`$`-injection fixed) but the PAIRED twin + server-inject splice were NOT. `/^(\s*)clientInput:\s*\{[^}]*\}/m` stops at the first inner `}`, orphaning the outer brace of nested types → uncompilable TS written to the user's own file while the fn returns `true` and `hotReload` upserts anyway.
- **Fix:** Migrate both surviving paths to the TS AST; re-parse the result before writing and leave the file untouched + log on failure; check the paired-rewrite return before upserting; convert the splice to a replacer function.

### Medium

#### CQ-O16 — Blanket file-level `eslint-disable` on the largest/riskiest files (incl. scaffold-page output)
- **Severity:** Medium · **STATUS: OPEN** · **wave-1 6/6 (Q16) · wave-2 3/3** · area: cross-cutting
- **Location:** `devkit/{loader,hotReload,templateInjector,tsProgram,extractors,routeMeta,discovery}.ts:1-2`; `api/handleApiRequest.ts:1-2`; `server/{server,utils/repl}.ts:1-2`; root-server `server/server.ts`/`repl.ts`; sync handlers (per-rule-commented, partial); `scaffoldPage.mjs` output; template `src/` files.
- **Why:** Whole-file disables defeat the project's own invariant linter exactly where it's needed most — the devkit floating-promise disables hide the unguarded-async crash class; `eqeqeq`/`no-non-null-assertion` off across an 800-line handler won't flag a wrong `==`/`!`. The scaffolder models the exact anti-patterns the linter exists to catch.
- **Fix:** Narrow to targeted `// eslint-disable-next-line <rule>: <reason>` / `// luckystack-allow`; strip blanket disables from `scaffoldPage.mjs` output (add `//? intent:`, wrap placeholder in `useTranslator`).

#### CQ-O18 — Unguarded floating async / missing error listeners → unhandled rejection or crash
- **Severity:** Medium · **STATUS: OPEN** · **wave-1 4/6 (Q18) · wave-2 3/3** · area: cross-cutting (server, devkit, core, router)
- **Location:** `loadSocket` `void (async()=>{})()` IIFEs; devkit `hotReload.ts:211,285,503-505`; router WS client-socket error listener; `getParams` request-stream `'error'` reject (`getParams.ts:111-113`) fired via `void handleHttpRequest` (`createServer.ts:195`) with no `.catch`; `serveFile` unguarded `decodeURIComponent` (RS-01). No global `process.on('unhandledRejection')` anywhere in `packages/*/src`, `server/`, `shared/`.
- **Why:** Every detached async boundary is `async` with no `tryCatch`/`.catch`; a client RST mid-body, a Redis blip, or a malformed `%`-escape becomes an unhandled rejection → process exit under Node default. Several sit under the blanket floating-promise disable (CQ-O16). The presence grace-timer half was genuinely FIXED.
- **Fix:** Wrap every detached boundary in `tryCatch`/`.catch`; in `getParams` resolve `null` on `'error'` + add a `.catch()` backstop; guard `decodeURIComponent` with `tryCatchSync`; consider a global `unhandledRejection` backstop; remove the blanket disables so the linter surfaces them.

#### CQ-O20 — `httpProxy.handleRequest` (~167 lines) god-function; proxies lack upstream timeout + parity pin
- **Severity:** Medium · **STATUS: OPEN (god-fn) + NEW (upstream-timeout)** · **wave-1 5/6 (Q20) · wave-2 3/3** · area: router
- **Location:** `httpProxy.ts:26-192`; `wsProxy.ts:96-119`/`httpProxy.ts:96-119` (no `timeout` on `transport.request` — grep=0); no proxy-parity test
- **Why:** The body-cap race is GONE (capability removed → DD), WS/HTTP guards reconverged via `proxyUtils.ts`. Residual: HTTP handler still a ~167-line god-fn, neither proxy sets an upstream-leg timeout (a stalled `system` backend pins both sockets indefinitely), nothing pins the two proxies to identical guards.
- **Fix:** Extract `resolveAndGate`/`buildUpstream` guarded by a single `settled` flag; set `timeout` from `routing.upstreamTimeoutMs` (504+destroy); add a proxy-parity test (absolute-form / protocol-relative / spoofed-XFF).

#### CQ-O21 — `buildTypeMapArtifacts` (~300 lines) grouped-emit block copy-pasted 4× + orphaned shadow `emitter.ts`
- **Severity:** Medium · **STATUS: OPEN** · **wave-1 3/6 (Q21) · wave-2 1–3/3** · area: devkit
- **Location:** `emitterArtifacts.ts:218-528` (page-loop ×4 for type/method/meta/schema maps); orphaned full second codegen `typeMap/emitter.ts` (zero importers, legacy `'root'` branch, `T=any`)
- **Why:** Four hand-synced copies of the `grouped`/`mustGet`/`toSorted` loop invite drift; `emitter.ts` is a ~10 KB dead twin a fix would silently no-op into.
- **Fix:** Extract one `emitGroupedMap(records, projector)` called ×4; delete `emitter.ts` (confirm `defaultImports`/`typeContext.ts` don't depend on it first) or re-export from it.

#### CQ-O22 — `setupWatchers` god-function (~510 lines)
- **Severity:** Medium · **STATUS: OPEN** · **wave-1 5/6 (Q22) · wave-2 3/3** · area: devkit
- **Location:** `hotReload.ts:53-598`
- **Why:** One closure owns marker/path derivation, the coalescing runner, ~6-8 classifiers, 5 debounce queues, handleAdd/Change/Delete/FunctionChange, 2 pending-change processors, 3-root watcher construction — over shared mutable state, untestable in pieces; source of the floating-promise crash class (CQ-O18). Dev-only.
- **Fix:** Introduce a `WatcherContext`/`HotReloadController`; extract pure path classifiers + per-event handlers; unit-test the classifiers + debounce scheduler.

#### CQ-O23 — `saveSession` god-function (~213 lines) with duplicated `effectivePerUser`/`allowMultiple` shim
- **Severity:** Medium · **STATUS: OPEN** · **wave-1 5/6 (Q23) · wave-2 3/3** · area: login
- **Location:** `session.ts:43-256` (BC shim `:85`/`:173`)
- **Why:** preSessionCreate veto, rejectNew cap (TOCTOU split across the persist), CSRF mint, sanitize, persist, single-session eviction, broadcast, postSessionCreate — with a duplicated `allowMultiple ? 'multiple' : perUser` shim. (Same module as CQ-O9.)
- **Fix:** Extract one enforcement helper owning the atomic count→decide→persist + `evictForSingleSession()`/`mintCsrf()`; compute `effectivePerUser` once.

#### CQ-O24 — `sendEmail` decomposed (FIXED) but `toProviderPayload` silently drops typed `attachments`/`headers`
- **Severity:** Medium · **STATUS: OPEN (Q24 god-fn FIXED; payload-drop NEW)** · **wave-1 5/6 (Q24) · wave-2 3/3** · area: email
- **Location:** `adapters/providerPayload.ts:17-29`; contract `core/emailRegistry.ts:48-61`; pinning test `providerPayload.test.ts`
- **Why:** The god-function IS decomposed (FIXED). But the shared mapper projects only 8 scalar fields and drops `attachments`+`headers` that `emailRegistry.ts:54,61` declare as adapter-forwarded — a test even pins the drop. A consumer sets an invoice attachment / `List-Unsubscribe` header, type accepts it, `send` returns `{ok:true}`, data never reaches Resend/nodemailer.
- **Fix:** Forward both in `toProviderPayload` + update the pinning test, OR `@deprecated`/remove them from `EmailMessage`. Don't ship a type+doc contract the adapters don't honor.

#### CQ-O25 — Generator/script parse-infrastructure duplicated + drifted across generators and template twins
- **Severity:** Medium · **STATUS: OPEN** · **wave-1 3/6 (Q25) · wave-2 3/3 (template-twin facet)** · area: scaffolder / scripts
- **Location:** `safe`/`walkFiles`/`extractImports`/`extractExports` + route regexes byte-copied across `generateProjectIndex.mjs`/`generateAiCapabilities.mjs`/`generateGraph.mjs`/`generateRunbooks.mjs`/`generateProductOverview.mjs`/`scaffoldRouteTest.mjs` AND their `template/scripts/` twins (~12 sites). Confirmed live drift: `template/scripts/generateAiCapabilities.mjs` missing the whole `hasTestFile` + `Tests` column (42 diff lines, no `KEEP IN SYNC` marker).
- **Why:** The copies already drift; the regex extractors are fail-lossy (miss multi-line `httpMethod`/`satisfies`/`export *` → silently default routes to POST); a scaffolded consumer's `AI_CAPABILITIES.md` never shows the per-route Tests indicator Rule 12 tells the AI to read.
- **Fix:** Extract one zero-dep `scripts/_lib/scan.mjs` imported by all generators (+ shipped in template); add `checkTemplateSync.mjs` CI asserting `scripts/X.mjs == template/scripts/X.mjs` byte-for-byte; better, reuse the devkit `ts.Program`/TypeChecker.

#### CQ-O26 — IP-resolution / rate-limit-identity logic duplicated across HTTP routes + transports (one buggy)
- **Severity:** Medium · **STATUS: OPEN (partially FIXED)** · **wave-1 3/6 (Q26) · wave-2 2–3/3** · area: server / api / sync
- **Location:** `resolveRequesterIp.ts` extracted + imported by api/sync (FIXED half); residual api `resolveRateLimitIdentity` ↔ `resolveHttpRateLimitIdentity` twins; socket vs HTTP IP resolution diverges (socket `resolveClientIp` + no loopback skip; HTTP raw string + loopback skip) on BOTH api and sync.
- **Why:** The server block was de-duplicated, but the api/sync rate-limit-identity twins remain and ALREADY diverge on the loopback-skip decision and the `'unknown'`/`'anonymous'` sentinel collapse.
- **Fix:** Move `resolveRateLimitIdentity`+`hookScopeForIdentityScope` to a shared `_shared/rateLimitIdentity.ts`; resolve IP once on both via `resolveClientIp`.

#### CQ-O28 — `runAllTests` decomposed (FIXED) but totals+reporter still hand-maintained term-by-term per layer
- **Severity:** Medium · **STATUS: OPEN (god-fn FIXED; term-by-term lists OPEN)** · **wave-1 6/6 (Q28) · wave-2 2–3/3** · area: test-runner
- **Location:** `runAllTests.ts:162-173` (`computeTotals` lists each layer ×2), `:268-321` (reporter lists each layer ×3)
- **Why:** The body IS decomposed (`buildAuthHeaders`/`runSweepLayers`/`runCustomLayer`/`computeTotals` + test — FIXED). Residual: adding the CSRF layer (CQ-N2) requires editing all four hand-synced lists — the twin-drift trap.
- **Fix:** Drive totals + reporter from a single `LAYER_KEYS`/`Record<layerKey, summary>` iteration; move the reporting half into `reporter.ts`.

#### CQ-O29 — `handleAuthApiRoute` (~190 lines) = two endpoints in one function
- **Severity:** Medium · **STATUS: OPEN** · **wave-1 3/6 (Q29) · wave-2 (carried)** · area: server
- **Location:** `authApiRoute.ts:26-216` (OAuth branch `:91-126`; IP rate-limit disarmed when `defaultApiLimit===false` `:88`)
- **Why:** Provider lookup, two rate-limit regimes, OAuth-authorize redirect, AND credentials login with cookie/header token delivery — effectively two endpoints in one fn.
- **Fix:** Split into `handleOAuthAuthorize` + `handleCredentialsLogin` on `isFullOAuthProvider`; share only the rate-limit preamble; fall back to `rateLimiting.auth` for the IP key when `defaultApiLimit` is false.

#### CQ-O30 — `getParams` (~82 lines) lacks an already-responded latch → double-`writeHead`/double-resolve
- **Severity:** Medium · **STATUS: OPEN** · **wave-1 3/6 (Q30) · wave-2 2/3** · area: core
- **Location:** `core/getParams.ts:57-66`
- **Why:** Mixes GET query parse, streaming body collection, body-size enforcement, three content-type branches; `req.destroy()` doesn't synchronously stop a buffered chunk → the second `res.writeHead(413)` after `res.end()` throws `ERR_HTTP_HEADERS_SENT` inside the `'data'` callback (combines with CQ-O18 → another uncaught-throw path).
- **Fix:** `let responded=false` in `writeJsonErrorAndResolve` (or `if (res.headersSent) return;`); split body-read from content-type dispatch.

#### CQ-O31 — `dispatchHttpRequest` (~100 lines) security-path god-function + rotting inline safe-header denylist
- **Severity:** Medium · **STATUS: OPEN** · **wave-1 4/6 (Q31) · wave-2 1/3** · area: server
- **Location:** `httpHandler.ts:233-332` (safe-header loop `:270-274`)
- **Why:** Cookie-option build, URL split, origin gate, security headers, request-id, safe-header copy, OPTIONS, method gate, token+cookie refresh, CSRF, two dispatch phases; the inline safe-header denylist silently rots when a new sensitive header appears.
- **Fix:** Extract `buildSecurityHeaders()`/`buildSafeHeaders()` (denylist as a shared constant) + `resolveRequestId()`; ordered named middleware step list.

#### CQ-O32 — Two parallel type-resolution engines + non-`src` srcDir hardcode drops every route
- **Severity:** Medium · **STATUS: OPEN (engines) + NEW (srcDir hardcode)** · **wave-1 4/6 (Q32) · wave-2 1/3** · area: devkit
- **Location:** `runtimeTypeResolver.ts` `resolveExpression` (string-text parser) vs `tsProgram.ts:203-377` `expandTypeDetailed` (~175 lines, `ts.Type`); NEW `routeMeta.ts:20,52` (literal `/src\/.../` regex → `return ''` drops every route on a non-`src` `srcDir`)
- **Why:** Two type systems hand-synced; `expandTypeDetailed` is the highest-risk codegen fn. NEW: hardcoded `src/` means a consumer setting the advertised `projectConfig.paths.srcDir='app'` gets ZERO API/sync types, no error. (`splitTopLevel` quote-awareness was FIXED.)
- **Fix:** Make the string expander a thin post-processor over the AST expander (or delete it); decompose `expandTypeDetailed` per type-kind; anchor route-path extraction on `path.relative(getSrcDir(), file)` and throw when discovery found a file but `extractPagePath` returns `''`.

#### CQ-O33 — `serveFile` substring deny-list (allow-by-default) + stale zod comment + 403-returns-200
- **Severity:** Medium · **STATUS: OPEN** · **wave-1 6/6 (Q33) · wave-2 3/3** · area: root-server
- **Location:** `server/prod/serveFile.ts:67` (stale comment), `:69-89` (substring denylist), `:60` (`startsWith(rootFolder)` no trailing sep), `:88` (403 branch missing `writeHead` → 200), `:57-58` (committed `console.log`), vs `staticRoutes.ts`
- **Why:** Denies-by-substring (anything not enumerated is served), the function that disclosed `/server.js` (now mitigated at the framework regex layer — FIXED, uncommitted + bundle still in `dist/`); `startsWith(root)` matches sibling `dist-secret/`; stale comment claims a zod pre-filter that doesn't exist; Forbidden returns 200; two `console.log` ship on the prod hot path.
- **Fix:** Switch to a Vite-manifest extension allow-list; data-table denylist + content-type; compare against `root + path.sep`; add `writeHead(403)`; delete the `console.log`s; correct the comment; move the server bundle out of `dist/`.

#### CQ-O34 — Untested code embedded in template literals (`docsHtml.ts render()` + browser program)
- **Severity:** Medium · **STATUS: OPEN** · **wave-1 5/6 (Q34) · wave-2 1–3/3** · area: docs-ui
- **Location:** `docsHtml.ts:335-395` (`render()`/`buildGroups`), `:318/221/273` (try-it-out URL omits `api/` prefix → 404s), `:306` (`meta.tags && .length` truthy-on-string crash), per-keystroke re-render `:369-378`
- **Why:** The entire inline browser program is one template literal → never type-checked/linted/unit-tested (only `new Function` parse-check); has already shipped real bugs (CQ-N1 shape mismatch). `render()` re-wires listeners on every keystroke; the runner URL omits `api/`.
- **Fix:** Extract logic into `renderCore.ts`'s `.toString()` pattern (folds into CQ-N1); pure `buildGroupsHtml(data,filter)` + one-time `wireEvents()` delegation; test it; build the runner URL as `/api/${page}/${name}/${version}`; guard `Array.isArray(meta.tags)`.

#### CQ-O35 — `test-runner` misleading coverage: error-envelope-as-pass, CSRF-header omission, inert `__proto__` fuzz
- **Severity:** Medium · **STATUS: OPEN + NEW** · **wave-1 various · wave-2 1–3/3** · area: test-runner
- **Location:** `contractCheck.ts:85-114` (any error envelope → pass); `runAllTests.ts:73-80` (`buildAuthHeaders` Cookie-only → contract/fuzz false-PASS, rate-limit false-FAIL); `rateLimitCheck.ts:55-95` (drains body-cancelled then blames the limiter for a CSRF 403); `fuzzCheck.ts:18` (`{__proto__:{…}}` serializes to `{}`); `walkEndpoints.ts` (API-only, no sync sweep)
- **Why:** The harness reports coverage it didn't achieve — a route rejecting ALL input passes contract, authenticated sweeps omit the CSRF header the server enforces, the pollution junk shape sends nothing. (`schemaSampleInput` Zod-walker node coverage was genuinely FIXED.)
- **Fix:** Assert `status:'success'` when `inputFor` produced a non-empty sample; thread the session CSRF token into the authenticated builders; classify drain-rejected-pre-limiter as `skipped`; use a pre-serialized `'{"__proto__":{"polluted":true}}'` body; add a `syncMethodMap` walk (DEFERRED-feature).

#### CQ-O36 — `Home` settings page god-component (~530 lines) bundling 8 sections
- **Severity:** Medium · **STATUS: OPEN** · **wave-1 4/6 (Q36) · wave-2 2/3** · area: root-src / cli
- **Location:** `src/settings/page.tsx` (~67-530), mirrored in `assets/login/src/settings/page.tsx` (~463) + `template/`
- **Why:** One page owns avatar+FileReader, name/email/language/theme, password change, session list+revoke, preferences, danger-zone — 8 flows; the credentials-delete bug (CQ-N3) hid in this size.
- **Fix:** Split into `<ProfileSection>`/`<PasswordSection>`/`<SessionsSection>`/`<PreferencesSection>`/`<DangerZone>` + a `useSettingsApi` hook (across all three copies, once reconciled per CQ-N3).

#### CQ-O37 — `useSocket` god-effect (~190 lines) + duplicated room-emit helpers (~140 dup lines)
- **Severity:** Medium · **STATUS: OPEN** · **wave-1 4/6 (Q37) · wave-2 2/3** · area: root-src
- **Location:** `src/_sockets/socketInitializer.ts:65-256,265-407`
- **Why:** The `useSocket` effect wires visibility, heartbeat, sync bridge, logout/redirect, online/offline flush + cleanup in one closure; `joinRoom`/`leaveRoom`/`getJoinedRooms` are ~140 duplicated promise-wrapped emit/once lines.
- **Fix:** Extract `attachX(socket)` helpers + a single `socketRequest(event,payload,responseEvent)`; split the effect by concern.

#### CQ-O38 — `createServer`/`createLuckyStackServer` (~225 lines) bootstrap god-function + lost graceful shutdown
- **Severity:** Medium · **STATUS: OPEN (Q38) + NEW (SERVER-02 shutdown regression)** · **wave-1 1/6 (Q38) · wave-2 2/3** · area: server
- **Location:** `createServer.ts:51-276`; returns only `{httpServer,ioServer,listen}` (`:205`) — no `stop()`, prod SIGINT/SIGTERM only inside dev `initDevTools` (`:70-71`); `grep flushErrorTrackers` = 0
- **Why:** Runtime-map register, bootstrap verify, port/ip resolve, dynamic devkit import, HTTP-server create, nested retry, shutdown closure, signal wiring in one fn — AND this week's refactor dropped graceful shutdown: no prod drain, `flushErrorTrackers()` never called (buffered telemetry dropped every redeploy), no persistent `httpServer.on('error')`.
- **Fix:** Extract `resolveListenConfig`/`createListen`/`createStop`/`wireSignals`; add `stop()` (await `ioServer.close()` + Redis `.quit()` + `httpServer.close()` + `await flushErrorTrackers()`), persistent `httpServer.on('error')`, prod signals → `stop()`.

#### CQ-O39 — `supervisor` (~327 lines) config + module-mutable `let`s + magic shutdown grace + no prod signals
- **Severity:** Medium · **STATUS: OPEN** · **wave-1 2/6 (Q39) · wave-2 2/3** · area: devkit
- **Location:** `supervisor.ts` (config `:48-93`, force-exit `:202` `1500ms`, prod branch `:210-211`)
- **Why:** Mixes pure config resolution with long-lived imperative process-state; crash-loop policy inline + untested; force-exit grace hard-coded; prod branch has no signal handlers + never restarts a clean-exit child. (The 30s blocking `spawnSync` + missing `'error'` listener were FIXED.)
- **Fix:** Extract `resolveSupervisorConfig()` + a `SupervisorRuntime` with named `handleChildExit`/`decideRestart`; `envInt('LUCKYSTACK_SUPERVISOR_SHUTDOWN_GRACE_MS', 1500)`; refuse `NODE_ENV=production` or register the handlers.

#### CQ-O40 — `main()` create-app god-function (~220 lines) + inline lookup tables + no partial-scaffold cleanup
- **Severity:** Medium · **STATUS: OPEN + NEW** · **wave-1 4/6 (Q40) · wave-2 3/3** · area: scaffolder
- **Location:** `create-luckystack-app/src/index.ts:1398-1618` (inline tables `~1452/1458/1472`); catch `:1635-1638` (no `rmSync`); framework-docs copy `:1543` substitutes `{{…}}` tokens INSIDE the docs that document them. (`pruneOptionalPackages` ~220-line sibling god-fn w/ verbatim-source literal tokens, `:1177-1396`.)
- **Why:** Arg dispatch, slug validation, three inline provider tables rebuilt per call, copyTree, deps, prune, docs copy, install, report. NEW: a prune/copy throw leaves a half-written dir the `existsSync` guard then refuses (`:1430`); the docs-copy corrupts `AI_QUICK_INDEX.md`/`ARCHITECTURE_EXTENSION_POINTS.md`.
- **Fix:** Hoist the tables to module scope; extract `validateAndResolveTarget`/`buildTemplateVars`/`copyFrameworkDocs`/`runPostInstall`; `rmSync(targetDir)` in catch only if freshly created; copy framework docs WITHOUT substitution. Split `prunePresence`/`pruneAuth`/`pruneI18n` with marker-comment anchors.

#### CQ-O41 — `checkI18n` decomposed (FIXED) but `isTranslationKey` regex rejects `_`/`-` in the first segment
- **Severity:** Medium · **STATUS: OPEN (Q41 god-fn FIXED; regex NEW)** · **wave-1 2/6 (Q41) · wave-2 1/3** · area: cli
- **Location:** `checkI18n.ts:19` (first segment forbids `_`/`-`)
- **Why:** `checkI18n` IS decomposed (+ 8 tests — FIXED). Residual: `flattenKeys` accepts any JSON key, so `my_group.title`/`email-change.btn` refs are filtered out of the used-set → reported unused → an LLM deletes a live key.
- **Fix:** Allow `_`/`-` in segment 1: `/^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+$/`; add a fixture test.

#### CQ-N5 — Generator/script AI-context emitters that emit WRONG or lossy data an AI trusts
- **Severity:** Medium · **STATUS: NEW/OPEN (Q43–Q47/Q50 cluster, carried + re-verified)** · **wave-1 1–2/6 · wave-2 (scripts not re-scanned every wave)** · area: scripts / misc
- **Members:** `extractAuthShape.additionalCount` counts `{` not predicates → under-reports a security column (Q44); `parseFunctionsInterface` indentation heuristic emits WRONG `functions.*` callable paths (Q45); `functions.<x>.default` typed but stripped by the loader (Q46 — **FIXED** in root-server: `functions/redis.ts`/`sentry.ts` now export only named); `extractIntent`/`extractFileSummary` truncate/disagree → indexes diverge (Q47); `generateProductOverview` leaves stale shard files (Q50).
- **Why:** The indexes are a contract an AI trusts; a wrong callable path is worse than a gap (the AI writes a call that fails at runtime).
- **Fix:** Parse the generated interface with the `typescript` package; count comma-separated top-level entries; greedily consume `//?` continuation lines; `fs.rm(SHARD_DIR)` before writing shards.

### Low-Medium

#### CQ-O53 — `defaultRateLimitStrategy` four near-parallel impls + undocumented off-by-one (initializeSentry FIXED)
- **Severity:** Low-Medium · **STATUS: OPEN (Q53 FIXED; Q54 OPEN)** · **wave-1 4/6 (Q53) / 1/6 (Q54) · wave-2 1/3** · area: error-tracking / core
- **Location:** `initializeSentry` decomposed + 5 tests (**FIXED**); `core/rateLimiter.ts` four memory/redis × check/status impls with an intentional `<= limit` vs `< limit` off-by-one undocumented at the sites
- **Fix:** Document the off-by-one at each site; collapse the four into two (memory/redis) with a `mode` param.

#### CQ-O55 — `customTests.ts` (~510 lines) bundling six responsibilities
- **Severity:** Low-Medium · **STATUS: OPEN** · **wave-1 1/6 (Q55) · wave-2 1/3** · area: test-runner
- **Location:** `customTests.ts` (whole)
- **Why:** Discovery walker + deep-equal + assertion library + session login/logout helpers + `callApi`/`callSync` builders + run loop in one module — the assertion kit and walker are independently reusable. (NEW related: per-case loop has no guaranteed session logout → minted Redis sessions leak.)
- **Fix:** Split out the assertion kit + walker; add best-effort `deleteSession(state.token)` to the guaranteed per-case path.

### Low

#### CQ-O60 — Package-internal near-duplicate blocks begging for a shared helper
- **Severity:** Low · **STATUS: OPEN (several members FIXED)** · **wave-1 4/6 (Q60) · wave-2 2–3/3** · area: cross-cutting
- **Members:** presence `informRoomPeers`↔`informRoomPeersLeft` + `tokenFingerprint` (**both FIXED**); test-runner AbortController+fetch+json block ×5 (OPEN — not byte-identical); login single-use-token `MULTI get+del` ×3 (OPEN — extract a core `oneTimeToken` primitive); router `502+safeDestroy` (**FIXED** via `fail502`); devkit duplicate `normalizeImportPath` (extractors.ts ↔ tsProgram.ts, OPEN — overlaps CQ-O2/srcDir); email `missing-from` guard per adapter (intentional).
- **Fix:** Extract one shared helper per remaining cluster; each removes a drift seam.

#### CQ-O61 — Comment-vs-code drift (AI-poisoning)
- **Severity:** Low · **STATUS: OPEN (several members FIXED)** · **wave-1 4/6 (Q61) · wave-2 various** · area: cross-cutting
- **Members (current tree):** root-src `sentry.ts` mask comment now matches code (**FIXED**); `serveFile.ts:67` stale "we filter via zod" (OPEN); router `http-proxy.md:49` actively teaches the REMOVED insecure `x-forwarded-proto` behavior (OPEN); secret-manager `CLAUDE.md` Function Index omits exports + ~9 config keys (OPEN); presence `registerRoomNameFormatter` docstring claims a wiring that doesn't exist + `peer-notifier.md:180,183` stale (OPEN); error-tracking `CLAUDE.md` claims `postLogin`+`postLogout` auto-wire but only `postLogout` is (OPEN); devkit `streamEmitters.ts` "Cleared on receiver-room teardown" false; scaffolder `CLAUDE.md` lists 5 dead template vars + `editScaffoldFile` doc promises a throw it no-ops; test-runner `runRegisteredLayers.ts:8-10` docstring contradicts `extension-hooks.md`; `deploy.config.ts:14` "enforced by presetLoader" but validation runs only at codegen.
- **Why:** Comments contradicting code mislead an AI worse than no comment — several encode a guarantee (zod filter, masked replay, formatter wiring) the code doesn't deliver.
- **Fix:** Fix or delete each stale comment; treat comment drift as a first-class quality defect.

#### CQ-O62 — Misnamed/dead `socketLeaveRoom` + other dead/misleading surfaces
- **Severity:** Low · **STATUS: OPEN (doc-hazard mitigated)** · **wave-1 6/6 (Q62) · wave-2 2/3** · area: presence / core / cross-cutting
- **Members:** `socketLeaveRoom` (`leaveRoom.ts:18-36`) never calls `socket.leave()`, dead `socket`/`newPath` params — now carries a `//? NOTE` + corrected CLAUDE.md (hazard mitigated; rename DEFERRED as a cross-package contract); `SpanResult<T>=T` no-op alias re-exported through both barrels; `getDisconnectTime` `'NULL'` sentinel (**FIXED**); `ON_TINT_TEXT` 3-identical-entry map (**FIXED**); `src/_api/logout_v1.ts` no-op shim; `presetLoader.ts` dual BC aliases; devkit dead `stripComments` export (**FIXED**).
- **Fix:** Rename/remove the misleading params + aliases (report-only per Rule 27); document load-bearing sentinels; add a `//?` pointer on `logout_v1.ts`.

#### CQ-O71 — `socketState`/translator hot-path hygiene (busy-poll, per-call RegExp, unescaped param key)
- **Severity:** Low · **STATUS: OPEN** · **wave-1 4/6 (Q71) · wave-2 2/3** · area: core
- **Location:** `socketState.ts:18-25` (`responseIndex` unbounded global), `:27-37` (`waitForSocket` 10ms×500 busy-poll); `react/TranslationProvider.tsx:38-46` (250ms language poll), `:92-97` (`translate()` builds a RegExp per param from the unescaped key — latent ReDoS / mis-substitution)
- **Fix:** Resolve `waitForSocket` via a one-shot promise fired by `setSocket`; subscription-notify language instead of polling; escape `param.key` or `split().join()`; scope the monotonic counter.

#### CQ-O72 — `as RequestOutput`/boundary casts erase generated output type at the implementation seam
- **Severity:** Low · **STATUS: OPEN (documented boundary)** · **wave-1 4/6 (Q72) · wave-2 1–4/3** · area: core / error-tracking
- **Location:** `apiRequest.ts:251,264,310,…`; `error-tracking/sentry.ts` `wireSharedSentryDI` (`as Parameters<typeof Sentry.x>[n]`)
- **Why:** Documented internal boundary casts (the `ApiTypeMap`-collapses-to-`never` issue; the deliberate no-`@sentry/node`-build-dep decision) but exactly the `as`-cast pattern the invariants linter flags; unchecked if the signature changes. No `as any`/`as unknown as T` found.
- **Fix:** Keep as a single documented boundary + add `// luckystack-allow <rule>: <reason>`; consider a typed envelope helper / tighter shared-DI interface.

#### CQ-O73 — Hand-mirrored type/schema contracts with no compile-time link to their generator
- **Severity:** Low · **STATUS: OPEN** · **wave-1 3/6 (Q73) · wave-2 2/3** · area: test-runner / mcp / error-tracking
- **Location:** test-runner `ApiMetaEntry` mirror (`types.ts:16-22`); mcp `GraphSchema` (`artifacts.ts:53-63`) vs `generateGraph.mjs`; error-tracking `index.ts` re-export list vs `adapter.ts:8-25`
- **Why:** Each is a hand-maintained mirror with no `export * from`/`satisfies` link — a generator field rename (`auth.login`) drifts silently with no compile error.
- **Fix:** Add a structural-conformance test (`satisfies` an imported sample); `export * from './adapter'`; assert the graph loader against `GraphSchema`.

#### CQ-O74 — Build-artifact / packaging hygiene (prod source-maps FIXED, `engines.bun`, dup WAVES, stale `ls-np/`, `@latest` pins)
- **Severity:** Low · **STATUS: OPEN (mcp shebang FALSE-POSITIVE)** · **wave-1 2/6 (Q74) · wave-2 1–2/3** · area: mcp / scripts / scaffolder
- **Location:** `bundleServer.mjs` source-maps opt-in (FIXED); root `engines.bun` advisory (OPEN); `buildPackages.mjs` ↔ `publishPackages.mjs` duplicated WAVES (OPEN); `create-luckystack-app/ls-np/` 115-file stale committed scaffold artifact w/ dropped overlay files (NEW); MCP `@latest` pins incl. first-party `@luckystack/mcp@latest` (OPEN).
- **Fix:** Drop the `bun` engine key; extract a shared `packageWaves.mjs`; delete `ls-np/` + gitignore; pin `@luckystack/mcp@^${version}`.

#### CQ-O-low-tail — Long tail of verified Low quality items (one line each)
- **STATUS: OPEN** · area: various
  - **backpressure fail-OPEN on engine.io rename** (`api/_shared/backpressure.ts:29-31`, `sync/streamEmitters.ts`) — `(socket as unknown as {conn})` `?? true` → `flushPressure` silently no-ops; add a one-shot dev warn + version-pinned comment. wave-1 4/6 (Q58).
  - **`healthRoutes` `prisma as unknown as PrismaPingShape`** (`server/httpRoutes/healthRoutes.ts:19-47`) — Rule-21 pattern in a core route; silent permanent 503 on a Prisma rename; typed `pingDatabase()` accessor or `// luckystack-allow`. wave-1 4/6 (Q59).
  - **`chunkCounters` module-level Map grows unbounded** (`sync/streamEmitters.ts:12-19`) — never `.delete()`/`.clear()`; move into the per-request closure. wave-2 2/3.
  - **`confirmEmailChange_v1` untyped `Record<string,unknown>` patch** (asset+template) — use `Partial<UserRecord>`. wave-2 3/3.
  - **Consumer shims import `../../packages/*/src` source paths** (`server/auth/login.ts:1`, `extractToken*.ts`, `server/hooks/*`) — standardize on published `@luckystack/*` names + breadcrumb header. wave-2 3/3.
  - **Zod schemas omit `.strict()` / degrade to `z.any()`** (`zodEmitter.ts:155,165-167`) — coverage hole (test-runner fuzz), not a runtime bypass; DEFERRED output-shape change. wave-1 3/6 (Q79).
  - **`walkEndpoints` `method as HttpMethod` cast** over a runtime artifact — validate against the `HttpMethod` set, `skipped` for the rest. wave-1 4/6.
  - **`as never` cast on parsed JSON in Layer-5 builders** (`customTests.ts:332,361`) — contained; WONT-FIX-leaning.
  - **mcp grep-truncate-at-60 / basename-collision / unguarded `JSON.parse(graph)`** (`artifacts.ts:70,80-82,105-108`) — return `{lines,total}` + truncated flag; distinguish ambiguous from not-found; wrap the graph parse in try/catch. wave-2 1–3/3.
  - **`runtimeTypeValidation` quote-blind `splitTopLevel` / Date-accepts-any-string / non-identifier quoted-key drop / single-member union skip** (N1–N4, O11) — quote-aware splitter, `Date.parse` check, broaden quoted-key capture, recurse single-member. wave-2 1–2/3.
  - **`O(n²)`/redundant compute in scan helpers** (cli `lib/scan.ts:123` **FIXED**; `generateProjectIndex.recordCallers`, `importDependencyGraph.findDependentRouteFiles` OPEN) — pre-index callers; incremental reverse-dep map. wave-1 2/6 (Q78).
  - **`tryCatch` auto-captures every caught error (no benign opt-out)** (`core/tryCatch.ts:11-14`) — add `{capture?:false}` / benign classifier. wave-1 1/6 (Q76).
  - **sync FS on async paths** (`responseNormalizer.ts:42` `readFileSync` in async loop; `serveFile.ts:129` full-buffer read) — `fs.promises.readFile` / stream large assets. wave-1 1/6 (Q77).

### Info

#### CQ-O80 — Per-request `getProjectConfig()`/regex-compile + busy-poll magic numbers
- **Severity:** Info-Low · **STATUS: OPEN** · **wave-1 2/6 (Q80) · wave-2 confirms** · area: api / core
- **Location:** `handleApiRequest.ts`/`handleHttpApiRequest.ts` (10+ `getProjectConfig()` per request — two reads can diverge across hot-reload); `cookies.getCookieValue` fresh-RegExp per lookup (ReDoS half FIXED via `escapeRegExp`); `waitForSocket` 5s busy-poll ceiling.
- **Fix:** Snapshot `const config = getProjectConfig()` once per request; plain string-scan for cookies; name the magic ceilings.

---

## DEFERRED-DECISION (real, fix is a policy / contract / ADR / feature call)

| ID | Finding | Sev | Wave1 · Wave2 | Location | Decision needed |
|---|---|---|---|---|---|
| CQ-D1 | Sync receiver-auth defaults fail-OPEN (`allowClientReceiverAll:true`, `requireRoomMembership:false`) — defaults in core, enforcement (now fail-closed) in sync | med | 6/6 · 3/3 | `core/projectConfig.ts:773-774`; `sync/_shared/receiverAuth.ts` | Flip the 0.2.0 secure defaults vs boot-warn + commented scaffold config (cross-package ADR) |
| CQ-D2 | Generated Zod object schemas omit `.strict()` / `z.any()` fallback | low | 3/6 · 3/3 | `zodEmitter.ts:155,165-167` | Output-shape change flips test-runner fuzz pass/fail — strict-by-default policy call |
| CQ-D3 | `getSourceFile`/Program miss emits silent empty `{ }` DEFAULT type (loud-marker vs silent) | med | 2/6 · 1/3 | `devkit extractors.ts` defaults | Marker-contract decision (`__RUNTIME_UNRESOLVED__` sentinel vs `console.warn`-only) |
| CQ-D4 | Strict-codegen gate / `apiTypeDiagnostics.generated.json` (would catch the non-`src` srcDir drop) | feature | — · 3/3 | n/a | High-value framework feature multiple runs converged on |
| CQ-D5 | `env.ts` eager `export const env = bootstrapEnv()` at import vs lazy `getEnv()` | low | 3/6 · — | `core/env.ts:108` | Public-API/contract change for every `import { env }` consumer |
| CQ-D6 | `rateLimiting.auth` lockout config slot unread by core limiter (shadow-config) | low | — · 1/3 | `core/projectConfig.ts:673-677` | Confirm `@luckystack/login` consumes it + document core no-op, or boot-warn |
| CQ-D7 | Secret-manager `SecretManagerBootConfig` exposes only `{url,token,dev}` (shadow-API wiring — member of CQ-N2) | med | — · 1/3 | `server/bootstrap/initSecrets.ts:18-25` | Widen the boot config pass-through vs mark the rest advanced-direct-call-only |
| CQ-D8 | `resolveSender` silent fall-through on an explicitly-requested-but-unregistered email adapter | med | 5/6 · 2/3 | `email/sendEmail.ts:64-76` | Explicit-`adapter` (fail/warn) vs best-effort `adapterHint` (silent) policy |
| CQ-D9 | Unsalted recipient hash in email correlation id | low | 1/6 · 2/3 | `email/sendEmail.ts:24-25` | HMAC needs a secret source + key-rotation/cross-report decision |
| CQ-D10 | Email CRLF sanitization / send-timeout / ConsoleSender token redaction / CTA-URL+accent validation (features vs the simplified tree) | low-med | wontfix(phantom) · — | `email/src/**` | Whether to ADD the hardening (the gap is real; phantom wave-1 code is gone) |
| CQ-D11 | `requestEmailChange` `auth.emailTaken` authenticated-enumeration oracle | low | 4/6 · 3/3 | `src/settings/_api/requestEmailChange_v1.ts:42-48` | In-code-acknowledged tradeoff, no ADR — match reset flow vs write a decision file |
| CQ-D12 | `ASSET_AHEAD_OF_TEMPLATE` parity exemption license (member of CQ-N3) | med | 4/6 · 3/3 | `assetParity.test.ts:33-36` | Single-source the asset/template vs keep the escape hatch |
| CQ-D13 | mcp graph staleness/freshness signal (no `generatedAt`) | low(feat) | 3/6 · 2/3 | `generateGraph.mjs`; `mcp artifacts.ts` | New `graph_status` tool / mtime-compare suffix |
| CQ-D14 | test-runner exit-code strictness: `xpassed`/all-`skipped` don't move totals (reporting half FIXED) | low | 1/6 · 2/3 | `runAllTests.ts:162-173` | `strict` mode that flips currently-green runs red |
| CQ-D15 | router edge body-cap capability REMOVED + no edge deny-gate | med | new · 1–3/3 | `httpProxy.ts:191`; `wsProxy.ts` | Re-introduce edge cap / `proxyRequestGate` vs document delegation to backend |

---

## FIXED (verified resolved in the current tree — compact, no action)

| ID | What was fixed (quality facet) | Area | Evidence |
|---|---|---|---|
| CQ-F1 | `validateType`/`validateInputByType` fail-OPEN → fail-CLOSED (terminal+unresolved error, depth-cap 64, `safeValidateType`, proto-keys rejected, Record-value validated) | core | `runtimeTypeValidation.ts:184,262-296,355-373,381-387` |
| CQ-F2 | `apiRequest` offline-queue `onDrop` hang → wired with `suppressOnDrop` window | core | `apiRequest.ts:439-446` |
| CQ-F3 | `responseIndex` brittle double-negative → `typeof !== 'number'` + parity test drives `0` | api | `handleApiRequest.ts:58`; `transportParity.test.ts:188` |
| CQ-F4 | Socket array-payload accepted as object → `validateApiMessage` rejects `Array.isArray` | api | `handleApiRequest.ts:69` |
| CQ-F5 | Socket api handler had ZERO unit tests → `transportParity.test.ts` (16 green) | api | `transportParity.test.ts` |
| CQ-F6 | HTTP `requireRoomMembership` bypass (`isMember:null`) → fail-CLOSED both transports | sync | `handleHttpSyncRequest.ts:374`; `_shared/receiverAuth.ts:64` |
| CQ-F7 | Client-only sync routes skipped auth+validation → both reject `!_server` | sync | `handleSyncRequest.ts:377-383`; `handleHttpSyncRequest.ts:304-309` |
| CQ-F8 | `resolveSyncValidationMode` fail-open typo + array/non-object guard + raw-vs-normalized `'all'` | sync | `_shared/validationMode.ts:27`; `handleSyncRequest.ts:274`; `handleHttpSyncRequest.ts:617` |
| CQ-F9 | Router WS listener-less crash + SSRF/host-pin + XFF/XFP spoof + non-101 leak + subscriber FD leak; CLI NaN + SIGINT double-shutdown; body-cap race removed | router | `wsProxy.ts:59-73`; `proxyUtils.ts:64-131`; `cli.ts:41-49,174-181` |
| CQ-F10 | Server auth throttle trustProxy + IP-resolution → `resolveRequesterIp.ts`; `sanitizeForLog` recursion; `withSessionLock` rejection; HEAD-CSRF parity; requestId-at-top; `/server.js`+`*.map` denylist | server | `authApiRoute.ts:95-99`; `resolveRequesterIp.ts`; `staticRoutes.ts:14` |
| CQ-F11 | ET-02 per-request identity ALS bound in prod (the 6/6 flagship) + Datadog reads ALS; `SentryClientConfig` warns; `initializeSentry` decomposed | error-tracking | `handle*Request.ts` scope-open; `datadog.ts:105-106`; `sentry.ts` |
| CQ-F12 | Presence high cluster: unguarded grace-timer/connect/intentional-disconnect async, `clientSwitchedTab` leak, sampler false-negative, silent swallow, magic sentinels, dup peer-loops, `tokenFingerprint` | presence | `lifecycle.ts`/`activitySampler.ts`/`peerNotifier.ts` |
| CQ-F13 | login OAuth nonce constant-time, avatar `encodeURIComponent`, google v3 userinfo, `asOAuthUserData` barrel-export, ActiveSession token→handle, `emailChange` tryCatchSync | login/cli | `login.ts:213`; `oauthProviders.ts`; `index.ts:95` |
| CQ-F14 | CLI core: npm hijack, JSON.parse guarded, install ordering, O(n²) scan, multiline env, `--ci` divergence, `checkI18n` decomposed | cli | `lib/project.ts`/`lib/scan.ts`/`checkEnv.ts`/`checkI18n.ts` |
| CQ-F15 | devkit: root-sync route-key `'root'`→`'system'`, supervisor missing-`'error'`-listener + 30s blocking spawnSync, `validateGeneratedTypeIdentifiers` re-throw, `splitTopLevel` quote-aware, DELETE-twin `$`-splice, comment-only `change` overwrite, `calculateRelativePath` srcDir-anchored, dead `stripComments` removed | devkit | `loader.ts:30`; `supervisor.ts:103-118`; `templateInjector.ts` |
| CQ-F16 | mcp: prototype-chain keys (`Object.hasOwn`), numeric-id substring, normalized fallback, `find_route` row-guard, empty-query dump, version-from-package.json, `as object` casts removed, path-containment guard | mcp | `artifacts.ts`/`index.ts` |
| CQ-F17 | docs-ui try-it-out hardcoded-POST → threads `httpMethod`; `auth.additional` null-element guard; JSON charset | docs-ui | `docsHtml.ts:204-225,258-260`; `index.ts:126` |
| CQ-F18 | secret-manager rewrite closed the whole 6-run Medium/Low cohort (envNames scoping, TOCTOU serialize, body size cap, hook isolation, `sleep`/`tryCatch` from core, `getCachedResolutionMeta`) — 52/52 tests green | secret-manager | `index.ts` |
| CQ-F19 | email `sendEmail` god-fn decomposed, `toProviderPayload` shared, ResendSender floating-`.catch`, password-reset doc reconciled | email | `sendEmail.ts:177-218`; `providerPayload.ts` |
| CQ-F20 | test-runner: `runAllTests` decomposed, `schemaSampleInput` Zod-walker node coverage, Layer-5 parse-tryCatch+timeout, `requiresLogin` optional-chain, symlink-loop guard, stream-watcher leak, `resetServerState` timeout | test-runner | `runAllTests.ts`/`schemaSampleInput.ts`/`customTests.ts` |
| CQ-F21 | root-src: Sentry masking ON + beforeSend strip, `?token=` query removed, ErrorPage DEV-gate, `common.404` typo, `updateSession` raw-parse + avatar double-`?v=`, playground unauth stream + arbitrary email, `MiddlewareResult|undefined` | root-src | `sentry.ts:62-89`; `page.tsx:13-26`; `ErrorPage.tsx:37` |
| CQ-F22 | root-server: `functions.{redis,sentry}.default` dead exports removed; `generatedApis.*` excluded from tooling; OAuth nonce timing-safe | root-server | `functions/redis.ts`; `.gitignore:48-49` |

---

## FALSE-POSITIVE (refuted against current source — one line each)

| ID | Claim | Area | Why bogus |
|---|---|---|---|
| CQ-FP1 | "`validateType` still fails OPEN" | core/api | Stale pre-`7576c88` read; terminal+unresolved branches fail CLOSED now (CQ-F1) |
| CQ-FP2 | Socket method-gate gap = HIGH transport-asymmetry vuln | core/api | Method is a CSRF-exemption HTTP-semantics control, not an authz boundary; socket origin-gated + per-message auth |
| CQ-FP3 | `getCookieValue` raw-value-on-bad-encoding = bug | core | Deliberate documented lenient fallback; the ReDoS half is genuinely FIXED |
| CQ-FP4 | redis stray-prefix net = tenant-isolation bug | core | Documented best-effort net; `formatKey()` is the authoritative safe path |
| CQ-FP5 | `serveAvatar` format-loop existence oracle + stream crash | core | Hook-vetoed and missing return identical 404; the crash is FIXED via `stream.pipeline` |
| CQ-FP6 | `acquireLease` null-ambiguity | core | Documented contract, safe under partition |
| CQ-FP7 | router `proxyRequestGate` deny-gate never applied to WS / fails-open-on-throw | router | The gate the baseline assumed NEVER existed (grep=0); real gap tracked as CQ-D15 |
| CQ-FP8 | server `registerErrorFormatter` is a dead shadow API | server | Relocated to core; `applyErrorFormatter` IS called in api/sync handlers (scan grepped only the server pkg) |
| CQ-FP9 | login "unified links unverified OAuth email" / "ActiveSession token-vs-handle breaks build" | login | Both verified FIXED in current tree (fail-closed guard; consistent `handle`) |
| CQ-FP10 | Template `updateUser_v1` "persist arbitrary theme/language" | cli/scaffolder | `language`/`theme` are Prisma DB enums → out-of-enum throws before write; residual is consistency only (CQ-N3) |
| CQ-FP11 | email phantom-code findings (`sanitizeHeaderMap`/`withSendTimeout`/`redactUrlSecrets`/`safeColor`/`safeCtaUrl`/render-error-log/per-send env re-read) | email | The cited helpers NEVER existed (`git log -S` empty); wave-1 audited a hallucinated file — genuine residuals re-characterized OPEN |
| CQ-FP12 | devkit `validateDeploy` ANSI codes "missing ESC byte" | devkit | `od -c` shows the 0x1b ESC present before every sequence; the Read tool just doesn't render it |
| CQ-FP13 | devkit `validateType` "fails OPEN at the resolver boundary" | devkit | DK-06 verified RESOLVED — resolver emits `__RUNTIME_UNRESOLVED__::`, core maps it to a validation error (fail-CLOSED) |
| CQ-FP14 | mcp "shebang on a pure library entry" / "`createLuckystackMcpServer` ~200-line factory" | mcp | Single emitted file is bin = lib by design; no such factory exists (flat top-level registration) |
| CQ-FP15 | docs-ui CSP `nonce` mismatch / `ensureCsrfToken` race / `enabledInProd` boot-warning / `pageSet` overcount | docs-ui | All cited constructs no longer exist in current code (grep=0) — rewrite dropped them |
| CQ-FP16 | root-src/root-server Sentry replay PII leak; `signOutEverywhere` logs caller out; apiRequest offline hang attributed to root-src | root-src/root-server | Sentry masks text+media; asset passes `exceptToken`; the queue is a pure re-export shim (bug lives in core, FIXED CQ-F2) |

---

## Cross-cutting remediation priority (synthesized)

1. **Ship-block fix CQ-N1** (docs-ui renderer shape mismatch) — the package's sole function is broken against every real artifact and a wrong-shaped test hides it; the only CRITICAL.
2. **Collapse the hand-synced twins (CQ-O1)** into shared `_shared/` pipelines + adapters and add an `ai:lint` behavioral-parity + transport-parity conformance test. Every run names this the single highest-leverage change; it kills the confirmed drift-bug class (incl. SRV-01).
3. **Wire-or-delete the shadow-API class (CQ-N2)** and add the `ai:lint` invariant: every hook/config/export named in a package `CLAUDE.md` must be live, and no symbol may be exported with only `*.test.ts` importers.
4. **Reconcile the asset/template/`src/` triplet (CQ-N3)** to one canonical implementation + a blocking `ai:check-template-drift` CI gate; drop the `ASSET_AHEAD_OF_TEMPLATE` exemption.
5. **Fix the generator under-modeling (CQ-O8, CQ-O32 srcDir)** so consumers stop hand-widening (`status:'error'` union) and a non-`src` layout doesn't silently zero out codegen.
6. **Wrap every detached async boundary in `tryCatch`/`.catch` (CQ-O18)** + a global `unhandledRejection` backstop, and narrow the blanket `eslint-disable`s (CQ-O16) so the linter guards the complex files.
7. **De-template-literal / de-source-string the untested mutators (CQ-O15, CQ-O34)** with AST modules + marker anchors; add a parity gate for all KEEP-IN-SYNC / template-script twins (CQ-O25).
8. **Decompose the remaining god-functions** (CQ-O9/O13/O22/O23/O36/O37/O38/O39/O40) — framework code (Rule 7a) earns SOLID extraction; each is the structural source of a confirmed bug surface.

## God-function / refactor-candidate roll-up (current line counts)

| Function / module | ~Lines | Area | Finding | Note |
|---|---|---|---|---|
| `login.ts` (module) | ~1077 | login | CQ-O9 | GREW since wave-1 despite extractions |
| `setupWatchers` | ~510 | devkit | CQ-O22 | dev-only |
| `Home` settings page | ~530 (×3 copies) | root-src/cli | CQ-O36 | hid the delete bug |
| `customTests.ts` | ~510 | test-runner | CQ-O55 | |
| `handleSyncRequest` | ~700 | sync | CQ-O1 | leaf helpers extracted, orchestration inline |
| `handleHttpSyncRequest` | ~540 | sync | CQ-O1 | near-line-for-line twin |
| `loadSocket` | ~430 | server | CQ-O13 | |
| `templateInjector.ts` (module) | ~840 | devkit | CQ-O15 | AST migration half-done |
| `runHandleHttpApiRequestInner` | ~345 | api | CQ-O1 | socket side decomposed, HTTP not |
| `apiRequest` | ~340-350 | core | CQ-O1 | FALSE-POSITIVE as a "god-fn defect"; refactor only |
| `supervisor` | ~327 | devkit | CQ-O39 | |
| `buildTypeMapArtifacts` | ~300 | devkit | CQ-O21 | grouped-emit ×4 |
| `createServer` | ~225 | server | CQ-O38 | + lost graceful shutdown |
| `main()` (create-app) | ~220 | scaffolder | CQ-O40 | |
| `pruneOptionalPackages` | ~220 | scaffolder | CQ-O40 | verbatim-source literal tokens |
| `saveSession` | ~213 | login | CQ-O23 | |
| `useSocket` effect | ~190 | root-src | CQ-O37 | |
| `handleAuthApiRoute` | ~190 | server | CQ-O29 | two endpoints |
| `expandTypeDetailed` | ~175 | devkit | CQ-O32 | highest-risk codegen fn |
| `handleApiRequest` (socket) | ~160 | api | CQ-O14 | improved |
| `startRouter` / `httpProxy.handleRequest` | ~130 / ~167 | router | CQ-O20 | reduced |
| `loginCallback` | ~138 | login | CQ-O9 | |
| `dispatchHttpRequest` | ~100 | server | CQ-O31 | security path |
| `getParams` | ~82 | core | CQ-O30 | |
| `render()` (docs inline program) | ~78 | docs-ui | CQ-O34 | untested template literal |

(secret-manager + mcp independently re-confirmed to contain NO god-functions — their largest units are cohesive; `createServer`'s `stop()` was removed entirely, see CQ-O38.)
