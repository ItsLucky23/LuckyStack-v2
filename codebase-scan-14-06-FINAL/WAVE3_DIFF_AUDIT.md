# WAVE 3 — Diff-only audit of the uncommitted v0.2.0 changes

**Date:** 2026-06-15
**Scope:** `git diff 302cbf1 -> working tree` only (the ~200 uncommitted v0.2.0 fixes + breaking changes). No re-sweep of the already-9x-audited unchanged code.
**Method (ultracode):** 12 cheap finders (haiku/sonnet) per package/area over the diff → dedup in code → **Opus 4.8** adversarial verify of every MEDIUM+ candidate against the *current* tree → LOWs listed without Opus.
**Cost shape:** 30 agents, ~2.1M subagent tokens, ~9.5 min. Opus used only in the verify phase.

## Remediation status (2026-06-15 — follow-up pass)

All 8 confirmed REAL issues are now FIXED, plus 6 of the 11 LOW backlog items. Gate after the fixes: `lint` + `build` (16/16 packages) green, `ai:lint` clean, **1207/1207 unit tests pass** (+2 new ADR-0012 lockout regressions).

| ID | Status | Fix |
|---|---|---|
| H1 router boot-handshake hmac | ✅ fixed | thread `fallbackHealth.bootUuid` into `compareSynchronizedHashes` / `hashSynchronizedValue` (+2 stale comments in `synchronizedEnvHashes.ts`) |
| M1 preLogin-veto lockout | ✅ fixed | `authLockout.ts` deny-list → allow-list (`COUNTING_REASONS = {login.wrongPassword}`); +2 regression tests |
| M2 OAuth cookie Secure | ✅ fixed | `authApiRoute.ts` → `sessionCookieSecure ?? process.env.SECURE === 'true'` |
| L1 postSyncAuthorize on HTTP | ✅ fixed | dispatch added in `handleHttpSyncRequest.ts` (transport parity) |
| L2 shutdown close errors | ✅ fixed | `stopServer.ts` closers now reject→logged via `withTimeout` |
| L3 wsProxy upstream leak | ✅ fixed | `'response'` handler `resume()`+`destroy()`s upstream; +`settled` flag coordinates timeout/error/response paths |
| L4 getParams 413 body | ✅ fixed | write 413 before `req.destroy()` |
| L5 rateLimit scope drift | ✅ fixed | both sync handlers → `scope: ip` + `ip` field (parity with API); doc updated |
| backlog: syncRequest stale ref | ✅ fixed | null `cleanupProgressListener` after call |
| backlog: wsProxy timeout/error | ✅ fixed | covered by L3's `settled` flag |
| backlog: synchronizedEnvHashes comment | ✅ fixed | with H1 |
| backlog: redactedLogKeys depth | ✅ fixed | distinct `DEPTH_TRUNCATED_PLACEHOLDER` (not the redaction marker) |
| backlog: secret-manager warn flood | ✅ fixed | once-per-process guard |
| backlog: secret-manager NaN retries | ✅ fixed | finite/non-negative coercion + non-undefined `lastError` |
| backlog: apiRequest abortKey pre-interceptor | ⏭️ left | defensible (dedup on user payload); reorder risks the abort wiring — LOW, niche |
| backlog: createServer signal-before-listen | ⏭️ left | now graceful (L2 logs the `ERR_SERVER_NOT_RUNNING`); clean exit on boot-signal is correct |
| backlog: functions/redis default export | ⏭️ left | intended consumer-side change; accessed as `functions.redis.redis`, no `.default` consumer |
| backlog: proxyUtils empty XFF | ⏭️ left | empty XFF = "unknown client" → backend `resolveClientIp` maps to the unknown sentinel; trigger (no remoteAddress) is near-impossible over TCP |
| backlog: cli deleteAccount void hook | ⏭️ left | `postAccountDelete` is observational by-design in the consumer template |

## Tally

| | count |
|---|---|
| Raw candidates (finders) | 29 |
| After dedup | 29 |
| Opus-verified (MEDIUM+) | 18 |
| **Confirmed REAL** | **8** |
| Struck (FALSE-POSITIVE / INTENDED) | 10 |
| LOWs (listed, not Opus-verified) | 11 |

**Confirmed effective severity (after Opus re-scored):** 1 HIGH · 2 MEDIUM · 5 LOW.
Every finder-claimed CRITICAL was downgraded on verification — **no new critical, no security gate bypass, no crash path introduced by the diff.**

---

## (a) Confirmed NEW issues

> Note: finders proposed a severity; Opus re-scored against the real code. The **Effective** column is the Opus verdict and is what to act on.

### HIGH

**H1 — Router boot-handshake breaks under the new `healthHash.mode:'hmac'` default**
`packages/router/src/bootHandshake.ts:82` (finder said CRITICAL → **Effective HIGH**)
This diff makes `DEFAULT_PROJECT_CONFIG.http.healthHash = { mode:'hmac', salt:'@bootUuid' }`. The **server** side was migrated (`healthRoutes.ts:86` → `computeSynchronizedEnvHashes(bootUuid)` → HMAC). The **router compare** side was *not*: `bootHandshake.ts:82` calls `hashSynchronizedValue(localValue)` with **no bootUuid**, so `resolveHealthHashConfig(undefined)` collapses to plain SHA-256. Router(sha256) ≠ server(HMAC) for identical env → the handshake always reports `DIFFERS`: a false drift warning on every fallback-mode boot, and a **false hard-fail when `routing.strictBootHandshake=true`**. The needed `fallbackHealth.bootUuid` is already in scope (guarded non-null at `bootHandshake.ts:140`), just never threaded through. Classic half-migrated breaking change. Bounded to HIGH (not CRIT) because it's warning-only by default and only bites multi-instance/fallback deploys that declare `synchronizedEnvKeys`.
**Fix:** thread `fallbackHealth.bootUuid` through `compareSynchronizedHashes` and call `hashSynchronizedValue(localValue, bootUuid)` so both sides resolve the same hmac/@bootUuid config.

### MEDIUM

**M1 — `preLogin` hook veto increments the per-account lockout counter (violates ADR 0012's principle)**
`packages/login/src/login.ts:441-443` — **Effective MEDIUM**
On a `preLogin` veto, `loginWithCredentialsCore` calls `emitLoginFailed({ provider:'credentials', reason: signal.errorCode, stage:'login' })` **before** the `isAccountLocked` check, and the new lockout recorder (`authLockout.ts:120-124`) counts every `stage:'login'`/`credentials` failure whose reason isn't in the fixed `NON_COUNTING_REASONS` allow-list. Since the veto `errorCode` is **consumer-controlled** and runs with only `{email,provider}` (no password), a consumer who registers a vetoing `preLogin` handler (e.g. unverified-email / pending-2FA) lets an attacker who knows a victim's email drive the lockout counter with no password — and legitimately-vetoed users get counted too. ADR 0012 says lockout counts only genuine credential failures, so this is a *broken implementation of the intended decision*, not the decision itself. Not exploitable out-of-the-box (no default veto handler ships), hence MEDIUM. Uncovered by the lockout regression tests (they only exercise the policy-reason exemption).
**Fix:** don't count `preLogin`-veto rejections — tag the veto emit with a distinct non-counting marker/stage, or have the recorder count only the canonical credential-failure reason(s) instead of "everything not in `NON_COUNTING_REASONS`".

**M2 — OAuth state cookie ignores `process.env.SECURE`**
`packages/server/src/httpRoutes/authApiRoute.ts:68` — **Effective MEDIUM**
The new OAuth state-cookie code sets `Secure` from `config.http.sessionCookieSecure`, which has **no default** in `DEFAULT_PROJECT_CONFIG` (undefined). The real session cookie (`httpHandler.ts:218`) derives `Secure` from `process.env.SECURE`. So on a standard HTTPS deploy that sets `SECURE=true` and leaves `sessionCookieSecure` unset, the session cookie is `Secure` but the HttpOnly OAuth state/nonce cookie is **not** → it can ride over plaintext, weakening the OAuth browser-binding under MITM. Mitigated by HttpOnly + short TTL + per-flow nonce → MEDIUM not HIGH.
**Fix:** `const secureFlag = (config.http.sessionCookieSecure ?? process.env.SECURE === 'true') ? ' Secure;' : '';` (honor explicit override, fall back to the `SECURE` env flag — matching the session cookie).

### LOW (confirmed REAL, low impact)

| ID | File | Issue | Fix direction |
|---|---|---|---|
| L1 | `packages/sync/src/handleHttpSyncRequest.ts:~415` | `postSyncAuthorize` hook is the **one** parity hook omitted from the HTTP/SSE sync handler (5 others were added). Audit/metrics subscribers silently never fire over HTTP. Observational only — enforcement hooks (`preSyncAuthorize`, `validateRequest`, `authorizeSyncReceiver`) are all present. | Dispatch `postSyncAuthorize` after the `preSyncAuthorize` stop-check, mirroring `handleSyncRequest.ts:541`. |
| L2 | `packages/server/src/stopServer.ts:54,61` | `closeHttpServer`/`closeIoServer` discard the `close(cb)` error arg and resolve unconditionally → a shutdown-close failure is swallowed with no log (inconsistent with every other shutdown step). No hang/leak; only a lost diagnostic. | Accept the cb error arg; `getLogger().warn` it (or reject so `withTimeout`'s tryCatch logs it). |
| L3 | `packages/router/src/wsProxy.ts:182` | New `'response'` handler destroys the *client* socket but never `resume()`/`destroy()`s the **upstream** response → leaks the upstream socket on a non-101 upgrade response. **Self-healing**: the handshake `setTimeout` reaps it after ~30s (finder's "indefinite leak" claim was refuted). | Add `upstreamRequest.destroy()` (or `upstreamRes.resume()`) in the `'response'` handler. |
| L4 | `packages/core/src/getParams.ts:60` | Refactor reversed the order: `req.destroy()` now runs **before** the 413 body is written, so the mid-stream-overflow path sends an empty/RST connection instead of the 413 JSON. **No crash / no unhandled EPIPE** (finder's mechanism was wrong); `writableEnded` still short-circuits the caller. Only the human-readable 413 body is lost; oversized requests are still rejected. | Write the 413 response first, then `req.destroy()` (restore original order) — or drop `req.destroy()` since `resolve(null)`+`writableEnded` already short-circuits. |
| L5 | `packages/api/src/handleApiRequest.ts:152` & `handleHttpApiRequest.ts:336` vs `packages/sync/src/handleSyncRequest.ts:105` / `handleHttpSyncRequest.ts:115` | The diff relabeled the anonymous per-route `rateLimitExceeded` bucket `route`→`ip` in **both API** handlers (with a new test asserting it) but left **both sync** handlers emitting `route`. Same event, different `scope` per transport. Label-only — no code subscriber branches on `scope==='route'`. | Apply the same relabel to both sync handlers; update `packages/sync/docs/error-states.md:132`. |

---

## (b) Struck — false-positives & intended changes (not bugs)

All 10 were Opus-refuted against the current tree. The interesting ones (would look scary in a naive report):

- **Cross-provider account-link bypass via `provider:null`** (`login.ts:871`) — **FALSE-POSITIVE.** The null precondition is unreachable: template schema declares `provider PROVIDERS @default(credentials)` (non-nullable) and every write path sets a non-null provider. Requires a consumer to deviate from the documented schema. *(Optional hardening: make the guard fail-closed — `existingProvider !== provider.name` — so a hypothetical null row still needs a verified email.)*
- **Double `httpServer.close()` in graceful shutdown** (`stopServer.ts:96`) — **FALSE-POSITIVE.** `io.close()` does internally re-close the http server, but socket.io swallows the `ERR_SERVER_NOT_RUNNING` in its own callback; the "resolved before drain" narrative is inverted (`io.close()` force-drains sockets itself). Benign no-op.
- **Signal-handler IIFE missing `.catch()`** (`createServer.ts:235`) — **FALSE-POSITIVE.** `runGracefulShutdown` cannot reject: every throwing step is `withTimeout`-wrapped (never rejects), and `getLogger()` always returns a non-throwing default. The missing `.catch()` guards a path that can't fire.
- **`runtimeTypeValidation` fails closed on `Array<T>`** (`runtimeTypeValidation.ts:360`) — **FALSE-POSITIVE.** The validator only ever receives generator-resolved text; the devkit emitter normalizes `Array<T>`/`ReadonlyArray<T>` → `T[]` before emit. No route breaks.
- **`getCachedResolution` leaks raw secrets** (`secret-manager/src/index.ts:789`) — **FALSE-POSITIVE.** The diff does the *opposite*: it now returns a defensive copy, adds a `⚠️ SENSITIVE` JSDoc, and introduces the values-free `getCachedResolutionMeta()`. This is the already-fixed SM-03. No callsite pipes it into /health or logs.
- **Array payload bypasses HTTP input guard** (`handleHttpApiRequest.ts:222`) — **FALSE-POSITIVE.** The HTTP path can't deliver an array: `getParams.ts:97` rejects array/scalar JSON bodies with 400, and `apiRoute.ts` spreads into `{}`. The socket guard was added because the socket ack path lacks that normalization.
- **`getRoomPresence` unguarded `extractTokenFromSocket` crash** (`activitySampler.ts:86`) — **FALSE-POSITIVE.** `extractTokenFromSocket` only does null-safe property reads on `socket.handshake` — no parse/throw path.
- **`dispatchActivitySample` unhandled rejection** (`activitySampler.ts:136`) — **FALSE-POSITIVE / pre-existing.** Identical `void dispatchActivitySample(...)` exists at 302cbf1; the diff didn't introduce or worsen it. Built-in `afk` predicate can't throw.
- **SessionProvider null-deref on `avatar`** (`SessionProvider.tsx:134`) — **FALSE-POSITIVE.** `parsed` is the consumer `SessionLayout`; Prisma `avatar String @default("")` is non-nullable, so `.replaceAll` is type-safe and no emitter produces a null avatar.
- **revokeSession `id` vs `handle` field drift** (`src/settings` vs CLI template) — **FALSE-POSITIVE.** Each install is internally consistent (writer+frontend+reader matched within each copy); the two reference copies are never mixed at runtime. Cosmetic divergence, not a contract break. *(Optional: align the two reference copies.)*

**Also confirmed not-an-issue per the run's filter:** ADR 0007–0012 intended changes (secure-default flips, S22 envelope, syncCancel server-id, token-hashing-at-rest, graceful shutdown, lockout-excludes-policy) were correctly implemented where checked; the prior `registerErrorFormatter` "shadow-API" and `sqlite`-Prisma HIGH were not re-raised.

---

## (c) LOW backlog (finder-reported, not Opus-verified — treat as hints)

`syncRequest.ts:610` stale `cleanupProgressListener` ref · `createServer.ts:246` prod signal handlers registered before `listen()` (signal in the create→listen window stops a non-listening server) · `wsProxy.ts:142` timeout vs error path double-event (benign, guarded) · `proxyUtils.ts:131` `buildForwardedFor(undefined)` emits empty `x-forwarded-for` instead of omitting · `apiRequest.ts:348` `abortKey` computed pre-interceptor (interceptor-added fields don't dedup) · `synchronizedEnvHashes.ts:23` **stale comment** says DEFAULT is `plain` but it's now `hmac` (related to H1 — fix together) · `redactedLogKeys.ts:80` depth>8 redacts benign values too · `secret-manager/src/index.ts:270` `warnIfEnvNamesUnset` floods on every rotation poll (no once-guard) · `secret-manager/src/index.ts:466` `retries.count=NaN` → throws `undefined` · `functions/redis.ts:18` dropped `default` export (no current consumer) · CLI template `deleteAccount_v1.ts:70` `void` `postAccountDelete` fires after success response.

---

## Eindoordeel — is de nieuwe code ship-safe?

**Ja, met één aanbevolen fix vóór een multi-instance/router release.**

- Geen nieuwe CRITICAL, geen auth-gate-bypass, geen crash-pad geïntroduceerd door de diff. Alle finder-CRITICALs sneuvelden bij verificatie.
- **H1 (router boot-handshake hmac-default)** is de enige die ik vóór ship zou fixen: het is een half-gemigreerde breaking change die *strict* boot-handshakes hard laat falen op fallback/multi-instance deploys. Single-instance deploys raken het niet. Triviale fix (bootUuid doorgeven) — pak L `synchronizedEnvHashes.ts:23` stale comment meteen mee.
- **M1 (preLogin-veto lockout)** en **M2 (OAuth-cookie Secure)** zijn echte maar laag-exploiteerbare hardening-gaps; fix vóór een security-gevoelige release, niet blocking voor een interne/single-instance ship.
- De 5 LOW-confirmed + 11 LOW-backlog zijn opruimwerk, geen blockers.
