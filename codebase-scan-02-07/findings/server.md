# Security + Correctness Audit — `@luckystack/server`

Date: 2026-07-02
Scope: `packages/server/src/**` (raw HTTP + Socket.io server, HTTP pipeline, custom
routes, webhooks, streaming-upload seam, origin-exempt paths). Every source file was
read in full. Two `@luckystack/core` helpers invoked by the pipeline were also read
because the audit brief covers body-DoS and file-serving traversal that live behind the
server's calls: `core/src/getParams.ts` and `core/src/serveAvatars.ts`.

## Verdict

The server package is genuinely well hardened. The prior CRITICAL "server.js
source-disclosure" is **FIXED** and structurally guarded. No CRITICAL or HIGH issues
found in the current tree. Findings are LOW / informational: a few unauthenticated
Redis-touching endpoints without throttling, a CORS-reflection edge on origin-exempt
paths, and one rate-limit window edge case.

Severity counts: CRITICAL 0 · HIGH 0 · MEDIUM 1 · LOW 5 · INFO/positive 3

---

## POSITIVE — prior CRITICAL "server.js source disclosure" is FIXED

File: `src/httpRoutes/staticRoutes.ts:14,43-47,52-71,84-89`

Verified the current state per the brief. Source disclosure is now blocked by three
layered, structural guards that do NOT depend on the consumer's `serveFile`:

1. `SERVE_DENYLIST_REGEX = /(^\/server\.js$)|(\.map$)/` runs first and 404s the server
   bundle and every `*.map` source map (line 43).
2. The `/assets/` branch rejects any decoded `..` before delegating (line 59) — and the
   path reaching here is already percent-decoded in `httpHandler.ts:244`, so
   `/assets/%2e%2e/server.js` is caught.
3. Unknown extensions (`.ts`, `.json`, `.env`, …) fall through to a 404 (line 85), and
   the SPA catch-all always rewrites the served URL to `/` (line 98) rather than passing
   an attacker path.

No traversal or source-file path reaches the consumer `serveFile` for the framework
static branches. This finding is resolved; retained here as evidence for the regression
history.

---

## MEDIUM

### M1 — Unauthenticated OAuth-init creates Redis state on every request with no rate limit (resource-exhaustion / write-amplification)

File: `src/httpRoutes/authApiRoute.ts:65-93`

The full-OAuth-provider branch runs on a plain browser navigation (`GET
/auth/api/<provider>?return_url=...`). For each hit it calls
`login.createOAuthState(...)` which writes a new server-side (Redis) OAuth-state entry,
then 302-redirects. This branch is reached BEFORE any rate-limit check — the
`checkRateLimit(...)` call at line 154 lives only in the *credentials* branch further
down and never runs for OAuth-init.

Origin gate does not stop it either: `enforceOriginPolicy` (`httpHandler.ts:142-151`)
only fail-closes state-changing methods when the Origin header is absent. OAuth-init is a
`GET`, so a header-less, unauthenticated caller passes the gate.

Failure scenario: an attacker loops `GET /auth/api/google` (no cookies, no Origin). Each
request performs a Redis write plus round-trip and adds a TTL-bounded state key. High
request rates create sustained Redis write load and key growth until TTL expiry
(`auth.oauthStateTtlSeconds`).

Why it's only MEDIUM: entries are small and self-expire, and a WS/infra rate-limit or a
`preHttpRequest` hook can throttle it. But an unauthenticated endpoint that writes
server-side state on every GET with no built-in throttle is a real amplification gap.

Suggested mitigation: apply a per-IP `checkRateLimit` to the OAuth-init branch (same as
the credentials branch), or document that operators must rate-limit `/auth/api/*` at the
edge.

---

## LOW

### L1 — CORS reflects an unvalidated Origin with credentials on origin-exempt paths

File: `src/httpHandler.ts:44-52,128-140,254-257`

`enforceOriginPolicy` returns the raw normalized Origin for origin-exempt paths WITHOUT
running `allowedOrigin()` (line 138-140 — early return). `setSecurityHeaders` then
reflects that value into `Access-Control-Allow-Origin` and, when `cors.credentials` is
set, also emits `Access-Control-Allow-Credentials: true` (lines 46-52).

Result: for a registered webhook prefix, a response carries
`Access-Control-Allow-Origin: <attacker-controlled origin>` + credentials. For every
NON-exempt path this is safe (the origin was allowlist-checked, or is empty for a
header-less GET), so the exposure is limited to exempt prefixes.

Real impact is low because origin-exempt paths are server-to-server webhooks: browsers
don't call them and they don't authenticate via cookies, so there is nothing sensitive to
read cross-origin. Still, reflecting an unvalidated origin with credentials is a CORS
misconfiguration that would bite a consumer who ever registers an exempt prefix that also
serves browser-readable, cookie-authenticated data.

Suggested: on the exempt path, do not reflect the raw Origin into ACAO (omit CORS headers
for exempt routes, or set `ACAO` to the configured allowlist only).

### L2 — Pre-params custom routes (webhooks + streaming uploads) bypass the framework body-size cap

Files: `src/httpHandler.ts:84-94,326`, `src/httpRoutes/customRoutes.ts:36-50`,
`core/src/getParams.ts:45-80`

`getParams` enforces `http.requestBodyMaxBytes` (413 + `req.destroy()` on
`content-length` and on streamed overflow). But `'pre-params'` custom routes run in the
PRE_PARAMS phase, before `getParams` is ever called (dispatched at
`httpHandler.ts:326`), specifically so the handler gets the raw `req` stream. That means
the framework applies NO body-size limit to webhook / streaming-upload handlers.

This is by design (streaming uploads need unbounded bodies), but it means a custom
pre-params handler that reads `req` without its own cap is an unbounded-body DoS. Worth
flagging as an INFO-grade contract: the origin-exempt + pre-params seam shifts BOTH auth
(already documented — "exemption ≠ auth") AND body-size limiting onto the handler.

Suggested: document in `docs/ARCHITECTURE_HTTP.md` that pre-params handlers must enforce
their own `content-length` / streamed-byte cap; optionally offer a helper.

### L3 — `/_health` and `/readyz` are unauthenticated and each performs Redis + Prisma work (amplification)

File: `src/httpRoutes/healthRoutes.ts:58-110`

Both probes ping Redis and Prisma per call (`pingPrisma` runs `SELECT 1` /
`{ping:1}`; readyz also `redis.ping()`). They are intentionally unauthenticated
(orchestrators/LBs probe them) and the code comments explicitly accept this and defer
mitigation to the infra layer (lines 61-65, 87-89). `/_health` additionally publishes
per-env synchronized hashes; the 0.2.0 default is HMAC-salted on the boot UUID (not the
old unsalted `sha256(secret)`), and `verifyBootstrap` warns if a consumer downgrades to
`mode:'plain'` (`verifyBootstrap.ts:125-136`).

Recording as LOW/known: an unauthenticated caller can amplify DB/Redis load. The comments
already recommend binding to loopback or a probe token in production — that guidance is
sound and should stay.

### L4 — Rate-limit window/limit mismatch when `defaultApiLimit` is `0`

File: `src/httpRoutes/authApiRoute.ts:143-153`

`ipLimitCount` falls back to the auth slot when `defaultApiLimit` is `false` OR not `> 0`
(so also when it is `0`). But `ipWindowMs` only switches to `auth.windowMs` when
`defaultApiLimit === false` (strict) — for `defaultApiLimit === 0` it uses the general
`rateLimiting.windowMs`. So with `defaultApiLimit: 0`, the credentials limiter uses the
auth **count** but the general **window**, an inconsistent bucket.

Edge case only (a `0` general limit is an unusual config, and may be rejected by config
validation upstream). Correctness nit, not a security hole. Align the two predicates:
derive both count and window from the same "is the general limit active?" check.

### L5 — Origin-exempt matching uses `startsWith` on a prefix, enabling accidental over-exemption

Files: `src/originExemptRegistry.ts:35-36`, `src/httpRoutes/csrfMiddleware.ts:45-48`

`isOriginExemptPath` matches any path that `startsWith` a registered prefix, and that same
predicate exempts the path from BOTH the origin gate AND CSRF (`csrfMiddleware.ts:45-48`).
A consumer registering `/webhooks` (no trailing slash) would also exempt
`/webhooksadmin`, silently dropping CSRF + origin checks. The registry doc-comment and the
CSRF comment both warn to prefer a trailing-slash prefix, so this is consumer-guardrail
rather than a framework bug — but since a single mis-registration disables two protections
at once, it is worth a hardening note.

Suggested: consider normalizing/validating registered prefixes (e.g. require a trailing
`/` or match on path-segment boundaries) so a prefix can't bleed into a sibling route.

---

## INFO / verified-clean (checked, no issue)

- **Body parser (`core/getParams.ts`)** — enforces `content-length` and streamed-byte
  caps with a 413 + `req.destroy()`, rejects non-object JSON, guards `headersSent`
  re-entry, and resolves `null` on stream error instead of rejecting (avoids
  unhandled-rejection worker crash). Solid.
- **Avatar serving (`core/serveAvatars.ts`)** — `path.basename` + a strict
  `^[A-Za-z0-9_-]{1,128}$` fileId allowlist + null-byte rejection; pipeline error sink
  prevents a post-headers stream error from crashing the worker. No traversal.
- **`x-request-id` reflection** (`httpHandler.ts:264-267`) — validated against
  `^[a-zA-Z0-9-]{1,128}$` before echo; no header injection.
- **Percent-decoding + malformed-encoding handling** (`httpHandler.ts:242-251`) — decodes
  once so route guards compare plain paths; malformed encoding → 400 (no silent
  fall-through).
- **CSRF middleware** — cookie-mode double-submit (login-absent) and session-bound
  (login-present) both use constant-time compare (`timingSafeEqual.ts`); credentials
  bootstrap + OAuth callback exemptions are reasoned and rely on SameSite for the residual
  vector.
- **Constant-time token compares** — `/auth/csrf`, `/_test/reset`, and CSRF all use
  `crypto.timingSafeEqual` via `timingSafeStringEqual`.
- **`/_test/reset`** (`testResetRoute.ts`) — fail-closed on `NODE_ENV` (must be
  development/test), requires `TEST_RESET_TOKEN` unconditionally (unset ≠ no-auth),
  POST-only, uses a fixed loopback base for URL parsing (ignores client `Host`).
- **Top-level HTTP error boundary** (`httpHandler.ts:336-352`) and per-route `tryCatch`
  wrappers convert unhandled throws to 500s, preventing process-crashing unhandled
  rejections. Socket per-request abort wiring (`apiRoute`/`syncRoute` markClosed) prevents
  broken-socket `'error'` crashes.
- **Graceful shutdown** (`stopServer.ts`) — every step is timeout-bounded and never
  rejects; idempotent via `shutdownPromise` in `createServer.ts`.
- **Session cookie `Secure`** derivation unified through `resolveCookieSecure` for both
  session and OAuth-state cookies (no drift); OAuth state bound to browser via
  short-lived cookie; based-token delivered in URL fragment (not query/Referer).
- **Prototype pollution** — `configUtils.deepMerge` skips `__proto__`/`constructor`/
  `prototype` (per core CLAUDE.md); JSON body parser rejects arrays/scalars. No unsafe
  merge of attacker JSON into objects in the server package.
- **Socket CORS** (`loadSocket.ts:517-562`) — origin-less handshake is allowed by
  deliberate, documented design (same-origin polling handshake); the real auth gate is the
  session token + `applySocketMiddlewares`. Threat model is spelled out in-code. Room
  join validates token + caps group length (256) and per-session room count (FIFO
  eviction) to bound Redis session bloat.
