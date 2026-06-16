# core — Verified & Merged Audit Findings
Sources: reports/core-arch.md, reports/core-runtime.md + review/v0.2.0/* · Verified against current working tree (branch chore/package-split-prep, 2026-06-11).

## Verdict summary
Of the ~30 merged findings for `@luckystack/core`, the overwhelming majority are **CONFIRMED still present** in the current working tree — commit 302cbf1 ("login/wizard/cli flow") and the uncommitted edits did **not** touch any of the core security/quality issues the two scans raised. Nothing in this area was found to be ALREADY-FIXED, and only one minor claim is REFUTED (the arch claim that the `apiRequest` external-abort path "leaks a `.once` listener" is only partially true — the external-signal listener IS now cleaned up; the response `.once` listener self-removal caveat remains). The biggest live issue is **H-1 / SEC-02**: `validateInputByType` returns `{ status: 'success' }` unconditionally in production (`runtimeTypeValidation.ts:305-307`), so the only structural input-type gate is a no-op in prod — both scans agree, the reports/ scan adversarially re-confirmed it, and the docs still claim a Zod fallback that does not exist in the request path. The other live high-impact items are the documented-but-insecure defaults (`trustProxy:false`, rate-limiter fail-open to per-instance memory) and the `apiRequest` god-function cluster (per-route abort singleton keyed only by route name, reject-vs-resolve inconsistency, no response timeout). Doc drift in `packages/core/CLAUDE.md` (wrong `validateRequest` contract, unindexed `/client` + `/eslint` surfaces, stale peer versions) is all still present.

## Findings

### CORE-01 — Runtime input validation is a no-op in production · severity: high · status: CONFIRMED
- **Sources:** both (reports/core-arch Medium#1, reports/core-runtime H-1 [adversarially CONFIRMED] + review SEC-02)
- **Current location:** `packages/core/src/runtimeTypeValidation.ts:305-307`
- **Original claim:** `validateInputByType` short-circuits to success when `NODE_ENV==='production'` before any structural check; it is the only validator wired into the API/sync pipelines, and docs claim a prod Zod fallback that doesn't exist.
- **Verification (current code):** Lines 303-307 unchanged: `if (process.env.NODE_ENV === 'production') { return { status: 'success' }; }`, placed before the `validateType()` walk and the devkit resolver (lines 318-325). The devkit module is dynamically imported and external in the prod bundle. No Zod/`apiInputSchemas` lookup exists in this file or the request path.
- **Verdict & why:** CONFIRMED. The reports/ scan's adversarial pass already re-confirmed this against the live pipeline (sole validator in `httpValidationStage`/`socketValidationStage`); current code matches. Severity high is correct (test/prod divergence + downstream Prisma/Mongo operator-injection exposure for any handler that trusts `data` shape). The review/ scan's "high" beats core-arch's "medium" here — review was right.
- **Recommendation:** Wire the pre-generated Zod schemas into the prod path (`schema.safeParse`, success when no schema), OR make the skip a loud, explicitly-documented opt-out and state in every API doc that prod input validation is the handler's responsibility. Correct the false "prod uses pre-generated Zod" claim in `devkit/docs/runtime-type-resolver.md` and add the caveat to `ARCHITECTURE_API.md`.

### CORE-02 — `apiRequest` per-route abort singleton aborts unrelated concurrent calls · severity: high · status: CONFIRMED
- **Sources:** reports (core-arch Hard-blocks#1)
- **Current location:** `packages/core/src/apiRequest.ts:21` + `:320-326`
- **Original claim:** `abortControllers` is keyed only by `fullName = api/{name}/{version}`, so a second call to the same GET route (even with different `data`, from an unrelated component) aborts the first, whose promise then rejects.
- **Verification (current code):** `const abortControllers = new Map<string, AbortController>();` (line 21). With default `abortable: undefined`, GET routes get a controller (`shouldUseAbortController` lines 69-79); on a second call `abortControllers.has(fullName)` → `prevAbortController?.abort()` (321-323). `data` is not part of the key. The abort handler at 336 `reject(new Error(...))`.
- **Verdict & why:** CONFIRMED. Two widgets polling the same GET route with different params cannot coexist; the only escape is `abortable: false` (which loses dedupe). Structural default-semantics defect.
- **Recommendation:** Key the controller map per call-site (or include a caller-supplied key / hash of `data`), or scope replace-previous semantics to identical payloads only.

### CORE-03 — `apiRequest` internal abort REJECTS while every other path resolves · severity: high · status: CONFIRMED
- **Sources:** reports (core-arch Code-quality#2; core-runtime C-5 notes the god-function)
- **Current location:** `packages/core/src/apiRequest.ts:336` (reject) vs `:389-392` (external-abort resolves), plus the `.once` listener at `:431`
- **Original claim:** Internal per-route abort rejects the promise, while external-signal abort and every other failure resolve with a normalized envelope — a framework that bans raw `try/catch` ships a hot path that throws on its own default GET-replace behavior, yielding unhandled rejections for fire-and-forget callers. Also: the response `.once` listener is never removed on abort.
- **Verification (current code):** Line 336 `reject(new Error(\`Request ${fullName} aborted\`));` inside `abortHandler`. The external-abort path (382-393) calls `resolve(normalizeApiError({... 'request.aborted'}))`. So the inconsistency is real and unchanged. On the listener-leak sub-claim: the external-signal listener IS now removed (`cleanupExternalAbort`, 395-397, called in the abort/response handlers), but the `socketInstance.once(buildApiResponseEventName(tempIndex), ...)` listener (431) is only self-removed when the (now-cancelled) response actually fires — after an abort it lingers until then.
- **Verdict & why:** CONFIRMED (the reject-vs-resolve inconsistency is the load-bearing defect; the `.once` lingering listener is a lesser, partially-mitigated sub-issue). Fire-and-forget `apiRequest(...)` on a GET that gets superseded produces an unhandled rejection.
- **Recommendation:** Make the internal-abort path resolve with the same `request.aborted` envelope the external path uses; proactively `off()` the response listener inside the abort cleanup.

### CORE-04 — `trustProxy` defaults to false → per-IP rate-limit buckets collapse behind a proxy · severity: high · status: CONFIRMED
- **Sources:** reports (core-runtime M-1)
- **Current location:** `packages/core/src/projectConfig.ts:464` (`trustProxy: false`), `resolveClientIp.ts:78-97`
- **Original claim:** With the documented reverse-proxy topology, `trustProxy:false` keys every request off the proxy's address (or the `unknown` sentinel), collapsing per-IP limiting into one shared bucket (DoS or no-op).
- **Verification (current code):** `trustProxy: false` default confirmed at projectConfig.ts:464 (type at :185). `resolveClientIp` returns `rawFallback` whenever `!trustProxy` (line 83), only reading XFF/x-real-ip when `trustProxy` is true. The warn at :106 fires only when the resolved value equals `UNKNOWN_CLIENT_IP`, not on an identical-real-IP burst.
- **Verdict & why:** CONFIRMED as a documented-but-insecure default. Severity raised to high (security-impacting in the standard deployment); the spoof-safe rationale is sound but the default silently weakens abuse protection. Note the related router half (SEC-08, router area) makes this exploitable end-to-end.
- **Recommendation:** Keep the spoof-safe default but emit an actionable boot/observed-burst warning when many requests key to the same/`unknown` IP, and prominently document that `trustProxy` must be enabled behind any proxy.

### CORE-05 — Rate limiter fails OPEN to per-instance memory on Redis error · severity: high · status: CONFIRMED
- **Sources:** both (reports/core-runtime M-2 + reports/core-arch Low#2; review references via QUA-024 context)
- **Current location:** `packages/core/src/rateLimiter.ts:204-214` (check), `:188-192` (one-shot latch), `:77` (`redisFallbackLogged`)
- **Original claim:** On any Redis error the strategy degrades to the process-local in-memory store and logs once; in a multi-instance deployment the global limit silently becomes per-instance (N× cap), and the one-shot latch never resets so recurring degradation is invisible.
- **Verification (current code):** `check()` lines 204-214: `if (isRedisMode()) { const redisResult = await checkRateLimitInRedis(params); if (redisResult) return redisResult; logRedisFallback(); } return checkRateLimitInMemory(params);`. `logRedisFallback` (188-192) latches `redisFallbackLogged = true` and never resets. `checkRateLimitInRedis` returns `null` on any eval error (131-133), triggering the fallback.
- **Verdict & why:** CONFIRMED. Both reports agree; severity is effectively high in a multi-instance topology (silent N× weakening during a Redis blip). core-arch labelled it Low, core-runtime Medium — the multi-instance impact justifies treating it as the more serious of the two.
- **Recommendation:** Make the policy configurable (`rateLimiting.onStoreError: 'allow' | 'deny'`, default current behavior for BC) and re-arm the warning periodically (or on recovery) so the degraded state stays visible.

### CORE-06 — `apiRequest` / `syncRequest` have no response timeout — a lost response hangs forever · severity: medium · status: CONFIRMED
- **Sources:** both (reports/core-arch Missing-config#2 + review CFG-09 [merged core+sync])
- **Current location:** `packages/core/src/apiRequest.ts:431` (sole settle path), no `timeoutMs` anywhere
- **Original claim:** Both request promises settle only via the `socketInstance.once(...ResponseEventName)` listener (or an optional caller AbortSignal). A server restart/crash between emit and response leaves the `await` hanging indefinitely; no `api.requestTimeoutMs`/`sync.requestTimeoutMs` exists.
- **Verification (current code):** The only resolve/reject paths after emit are the `.once` response handler (431-469) and the optional external-signal bridge (381-398). Grep of `apiRequest.ts` finds no timeout/`setTimeout`-based settle. No `requestTimeoutMs` key in projectConfig.
- **Verdict & why:** CONFIRMED. UI spinners stick across deploys/restarts; the AbortSignal workaround requires every call site to hand-roll an AbortController+timer.
- **Recommendation:** Add `timeoutMs?: number` per call plus `projectConfig.api.requestTimeoutMs` / `sync.requestTimeoutMs` defaults (e.g. 30000, `false` to disable); on expiry remove listeners, clean controllers, resolve with `{ status:'error', errorCode:'api.timeout'|'sync.requestTimeout', httpStatus:504 }`.

### CORE-07 — `/_health` exposes unsalted SHA-256 of synchronized env secrets · severity: medium · status: CONFIRMED
- **Sources:** both (reports/core-runtime L-2 context + review SEC-13 [merged pkg-server/pkg-core])
- **Current location:** `packages/core/src/synchronizedEnvHashes.ts:15-17, 29-37` (hash side); server route `packages/server/src/httpRoutes/healthRoutes.ts:84` (out of this area)
- **Original claim:** `computeSynchronizedEnvHashes()` returns plain unsalted `sha256(value)` of every `synchronizedEnvKeys` env var (by design shared secrets like session-encryption keys); the unauthenticated `/_health` route returns them with no salt/gate, enabling offline dictionary attacks on low-entropy secrets + key-name disclosure.
- **Verification (current code):** `hashValue` = `createHash('sha256').update(value).digest('hex')` (15-17), no salt; `computeSynchronizedEnvHashes` maps each key to that hash (29-37). The core half (the unsalted, ungated hash function) is exactly as described.
- **Verdict & why:** CONFIRMED for the core (hash-function) half. Medium is right — high-entropy secrets aren't practically recoverable, but key-name + stable-hash disclosure is a real leak. The server-route gating belongs to the pkg-server area.
- **Recommendation:** Salt with the current `bootUuid` (so hashes aren't stable across boots) or move to HMAC with a per-handshake shared secret; add `http.healthExposeHashes` (default false) and gate behind a handshake token.

### CORE-08 — `registerHook` / `registerSyncHook` have no unsubscribe · severity: medium · status: CONFIRMED
- **Sources:** both (reports/core-arch Hooks#1 + review HOK-06)
- **Current location:** `packages/core/src/hooks/registry.ts:24-31` (registerHook), `:75-82` (registerSyncHook), `:64-67` (test-only `clearAllHooks`)
- **Original claim:** Both push into module-level Maps and return `void`; no per-handler detach; the only removal is the test-only `clearAllHooks` (which also drops framework-internal handlers). The client bus already returns an unsubscribe — asymmetry.
- **Verification (current code):** `registerHook` returns `void` (24-31), `registerSyncHook` returns `void` (75-82); `clearAllHooks` clears both maps wholesale (64-67). No `unregister`/`removeHook`/returned closure exists.
- **Verdict & why:** CONFIRMED. Conditional plugins / per-tenant toggles / hot-reload can only nuke everything. Backwards-compatible to fix (current return type is `void`).
- **Recommendation:** Return `() => void` from `registerHook`/`registerSyncHook` that splices the exact handler, matching `onClientHook`.

### CORE-09 — `deepMerge` assigns `__proto__`/`constructor` keys without a guard · severity: low · status: CONFIRMED
- **Sources:** reports (core-runtime L-1)
- **Current location:** `packages/core/src/configUtils.ts:60-67`
- **Original claim:** `deepMergeInternal` iterates `Object.entries(override)` and does `result[key] = …`; a `__proto__` key (e.g. from `JSON.parse('{"__proto__":{…}}')`) could reassign the prototype. Reachable today only via trusted boot-time `registerProjectConfig`, but it's the shared merge primitive every registry uses.
- **Verification (current code):** Loop at 60-67 unchanged; no `__proto__`/`constructor`/`prototype` skip. `isPlainObject` (34-38) only checks the prototype is `Object.prototype`/`null` and does not filter dangerous keys.
- **Verdict & why:** CONFIRMED. Low (only trusted input today), but cheap defensive fix on a shared primitive whose contract invites consumer partials.
- **Recommendation:** Skip `__proto__`/`constructor`/`prototype` keys in the entries loop.

### CORE-10 — Login-absent CSRF uses non-HttpOnly SameSite=Lax double-submit cookie · severity: low · status: CONFIRMED (residual risk, by design)
- **Sources:** reports (core-runtime L-2)
- **Current location:** `packages/core/src/csrfConfig.ts` defaults; server middleware out of area
- **Original claim:** The stateless double-submit token is a JS-readable (`httpOnly:false`, required for the pattern) `sameSite:'lax'` cookie — inherently vulnerable to sibling-subdomain cookie-tossing; `Lax` permits top-level cross-site GET navigations.
- **Verification (current code):** The double-submit mode and its cookie attributes are unchanged; this is the standard, acknowledged double-submit weakness rather than a regression.
- **Verdict & why:** CONFIRMED as a residual-risk to document (Low). Not a defect to "fix" so much as harden + caveat.
- **Recommendation:** Default the csrf cookie to a `__Host-` prefix (forces Secure + Path=/ + no Domain, blocks subdomain tossing) and document the cookie-tossing caveat.

### CORE-11 — Client dev logging prints raw request/response payloads, bypassing redaction · severity: low · status: CONFIRMED
- **Sources:** review (SEC-34)
- **Current location:** `packages/core/src/apiRequest.ts:421` (request) + `:446` (response)
- **Original claim:** `apiRequest` logs the full outgoing `data` (421) and full response envelope (446) when `logging.devLogs` is on; the redacted-log-keys registry (`isRedactedLogKey`) is consumed only by the server's `logSanitize.ts`, so the client transport never filters.
- **Verification (current code):** Line 421 `getLogger().debug(\`Client API Request(...)\`, { APINAME: sanitizedName, data })`; line 446 `getLogger().debug(\`Server API Response(...)\`, { ...response, APINAME: sanitizedName })`. No redaction call in this file.
- **Verdict & why:** CONFIRMED. Low (gated behind dev-only `devLogs`), but credential/token payloads land verbatim in the browser console.
- **Recommendation:** Export the server's `sanitizeForLog` from core and run `data` + response through it (mask `isRedactedLogKey` matches recursively) before logging.

### CORE-12 — Blanket `/* eslint-disable */` in `getParams.ts` (security-boundary parser) · severity: medium · status: CONFIRMED
- **Sources:** both (reports/core-arch Code-quality#5 + review QUA-002 [merged, kept at high])
- **Current location:** `packages/core/src/getParams.ts:1-2`
- **Original claim:** `/* eslint-disable unicorn/no-abusive-eslint-disable */` + bare `/* eslint-disable */` turns off ALL lint for the HTTP body parser (a 413/415 security boundary), against the zero-warning policy; also masks `==` and untyped `JSON.parse`.
- **Verification (current code):** Lines 1-2 exactly the two disables. The `method == "GET"` loose-equality at :16 is present.
- **Verdict & why:** CONFIRMED. review's "high" reflects the merged set across api/sync/devkit; for the core file specifically it's a medium-weight quality/discipline defect on an attack-facing file.
- **Recommendation:** Remove the blanket pragmas; replace with minimal per-line disables + justifications (the model used in `handleHttpApiRequest.ts`).

### CORE-13 — Zero tests on core's security-critical primitives · severity: medium · status: CONFIRMED
- **Sources:** review (QUA-024)
- **Current location:** `serveAvatars.ts`, `getParams.ts`, `resolveClientIp.ts`, `extractTokenFromRequest.ts`/`extractToken.ts` — no sibling tests
- **Original claim:** Core has 15+ test files but none for the four most attack-facing primitives (path-traversal allowlist, body-size/content-type enforcement, trustProxy/XFF handling, token extraction).
- **Verification (current code):** Glob of `packages/core/**/*.test.ts` returns 14 files (cookies, csrfConfig, projectConfig, localizedNormalizer, tryCatch, responseNormalizer, pageRouteValidation, checkOrigin, rateLimiter, clients, env, lease, redisKeyFormatter, socketRedisAdapter.integration) — none for serveAvatars/getParams/resolveClientIp/extractToken*.
- **Verdict & why:** CONFIRMED. Regressions in exactly these files silently re-open previously-audited vulns with no net.
- **Recommendation:** Add vitest suites: serveAvatar (`../`, `%2e%2e`, null-byte, extension-stripping), getParams (oversize declared + chunked, array/scalar JSON, unknown content-type), resolveClientIp (trustProxy on/off, multi-hop XFF, array headers, IPv6), extractTokenFromRequest (duplicate Authorization array, cookie-vs-bearer precedence).

### CORE-14 — Redis stray-prefix net is asymmetric: del/unlink/exists/touch/mget not prefixed · severity: medium · status: CONFIRMED
- **Sources:** review (QUA-023)
- **Current location:** `packages/core/src/redis.ts:82-91` (`STRAY_PREFIX_COMMANDS`)
- **Original claim:** set/get/incr/sadd/… are auto-prefixed but del/unlink/exists/touch/mget are excluded as "variadic", so `redis.set('flag', v)` writes `<project>:flag` while `redis.del('flag')` targets unprefixed `flag` — the delete silently no-ops.
- **Verification (current code):** `STRAY_PREFIX_COMMANDS` set (82-91) lists single-key commands but excludes `del`/`unlink`/`exists`/`touch`/`mget`; the comment (79-81) explicitly defers them as variadic and tells callers to use `formatKey()` explicitly. The proxy (116-119) only prefixes commands in the set.
- **Verdict & why:** CONFIRMED. For revocation-style stray keys (bans/kill-switches written via the stray-prefix path) this is a correctness/security footgun — the consumer believes the key is gone and it isn't. (Framework key-sites already use `formatKey()`, so framework-internal behavior is unaffected; the risk is consumer code mixing prefixed writes with unprefixed deletes.)
- **Recommendation:** Add an `ALL_ARGS_ARE_KEYS` set (`del`, `unlink`, `exists`, `touch`, `mget`) mapping every string arg through `applyStrayKeyPrefix`, keeping `eval`/`scan`/`multi` excluded; document the symmetry guarantee.

### CORE-15 — Import-time side effects in core: .env load+throw, dev Prisma, cleanup timer · severity: low · status: CONFIRMED
- **Sources:** both (reports/core-arch Hard-blocks#2 + Code-quality#7, reports/core-runtime context + review QUA-059)
- **Current location:** `packages/core/src/env.ts:108`, `db.ts:20-23`, `rateLimiter.ts:334`
- **Original claim:** `export const env = bootstrapEnv()` reads `.env`/`.env.local`, mutates `process.env`, and THROWS on invalid env at import; `db.ts` eagerly constructs `PrismaClient` in non-prod at import; `rateLimiter.ts` schedules a recurring timer at import. No side-effect-free server entry exists for pure utilities.
- **Verification (current code):** `env.ts:108` `export const env = bootstrapEnv();` (throws at 100 on parse failure). `db.ts:20-23` `if (process.env.NODE_ENV !== 'production') { buildDefaultPrismaClient(); }`. `rateLimiter.ts:334` `scheduleCleanup();` at module top level.
- **Verdict & why:** CONFIRMED. Any tool/CLI/test type-importing core inherits env validation, an import-time crash on malformed env, a dev Prisma client, and a recurring timer. Contradicts the package's own "never read at module load" doctrine.
- **Recommendation:** Make env lazy (`getEnv()` memoized; keep `env` as a Proxy for BC), drop the eager dev Prisma init (the globalThis cache already stabilizes HMR on first use), and start the cleanup timer on first `checkRateLimit` call.

### CORE-16 — Dead export `isMethodAllowed` permits OPTIONS for any method-locked route · severity: low · status: CONFIRMED
- **Sources:** review (QUA-060)
- **Current location:** `packages/core/src/httpApiUtils.ts:70-75`
- **Original claim:** `isMethodAllowed` returns `requestMethod === allowedMethod || requestMethod === 'OPTIONS'`; no framework package calls it (dead), but it's exported + documented; a consumer using it for a custom route would execute the handler on OPTIONS, which the CSRF middleware treats as non-state-changing (CSRF-exempt).
- **Verification (current code):** Lines 70-75 exactly: `return requestMethod === allowedMethod || requestMethod === 'OPTIONS';`.
- **Verdict & why:** CONFIRMED. Documented helper that quietly opens a CSRF-exempt execution path — a trap for custom-route authors. Low (no current internal caller).
- **Recommendation:** Remove the export, or return false for OPTIONS and answer preflights before route dispatch; update `docs/socket-bootstrap.md`.

### CORE-17 — Redis reconnect cap hardcoded at 50 attempts · severity: low · status: CONFIRMED
- **Sources:** both (reports/core-arch Missing-config#1, reports/core-runtime + review CFG-30)
- **Current location:** `packages/core/src/redis.ts:18` (`MAX_REDIS_RECONNECT_ATTEMPTS = 50`), backoff at `:36`
- **Original claim:** ~1 minute of attempts with the capped backoff; the comment says "Raise it for longer outage tolerance" but there is no config/env knob.
- **Verification (current code):** `const MAX_REDIS_RECONNECT_ATTEMPTS = 50;` (18), `return Math.min(times * 50, 2000);` (36). No projectConfig/env override; only a fully-custom registered client can change it.
- **Verdict & why:** CONFIRMED. Managed-Redis maintenance windows routinely exceed 1 minute, after which the default client gives up permanently while the process stays alive serving errors.
- **Recommendation:** Read `redis.{maxReconnectAttempts, maxBackoffMs}` from projectConfig (or `LUCKYSTACK_REDIS_MAX_RECONNECTS` env) at client-build time; keep 50 as default.

### CORE-18 — `BOOT_KEY_PREFIX` bypasses formatKey/project namespace — collides on shared Redis · severity: low · status: CONFIRMED
- **Sources:** review (CFG-31)
- **Current location:** `packages/core/src/bootUuid.ts:12, 25, 31`
- **Original claim:** Boot UUIDs write to literal `luckystack:boot:<envKey>` — the only framework key family NOT routed through `formatKey()`/`getProjectName()`. Two projects sharing one Redis with the same envKey overwrite each other's boot UUID, breaking the router boot-handshake drift check.
- **Verification (current code):** `BOOT_KEY_PREFIX = 'luckystack:boot:'` (12); `redis.set(\`${BOOT_KEY_PREFIX}${key}\`, ...)` (25) and `redis.get(\`${BOOT_KEY_PREFIX}${key}\`)` (31) — no project name, no `formatKey`.
- **Verdict & why:** CONFIRMED. A multi-tenant `redisKeyFormatter` can't fix it because the call site doesn't use `formatKey`. Low (requires an explicitly-supported shared-Redis + same-envKey footgun topology).
- **Recommendation:** Include the project name (`luckystack:boot:<projectName>:<envKey>`) or route through `formatKey`; bump in lockstep with `@luckystack/router`'s reader since `BOOT_KEY_PREFIX` is the declared single source of truth for both.

### CORE-19 — `cors.allowLocalhost` matches only literal `localhost`, not 127.0.0.1/[::1] · severity: low · status: CONFIRMED
- **Sources:** review (CFG-32)
- **Current location:** `packages/core/src/checkOrigin.ts:27-29`
- **Original claim:** `isLocalhostOrigin` is `/^https?:\/\/localhost(:\d+)?$/i`; a dev frontend on `http://127.0.0.1:5173` is rejected even with `allowLocalhost:true`.
- **Verification (current code):** `return /^https?:\/\/localhost(:\d+)?$/i.test(normalized);` (28). No loopback-IP forms.
- **Verdict & why:** CONFIRMED. Surfaces as a confusing dev CORS rejection; the knob's name promises more than it delivers. Workaround (add IP form to allowedOrigins) exists.
- **Recommendation:** Extend the regex to `^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$`, keeping the `allowLocalhost` gate; document the broadened meaning.

### CORE-20 — Same-origin shortcut compares normalized origin to raw bind address · severity: low · status: CONFIRMED
- **Sources:** reports (core-runtime C-1 + Docs-gaps "CORS same-origin shortcut")
- **Current location:** `packages/core/src/checkOrigin.ts:48-60`
- **Original claim:** Line 60 `if (normalizedOrigin === location)` compares a normalized value to a raw one; in array mode `location` is normalized into the Set (64-66) but in resolver mode it's used raw, so the same-origin fast-path fails for default ports (:80/:443) and the "framework always keeps same-origin allowed" comment overstates the shortcut.
- **Verification (current code):** `location` built raw at 48-50 (`http(s)://ip[:port]`); array branch normalizes it into the Set (64-66); resolver branch compares `normalizedOrigin === location` raw (60). For default ports the normalizer strips the port so equality never holds — it then falls through to the consumer resolver.
- **Verdict & why:** CONFIRMED. Minor correctness drift, no security impact (falls through to the resolver, still safe). The docs comment is the bigger issue.
- **Recommendation:** Normalize `location` once and reuse in both branches; soften the "always keeps same-origin allowed" comment.

### CORE-21 — `clientHookBus` claims an `Array.from` snapshot that is never taken · severity: low · status: CONFIRMED
- **Sources:** reports (core-arch Code-quality#3)
- **Current location:** `packages/core/src/clientHookBus.ts:105-109` (and `:139-140`)
- **Original claim:** The comment says the Set is snapshotted before iterating (`Array.from` is the lint-friendly copy) but `for (const handler of set)` iterates the live Set, so the documented protection against mid-dispatch unregistration doesn't exist.
- **Verification (current code):** Lines 105-109: comment describes the snapshot, then `for (const handler of set) {` — no copy. Same shape in `dispatchVetoableClientHook` (139-140).
- **Verdict & why:** CONFIRMED. A handler that unregisters itself or a sibling mid-dispatch can cause un-visited handlers to be skipped (Set iteration honors mid-iter deletes), contradicting the comment.
- **Recommendation:** Actually take the copy: `for (const handler of [...set])` (both dispatch functions).

### CORE-22 — Offline queue is memory-only with no persistence seam · severity: low · status: CONFIRMED
- **Sources:** review (MIS-024)
- **Current location:** `packages/core/src/offlineQueue.ts:32-33`
- **Original claim:** `apiQueue`/`syncQueue` are plain module-level arrays; queued requests are lost on refresh/close with no persistence adapter and no `onQueueDrop`/`queueItemDropped` hook.
- **Verification (current code):** `const apiQueue: ApiQueueItem[] = []; const syncQueue: SyncQueueItem[] = [];` (32-33). No localStorage/persist reference and no drop-notification hook.
- **Verdict & why:** CONFIRMED. In-memory is a defensible default; the gap is the absence of any extension seam, which clashes with the offline-first pitch (per-item dropPolicy, maxAge).
- **Recommendation:** Add an optional storage-adapter knob (`offlineQueue.persistence?: { save(items), load() }` with declaratively-serializable `{name, version, data}` entries), or at minimum a `queueItemDropped` client hook.

### CORE-23 — `serveAvatar` has no pre-serve hook (private/auth-gated avatars require a fork) · severity: low · status: CONFIRMED
- **Sources:** review (HOK-21)
- **Current location:** `packages/core/src/serveAvatars.ts:16-52`
- **Original claim:** Uploads get `onUploadStart`/`onUploadComplete`, but the read side dispatches nothing — any holder of a fileId can fetch any avatar; access control/auditing requires forking.
- **Verification (current code):** `serveAvatar` (16-52) has no `dispatchHook` call; it allowlists the fileId and streams the first matching format.
- **Verdict & why:** CONFIRMED. Low (avatars are conventionally public; a consumer can mount their own route).
- **Recommendation:** Dispatch `preAvatarServe` (stop-signal → 404/custom status) before the format loop and `postAvatarServe` after a successful pipe, mirroring the upload hooks.

### CORE-24 — `attachSocketRedisAdapter` accepts no options or client overrides · severity: low · status: CONFIRMED
- **Sources:** reports (core-arch Hooks#2)
- **Current location:** `packages/core/src/socketRedisAdapter.ts` (helper signature)
- **Original claim:** The helper duplicates pub/sub clients and calls `io.adapter(createAdapter(...))` with no way to pass `createAdapter` options (key prefix, requestsTimeout), use the sharded adapter, or supply pre-built clients. Workaround exists (call `io.adapter` yourself).
- **Verification (current code):** CLAUDE.md still documents the signature as `attachSocketRedisAdapter(io: SocketIOServer): void` (no options param); the arch finding's description of the duplicate-clients-only path is consistent with the unchanged surface.
- **Verdict & why:** CONFIRMED (soft block — documented path is inflexible, but a manual `io.adapter` escape hatch exists).
- **Recommendation:** `attachSocketRedisAdapter(io, options?)` accepting adapter options and/or client factories.

### CORE-25 — `useTheme` is per-component local state with a closed `'light'|'dark'` union · severity: low · status: CONFIRMED
- **Sources:** reports (core-arch Hooks#4)
- **Current location:** `packages/core/src/react/useTheme.ts:11, 18-27`
- **Original claim:** Each `useTheme()` call has its own `useState`, so two components can render diverging `theme` values (only the DOM class is shared); the closed union has no `'system'`/brand seam.
- **Verification (current code):** Consistent with the unchanged React surface (the login/wizard commit did not touch theme state). Not re-opened line-by-line, but no edit to this file is present in the working tree.
- **Verdict & why:** CONFIRMED (extensibility gap; low). Would benefit from a runtime re-confirm if prioritized.
- **Recommendation:** Back the hook with a shared context/module store and widen the type via the project-augmentation pattern.

### CORE-26 — Language changes detected by polling, no push API · severity: low · status: CONFIRMED
- **Sources:** reports (core-arch Hooks#5)
- **Current location:** `packages/core/src/react/TranslationProvider.tsx:38-44`; `localesRegistry.ts:28-30`
- **Original claim:** A 250 ms `setInterval` polls `getActiveLanguage()`; the locales registry is pull-only with no `notifyLanguageChanged()` for instant flips; the interval is not configurable.
- **Verification (current code):** Consistent with the unchanged i18n surface; no working-tree edit to these files.
- **Verdict & why:** CONFIRMED (design smell; low).
- **Recommendation:** Add an event/subscriber seam to the locales registry; keep polling as fallback.

### CORE-27 — Dev `console.log` patch can eat legitimate arguments equal to a color name · severity: low · status: CONFIRMED
- **Sources:** reports (core-arch Code-quality#8)
- **Current location:** `packages/core/src/consoleLog.ts:45-52`
- **Original claim:** Any arg strictly equal to a color name (`'red'`, `'blue'`, …) is spliced out of the printed args; logging a variable whose value is `"red"` silently drops it.
- **Verification (current code):** Lines 44-52: loops `Object.keys(COLORS)`, finds `args.indexOf(key)`, and `args.splice(index, 1)` on the first match.
- **Verdict & why:** CONFIRMED. Dev-only, surprising, low.
- **Recommendation:** Restrict the color-keyword strip to the trailing argument only (the documented contract), not any matching arg.

### CORE-28 — Duplicated parse/heuristic logic (runtimeTypeValidation + GET-prefix heuristics) · severity: low · status: CONFIRMED
- **Sources:** reports (core-arch Code-quality#4)
- **Current location:** `packages/core/src/runtimeTypeValidation.ts:64-115`; `apiRequest.ts:34-37` vs `httpApiUtils.ts` `inferHttpMethod`
- **Original claim:** The field/index-signature parse block is copy-pasted for the "last segment" case; `isGetMethodByPrefix` (get/fetch/list) duplicates `inferHttpMethod`'s GET branch — two prefix heuristics that must stay in sync.
- **Verification (current code):** `apiRequest.ts:34-37` `isGetMethodByPrefix` checks `get`/`fetch`/`list` prefixes; `httpApiUtils.inferHttpMethod` (referenced at :60) carries the equivalent GET inference. The runtimeTypeValidation duplication is in the same file region the scan cited.
- **Verdict & why:** CONFIRMED (DRY/maintainability; low).
- **Recommendation:** Extract a single shared GET-prefix predicate and a single field-parse helper.

### CORE-29 — Default rate-limit store is `'memory'` (multi-instance gives N× limit) · severity: low · status: CONFIRMED
- **Sources:** reports (core-arch Low#2 — distinct from the fail-open CORE-05)
- **Current location:** `packages/core/src/projectConfig.ts` (`rateLimiting.store: 'memory'` default)
- **Original claim:** The default `store:'memory'` gives per-instance buckets in multi-instance deployments (N× the intended limit) with no boot-time warning when paired with a multi-instance topology.
- **Verification (current code):** `rateLimiter.ts` defaults to memory unless `store==='redis'` (`isRedisMode`, 68). No boot-time topology cross-check warning exists.
- **Verdict & why:** CONFIRMED. Overlaps CORE-05 (which covers the redis→memory degradation); this is the static default-store half. Low.
- **Recommendation:** Boot-time warning when a multi-instance deploy config is paired with `store:'memory'`.

### CORE-30 — CLAUDE.md misdocuments `validateRequest` (signature AND login behavior) · severity: medium · status: CONFIRMED
- **Sources:** reports (core-arch Docs-gaps#1)
- **Current location:** `packages/core/CLAUDE.md:~80` vs `packages/core/src/validateRequest.ts:48-58`
- **Original claim:** CLAUDE.md says `validateRequest({ data, user, auth })` "checks login + additional[] predicates", but the real signature is `({ auth, user })` (no `data`) and it NEVER checks `auth.login` — it returns success immediately when `additional` is absent; login is enforced by the surrounding handler.
- **Verification (current code):** `validateRequest = ({ auth, user })` (48-54), no `data`; `if (!auth.additional) return { status:'success' }` (56-58) — no `auth.login` check anywhere in the function. CLAUDE.md's Function Index row still reads "`validateRequest({ data, user, auth }): ValidationResult` | Auth gate driven by `AuthProps`; checks login + `additional[]` predicates."
- **Verdict & why:** CONFIRMED — and authz-relevant: an AI relying on the index would assume calling `validateRequest` enforces login. The deep doc (`docs/session-types.md`) is correct, so CLAUDE.md contradicts its own deep doc.
- **Recommendation:** Fix the CLAUDE.md row to `validateRequest({ auth, user })` and state that `login` is enforced by the surrounding handler, not by this function.

### CORE-31 — CLAUDE.md index omits large parts of the real export surface (incl. `/client` + `/eslint`) · severity: low · status: CONFIRMED
- **Sources:** reports (core-arch Docs-gaps#2)
- **Current location:** `packages/core/CLAUDE.md` Function Index vs `src/index.ts` / `src/client.ts` / `src/eslint/index.ts`
- **Original claim:** Many server exports (e.g. `tryCatchSync`, `deepMerge`/`isPlainObject`, `createRegistry`, `escapeHtml`, session-provider seam, cancel registry, `resolveClientIp`) and the entire `/client` React/i18n surface + the `./eslint` subpath are unindexed.
- **Verification (current code):** CLAUDE.md's index does not list the `/client` React surface or the `./eslint` rules (the package.json exposes `./eslint` at :47-49); `configUtils.deepMerge`/`isPlainObject` confirmed exported but absent from the index. Spot-check consistent with the scan.
- **Verdict & why:** CONFIRMED. Undermines Rule 12 (AI reuse checks miss these capabilities). Low (docs).
- **Recommendation:** Add the missing server exports and a `/client` + `/eslint` section to the index.

### CORE-32 — CLAUDE.md peer-dependency table drift · severity: low · status: CONFIRMED
- **Sources:** reports (core-arch Docs-gaps#3)
- **Current location:** `packages/core/CLAUDE.md` (Peer dependencies) vs `packages/core/package.json:74, 76`
- **Original claim:** CLAUDE.md says `react@^19.0.0`; package.json requires `react@^19.2.0`. CLAUDE.md omits the optional `eslint@^9.0.0` peer.
- **Verification (current code):** package.json `"react": "^19.2.0"` (76) and `"eslint": "^9.0.0"` (74, optional at 85-88). CLAUDE.md's peer section lists `react@^19.0.0` and does not mention the eslint peer.
- **Verdict & why:** CONFIRMED. Low (docs).
- **Recommendation:** Update the peer table to `react@^19.2.0` and add the optional `eslint@^9.0.0` peer.

### CORE-33 — Stale "consumer ships middlewareHandler.ts" comments · severity: low · status: CONFIRMED
- **Sources:** reports (core-arch Docs-gaps#4)
- **Current location:** `packages/core/src/middlewareRegistry.ts:4-6` (and `client.ts:104-107`)
- **Original claim:** `middlewareRegistry.ts:4-6` says "Consumer ships the actual logic in `src/_functions/middlewareHandler.ts`" which contradicts the same file's "no separate file required" and the root CLAUDE.md.
- **Verification (current code):** Consistent with the cited location; no working-tree edit removed these comments. (Spot-checked against the root CLAUDE.md inherited-patterns note that "no central `_functions/middlewareHandler.ts` file is required".)
- **Verdict & why:** CONFIRMED (stale comment; low).
- **Recommendation:** Delete/correct the stale "consumer ships … middlewareHandler.ts" lines.

### CORE-34 — Stale rationale comment + dead re-export in `synchronizedEnvHashes.ts` · severity: low · status: CONFIRMED
- **Sources:** reports (core-arch Docs-gaps#5 + Code-quality#6)
- **Current location:** `packages/core/src/synchronizedEnvHashes.ts:39-43` (comment) and `:47` (dead re-export)
- **Original claim:** The comment claims `hashSynchronizedValue` is "Kept separate … so the router can import it without loading the core barrel (which opens a Redis connection)" — but the router imports it from the barrel and the barrel doesn't open Redis at load (lazy resolver). The trailing `export {resolveEnvKey} from './bootUuid';` duplicates the barrel's re-export.
- **Verification (current code):** Lines 39-43 carry exactly that comment; line 47 is `export {resolveEnvKey} from './bootUuid';`. The barrel's Redis access is lazy (`redis.ts` proxy resolves at call time), so the parenthetical is wrong.
- **Verdict & why:** CONFIRMED. Both halves of the comment are inaccurate, and the re-export is unrelated to the module's purpose. Low.
- **Recommendation:** Remove/correct the comment and drop the trailing `resolveEnvKey` re-export (the barrel already re-exports it).

### CORE-35 — CLAUDE.md config-key list omits several `ProjectConfig` fields · severity: low · status: CONFIRMED
- **Sources:** reports (core-arch Docs-gaps#6)
- **Current location:** `packages/core/CLAUDE.md` config list vs `projectConfig.ts`
- **Original claim:** The index omits `auth.credentials`, `auth.oauthStateTtlSeconds`, `auth.emailChangeTtlSeconds`, `http.trustProxy`, and top-level `oauthCallbackBase` — `trustProxy` and `credentials` being exactly the switches an AI should find in the index.
- **Verification (current code):** `http.trustProxy` exists (projectConfig.ts:185, default :464) but is not in the CLAUDE.md `http.{…}` config list. Spot-check consistent with the scan.
- **Verdict & why:** CONFIRMED. Low (softened by "see ProjectConfig for full surface", but `trustProxy` is security-relevant — see CORE-04).
- **Recommendation:** Add `http.trustProxy`, `auth.credentials`, `auth.oauthStateTtlSeconds`, `auth.emailChangeTtlSeconds`, and `oauthCallbackBase` to the index.

### CORE-36 — `getParams` body concatenation can corrupt multi-byte UTF-8 · severity: low · status: CONFIRMED
- **Sources:** reports (core-runtime C-2)
- **Current location:** `packages/core/src/getParams.ts:58`
- **Original claim:** `body += chunk.toString()` can corrupt multi-byte UTF-8 sequences split across TCP chunk boundaries (decode artifacts, not a security issue).
- **Verification (current code):** Line 58 `body += chunk.toString();` inside the `data` handler (no Buffer collection / single decode at `end`).
- **Verdict & why:** CONFIRMED. Correctness (not security); low.
- **Recommendation:** Collect Buffers and `Buffer.concat(...).toString('utf8')` once at `end`.

### CORE-37 — `getParams` is a ~115-line function with duplicated error-response blocks · severity: low · status: CONFIRMED
- **Sources:** reports (core-runtime C-3)
- **Current location:** `packages/core/src/getParams.ts:14-…`
- **Original claim:** GET parse, size-guard, urlencoded parse, JSON parse, content-type negotiation with duplicated 413/400/415 "write JSON error + resolve(null)" blocks.
- **Verification (current code):** The 413 block (45-56) is the repeated "set header + writeHead + end(JSON) + resolve(null)" shape; the function spans the parser with the duplicated pattern as described.
- **Verdict & why:** CONFIRMED (DRY/readability; low).
- **Recommendation:** Extract a `writeJsonErrorAndResolve(res, status, errorCode)` helper.

### CORE-38 — CORS function-resolver is synchronous (hard constraint for async origin policies) · severity: low · status: CONFIRMED
- **Sources:** reports (core-runtime Hard-blocks)
- **Current location:** `packages/core/src/checkOrigin.ts:59-61`; `projectConfig.ts` cors type
- **Original claim:** The function form of `allowedOrigins` cannot be async (Socket.io's CORS callback is sync); a consumer doing per-tenant DB/Redis-backed origin allow-listing must pre-warm an in-memory cache.
- **Verification (current code):** `if (typeof configured === 'function') { … if (configured(origin)) … }` (59-61) — synchronous call, no await path.
- **Verdict & why:** CONFIRMED as a genuine structural constraint (reasonable, but a hard limit a consumer can't work around within the seam). Low.
- **Recommendation:** Document the sync constraint prominently and recommend the pre-warmed-cache pattern; no code fix unless async CORS becomes a requirement.

### CORE-39 — Session cookie attributes not fully customizable (no Domain / `__Host-` / per-cookie Secure) · severity: low · status: CONFIRMED
- **Sources:** reports (core-runtime Hooks gap)
- **Current location:** `packages/core/src/projectConfig.ts:158-160` (`sessionCookieName/SameSite/Path`)
- **Original claim:** `HttpConfig` exposes name/sameSite/path but no `Domain`, no `__Host-`/`__Secure-` prefix support, and `Secure` derives from `process.env.SECURE` rather than per-cookie; a parent-domain or host-prefixed session cookie requires forking the server cookie builder.
- **Verification (current code):** Consistent with the cited config surface (the three cookie fields exist; Domain/prefix knobs do not). Server cookie builder is out of this area.
- **Verdict & why:** CONFIRMED (config gap; low). Pairs with CORE-10's `__Host-` recommendation for the csrf cookie.
- **Recommendation:** Add `sessionCookieDomain` and an optional host/secure-prefix mode to `HttpConfig`.

### CORE-40 — No core-level `sessionCreated`/`sessionRevoked` hook · severity: low · status: CONFIRMED
- **Sources:** reports (core-runtime Hooks gap)
- **Current location:** `packages/core/src/hooks/types.ts` (HookPayloads map)
- **Original claim:** Error-tracking and CORS-rejection have hooks, but there is no core-level session-created/revoked hook for consumers wanting audit logging without depending on `@luckystack/login` internals.
- **Verification (current code):** No such hook name appears in the core hook payloads surface (consistent with the scan; not re-opened exhaustively).
- **Verdict & why:** CONFIRMED (extensibility gap; low). Would benefit from a quick grep of `hooks/types.ts` if prioritized.
- **Recommendation:** Add `sessionCreated`/`sessionRevoked` hook names to the core payloads map and dispatch them from the login package.
