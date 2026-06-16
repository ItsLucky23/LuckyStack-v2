# WAVE 4 — Delta audit of the wave-3 remediation (regressions from the fixes)

**Date:** 2026-06-15
**Scope:** DELTA only — the files the wave-3 remediation touched (per `WAVE3_DIFF_AUDIT.md`'s fix-table) + their direct callers/blast-radius. NOT a full re-audit. Goal: bugs/security-risks *introduced* by the wave-3 fixes (half-migrated changes, off-by-one in new guards, new error paths, regressions).
**Method (ultracode):** 7 cheap finders (haiku/sonnet) → dedup → **Opus 4.8** adversarial verify of every MEDIUM+ → LOWs listed without Opus.
**Cost:** 15 agents, ~1.07M subagent tokens, ~11 min.

## Tally

| | count |
|---|---|
| Raw candidates | 15 |
| Opus-verified (MEDIUM+) | 8 |
| **Confirmed REAL** | **2** (both MEDIUM) |
| Confirmed HIGH/CRITICAL | **0** |
| Struck (FALSE-POSITIVE / INTENDED) | 6 |
| LOW (listed, not Opus-verified) | 7 |

Both confirmed issues are now **FIXED** with regression tests. Gate after fixes: **build ✓ · lint ✓ · ai:lint ✓ · test:unit 1213/1213** (was 1207; +6 tests, +1 file).

---

## (a) Confirmed NEW issues — both FIXED

### M2-followup — session-token cookie ignored `sessionCookieSecure` (the wave-3 M2 fix only updated the OAuth cookie) — ✅ FIXED
`packages/server/src/httpHandler.ts:218` · MEDIUM · bug
The wave-3 M2 fix made the OAuth **state** cookie honor `config.http.sessionCookieSecure ?? process.env.SECURE`, but the security-critical **session-token** cookie (`buildSessionCookieOptions`) still derived `Secure` from `process.env.SECURE` only — so a consumer setting `sessionCookieSecure` (force-on behind a TLS-terminating proxy, or force-off) was honored for the OAuth cookie but silently ignored for the session cookie. My wave-3 comment even falsely claimed parity. (Root defect pre-existed; the M2 fix surfaced + mis-documented the divergence.)
**Fix:** extracted a shared pure seam `resolveCookieSecure(sessionCookieSecure, SECURE)` (`httpRoutes/sessionCookie.ts`), now used by BOTH cookies so they can never drift again. +regression test `sessionCookie.test.ts` (override-on/off + env fallback).

### H1-followup — router boot-handshake hashed with its OWN default config, not the backend's `healthHash` — ✅ FIXED
`packages/core/src/synchronizedEnvHashes.ts:109` · finder HIGH → **Opus MEDIUM** · contract-drift
The wave-3 H1 fix made the default (`hmac`+`@bootUuid`) case work, but the router process never loads the backend's `config.ts`, so `hashSynchronizedValue` resolved `healthHash` from the router's DEFAULT config. If a consumer customized `http.healthHash` on the backend (e.g. `mode:'plain'`, or a static salt), the router still hashed with `hmac`/`@bootUuid` → permanent false `DIFFERS` (spurious warning, or hard boot-fail under `strictBootHandshake`). New cross-process coupling introduced by SEC-13/H1; only bites consumers running the router AND a non-default `healthHash`.
**Fix:** `/_health` now returns a **safe** descriptor `healthHash: { mode, bootUuidSalt }` (never the static salt — it's a secret). The router resolves the backend's config via `resolveHealthHashConfigFromDescriptor` and hashes with it; a **static salt** the router can't see → it **skips** the compare with a clear log (no false drift), `plain`/`@bootUuid` verify correctly. Older backend (no descriptor) → falls back to the wave-3 `@bootUuid` behavior (correct for the shared default). +4 regression tests in `synchronizedEnvHashes.test.ts`.

---

## (b) Struck — false-positives / intended (Opus-refuted, not re-raised)

- **`scope:'route'` dead in `RateLimitExceededPayload` union** — FALSE-POSITIVE. The union line was never touched; keeping the extra literal type-checks fine; the IP-relabel is the intended L5 behavior. Pure stale type/doc breadth, no broken guard.
- **`syncRequest` missing `cleanupResponseListener?.()` call before nulling (HIGH claim)** — FALSE-POSITIVE. The response listener is registered with `.once`, so socket.io auto-removes it when it fires; calling `off()` would be a redundant no-op. The author correctly treats `.once` (null only) vs `.on` progress listener (call+null) differently.
- **wsProxy `'error'` handler missing `upgraded` guard (HIGH claim)** — FALSE-POSITIVE. Post-upgrade the `ClientRequest` is detached and does not re-emit `'error'`; post-upgrade socket errors surface on `upstreamSocket` (own teardown via `safeDestroy`, never `upstreamRequest.destroy()`). The missing guard is benign defensive asymmetry, not a triggerable write into the live WS pipe.
- **getParams `resolve(null)` on req error doesn't short-circuit (HIGH claim)** — FALSE-POSITIVE. "empty body → handler runs with `{}`" is the framework's pre-existing intended contract; the `params===null` short-circuit only fires when a response was already written. On a mid-stream RST the socket is already destroyed so the eventual write is a dead-socket no-op. Not a regression.
- **secret-manager `warnedEnvNamesUnset` not reset by `stopSecretManager`** — INTENDED. The contract is "warn ONCE per process" (not per-boot); `stopSecretManager` is a documented soft teardown; the reset lives only in `resetSecretManagerForTests` by design. Secrets still resolve; only a deliberately-suppressed warning is omitted.
- **secret-manager hanging `onApplied` deadlocks `resolveChain`** — FALSE-POSITIVE. Throwing/rejecting/slow callbacks are all handled; the only trigger is a consumer Promise that LITERALLY never settles — an out-of-threat-model contract violation, not a wave-3 defect.

---

## (c) Habits (flag-only — NOT fixed, your call)

These are real-but-low and were NOT Opus-verified; left as flags per the bugs-only mandate.

| File | Habit | Note |
|---|---|---|
| `login.ts:577` (+`:558`) | shape-validation login/register failures don't `emitLoginFailed` | audit-hook gap for non-lockout consumers; not a lockout/security issue (correctly excluded from lockout) |
| `login.ts:528` | `void clearAuthFailures(email)` fire-and-forget | a Redis blip on success leaves the counter un-cleared; pre-existing, LOW |
| `createServer.ts:236` | signal IIFE uses `void` not `.catch()` | `runGracefulShutdown` still can't reject (every step is `withTimeout`-wrapped, incl. the new L2 reject) → unreachable; trivial 1-line hardening available if wanted |
| `handleSyncRequest.ts:115` / `handleHttpSyncRequest.ts` | `ip: token ? undefined : resolvedIp` writes an explicit `undefined` key | matches the existing API-handler pattern (`handleApiRequest.ts:166`); cosmetic |
| `handleSyncRequest.ts:659` | `postSyncExecute` not dispatched when `preSyncExecute` stops | EXT-04 contract nuance (pre-existing, both transports); not a wave-3 regression |
| `handleSyncRequest.ts:658` | `preSyncExecute` dispatched with a `PostSyncExecutePayload`-shaped object | structurally compatible; only visible to a handler using `as any`/`Object.keys`; EXT-04 |
| `secret-manager/index.ts:474` | `lastError` pre-init is dead code (NaN-coercion guarantees ≥1 iteration) | belt-and-suspenders from my wave-3 NaN fix; harmless |

---

## (d) Verdict — CONVERGED / ship-safe

**0 new HIGH/CRITICAL** from the Opus verify. The 2 MEDIUM regressions the wave-3 fixes surfaced are now fixed + regression-tested; the gate is fully green (1213/1213).

Across 9 codebase scans + a diff-audit (wave-3) + this delta-audit, each pass is now returning only MEDIUM-and-below, mostly false-positives or pre-existing habits — the classic convergence signal. **Recommendation: stop static-auditing.** Freeze + commit the working tree, then shift to:
1. **runtime / integration tests** — multi-instance router boot handshake with a non-default `healthHash` (exercise the new descriptor path end-to-end), graceful-shutdown drain under load, the sync S22 envelope + receiver-auth flips against a live socket.
2. **a pentest / DAST pass** on a deployed instance — static analysis has diminishing returns here; the remaining risk class is runtime/behavioral, not source-visible.

A further static delta-pass is **not** advised unless a new feature lands. The habits in (c) are a backlog you can pick from at leisure; none block a ship.
