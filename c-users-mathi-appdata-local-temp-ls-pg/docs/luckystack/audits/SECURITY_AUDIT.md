# LuckyStack v2 — Security Audit Report

**Date:** 2026-06-09
**Scope:** All 15 `@luckystack/*` packages (api, cli/create-luckystack-app, core, docs-ui, email, error-tracking, login, presence, router, secret-manager, server, sync, and supporting packages).
**Method:** Parallel per-area audit across packages, followed by adversarial verification of every high/critical finding (each high/critical was independently re-examined against the real code paths and deployment model to confirm exploitability or refute it as by-design/false-positive). Medium/low/info findings are reported as raised (unverified-lower tier).

> This document is **report-only**. No code was modified. It records findings, their verification status, and a prioritized remediation checklist for the maintainers to act on.

---

## Executive Summary

The audit produced **3 confirmed high/critical** issues (1 of which was severity-adjusted down to medium after verification) and **22 unverified medium/low/info** findings. **13 high/critical findings were refuted** as by-design or false-positive after adversarial verification — these are listed in the appendix with the reasoning for dismissal.

The dominant real-world risk is **rate-limit bypass behind a reverse proxy**: LuckyStack derives the client IP directly from the transport socket (`req.socket.remoteAddress` for HTTP, `socket.handshake.address` for Socket.io) with no trusted-proxy / `X-Forwarded-For` handling. Since the documented deployment model (`docs/HOSTING.md`) puts the app behind nginx/HAProxy, all proxied clients collapse into a single IP bucket. A path-traversal gap in the scaffolder (`create-luckystack-app`) rounds out the confirmed set.

### Severity counts (confirmed + unverified-lower findings)

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 |
| Medium | 19 |
| Low | 4 |
| Info | 0 |

> Counts reflect post-verification severities: the IP-spoofing HTTP finding was downgraded High → Medium during verification; the Socket.io IP finding and the scaffold path-traversal remain High. The 13 refuted high/critical items are **excluded** from the table above and summarized in the appendix.

---

## Confirmed High & Critical

### H-1 — Socket.io IP extraction missing proxy-header support (per-IP rate-limit bypass)

- **Severity:** High
- **File:** `packages/api/src/handleApiRequest.ts:235`
- **Category:** rate-limit
- **Description:** The Socket.io API handler uses `socket.handshake.address` directly for per-IP rate limiting. `handshake.address` reflects the TCP peer of the WebSocket handshake and does not honor `X-Forwarded-For` / `X-Real-IP`. Behind a reverse proxy performing WebSocket upgrade, this is the proxy's address, not the client's. The framework exposes no `trustProxy` configuration to opt into header-based IP resolution.
- **Impact:** Per-IP rate limiting on WebSocket connections is ineffective behind a reverse proxy. All Socket.io clients through the same proxy share one bucket (e.g. `ip:<proxyIP>:api:...`), so a single attacker can exhaust the per-IP limit for all legitimate users sharing that proxy.
- **Recommendation:** Add a trusted-proxy mode. When enabled, resolve the real client IP from `X-Forwarded-For` (leftmost untrusted hop) / `X-Real-IP` via a Socket.io handshake middleware before constructing the rate-limit key. Gate this behind explicit config so it is only trusted when a known proxy is in front.
- **Verification reasoning:** Confirmed real and exploitable. The documented deployment model (`docs/HOSTING.md`) is "behind a reverse proxy," which is exactly the condition that makes `handshake.address` the proxy IP. The rate limiter at `handleApiRequest.ts:235-238` consumes that value verbatim with no header fallback and no `trustProxy` knob, so all proxied sockets collapse into one bucket — a genuine bypass of the intended protection. Severity retained at High.

### H-2 — Path traversal in scaffold project-directory creation

- **Severity:** High
- **File:** `packages/create-luckystack-app/src/index.ts:826`
- **Category:** path-traversal
- **Description:** The scaffolder slugifies the project name for template-variable substitution (line 820) but builds the target directory from the **unsanitized** `args.projectName`: `const targetDir = path.resolve(process.cwd(), args.projectName);`. The only guard (line 821) checks that `slugify(args.projectName)` is non-empty, which still passes for inputs like `../../../tmp/evil` (slug → `tmp-evil`). `copyTree` then recursively writes the template to the resolved, attacker-controlled path.
- **Impact:** `npx create-luckystack-app ../../../tmp/evil` writes template files outside the intended subdirectory, to any location writable by the executing user — overwriting parent-directory config, injecting files into shared directories, or corrupting unrelated projects.
- **Recommendation:** Use the sanitized `slug` for the directory path: `const targetDir = path.resolve(process.cwd(), slug);`. After resolving, additionally assert the result stays within `process.cwd()` (e.g. `path.relative(cwd, targetDir)` does not start with `..` and is not absolute) and reject otherwise.
- **Verification reasoning:** Confirmed real and exploitable. The non-empty-slug validation does not constrain the path actually used; `args.projectName` flows straight into `path.resolve`, so `../` segments escape the project root. The `slug` value is used only for template substitution, never for the directory path. This is a clear input-validation gap (not a fail-open design choice), enabling arbitrary file writes within the user's permissions.

### H-3 — HTTP API IP extraction missing proxy-header support (downgraded to Medium)

- **Severity:** Medium *(originally raised High; adjusted down during verification)*
- **File:** `packages/server/src/httpRoutes/apiRoute.ts:63`
- **Category:** rate-limit
- **Description:** The HTTP API route extracts the requester IP from `req.socket.remoteAddress` without consulting `X-Forwarded-For` / `X-Real-IP`. Behind a reverse proxy (the documented topology, `docs/HOSTING.md`), all proxied requests appear to originate from the proxy's IP, so the per-IP bucket (`defaultIpLimit`) is shared across all clients on that proxy.
- **Impact:** Unauthenticated/public APIs are exposed to global per-IP bucket exhaustion: an attacker routing through the proxy can spend the shared `defaultIpLimit` and degrade service for every client behind the same proxy IP.
- **Recommendation:** Same trusted-proxy resolution as H-1, applied to the HTTP path. Resolve the real client IP from proxy headers when a trusted proxy is configured; otherwise document that direct exposure (no proxy) is required for per-IP limits to be meaningful.
- **Verification reasoning:** Confirmed real but **downgraded High → Medium**. Mitigating factors reduce blast radius: (1) per-route rate limits apply independently of the IP bucket (`handleHttpApiRequest.ts:354-392`); (2) authenticated users are keyed by token, not IP (`token ?? requesterIp`, line 360), so the shared-bucket problem only affects unauthenticated callers; (3) the loopback exemption in non-production (lines 401-403) shows IP handling was a considered design area. The residual risk — shared `defaultIpLimit` exhaustion on public/unauthenticated routes in production behind a proxy — is real and unmitigated, hence Medium.

> **Note (dedupe):** H-1 and H-3 are the same root cause (no trusted-proxy IP resolution) on two transports. A single shared IP-resolution helper, applied to both `apiRoute.ts` (HTTP) and `handleApiRequest.ts` (Socket.io), resolves both.

---

## Medium / Low / Informational

### Authentication & session (login package)

| File:line | Issue | Recommendation |
|---|---|---|
| `packages/login/src/login.ts:214` | Medium — `findUserResponse.password!` non-null assertion before `bcrypt.compare()`; `UserRecord.password` is `string \| null`. A null password (data corruption/migration) throws instead of cleanly rejecting. | Add explicit null check before compare: `if (!findUserResponse.password) return { status: false, reason: 'login.wrongPassword' };`. |
| `packages/login/src/login.ts:216-218` | Medium — on bcrypt error, raw `checkPasswordError` is returned as `reason` without `toReasonKey()` sanitization; may leak internal error detail. | Wrap consistently: `reason: toReasonKey(checkPasswordError)`. |
| `packages/login/src/login.ts:532` | Medium — OAuth provider name from `pathname.split('/')[3]` is used in string ops/logging before the existence check at line 534. | Whitelist immediately after extraction against `getOAuthProviders().map(p => p.name)`; null out unknown providers before any use. |
| `packages/login/src/login.ts:47` | Low — OAuth state TTL (default 10 min, `oauthStateTtlSeconds`) can expire mid-flow, causing legitimate callback failures (UX/soft-DoS). | Keep configurable; document the default and surface it in dev logs for diagnosis. |
| `packages/login/src/session.ts:66` | Medium — CSRF token minted only on first write (`data.csrfToken ??= ...`), reused across OAuth re-logins; rotated only on logout. | Rotate on new-session creation: `if (!data.csrfToken \|\| newUser) { data.csrfToken = randomBytes(...).toString('hex'); }`. |
| `packages/login/src/login.ts:313` | Low — token-exchange `redirect_uri` uses configured `provider.callbackURL` with no per-request re-validation against the value used at authorization time. | Persist the authorization-time `redirect_uri` and re-validate before token exchange, or make callback URL immutable post-registration. |

### Core auth / header handling

| File:line | Issue | Recommendation |
|---|---|---|
| `packages/core/src/extractTokenFromRequest.ts:16-19` | Medium — reads `req.headers.authorization` as a plain string; Node typing is `string \| string[] \| undefined`. Duplicate Authorization headers (array) break `startsWith` and can mis-extract or null out a valid token. | Normalize like `csrfMiddleware.ts:45-46`: `const authHeader = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;`. |

### Rate limiting / DoS (api package)

| File:line | Issue | Recommendation |
|---|---|---|
| `packages/api/src/handleHttpApiRequest.ts:401-407` | Medium — IPs are not normalized before keying. IPv4-mapped IPv6 (`::ffff:x.x.x.x`) vs bare IPv4, and IPv6 variants, create distinct keys for the same logical host, allowing per-IP limit spreading. | Canonicalize IPs before key construction (extract IPv4 from `::ffff:` form; normalize IPv6) via `ip-address` or equivalent. |
| `packages/api/src/handleApiRequest.ts:198,235` | Medium — `socket.handshake.address ?? 'unknown'` funnels all address-extraction failures into a single `ip:unknown:...` bucket, mixing legitimate and malicious traffic; potential reduced effective limits. | Reject requests with missing/invalid IP, or apply a stricter limit to the `unknown` bucket and alert on its use. |

### Information disclosure (api / email)

| File:line | Issue | Recommendation |
|---|---|---|
| `packages/api/src/handleHttpApiRequest.ts:470-478` | Medium — failed input validation returns the raw `inputValidation.message` (exact type/shape: `data.userId should be string`, union details) to the client. Because HTTP validates after auth, unauthenticated callers can enumerate route input schemas — contradicting `docs/ARCHITECTURE_API.md:410`. | Return a generic code (e.g. `api.invalidInputType`) to the client; route detailed validation context to the `postApiValidate` hook for logging only. |
| `packages/email/src/sendEmail.ts:148-154` | Medium — on send failure, `captureException` attaches `message.subject` and `message.to` (recipient email) to Sentry. The Sentry `beforeSend` strips cookies but not these PII fields; password-reset subjects + addresses can be retained externally. | Redact/hash `to`/`cc`/`bcc` and sanitize `subject` in a `beforeSend` hook before sending to error tracking. |

### Sync pipeline (sync package)

| File:line | Issue | Recommendation |
|---|---|---|
| `packages/sync/src/handleHttpSyncRequest.ts:533` | Medium — `if (ignoreSelf && token && token === tempToken)` lacks the boolean type-check the Socket.io handler has (`handleSyncRequest.ts:645`). A truthy `"true"`/`1` would skip the originator from broadcasts they requested. | Add `typeof ignoreSelf === 'boolean'` to the condition to match the Socket.io path. |
| `packages/sync/src/handleHttpSyncRequest.ts:529-622` | Low — `recipientCount` only increments on success paths (lines 609, 621); per-recipient `_client` failures (574, 586, 598) skip it. Diverges from Socket.io (`handleSyncRequest.ts:649`), undercounting in `postSyncFanout`. | Increment `recipientCount` once after the `ignoreSelf` check (before the `_client` branch), matching the Socket.io handler. |

### Router (header forwarding / config)

| File:line | Issue | Recommendation |
|---|---|---|
| `packages/router/src/httpProxy.ts:118` | Medium — `resolved.resolvedEnvKey` (from user config) is forwarded as the `x-luckystack-resolved-env` header without character validation; a compromised resolver/config could inject special characters (incl. CRLF). | Validate `envKey` at config-load time (`resolveTarget.ts`/`startRouter.ts`) to `^[A-Za-z0-9_-]+$`; reject otherwise. |

### Secret manager

| File:line | Issue | Recommendation |
|---|---|---|
| `packages/secret-manager/src/index.ts:121` | Medium — bearer token interpolated as `Bearer ${resolveToken(...)}` with no scheme/empty validation; a token already containing `Bearer ` or whitespace yields a malformed header and silent auth failure (hybrid falls back to local env). | In `resolveToken`: reject empty/whitespace tokens, warn on a `Bearer ` prefix, throw a clear error on invalid values. |
| `packages/secret-manager/src/index.ts:201` | Medium — env-key regex `^[\w.-]+$` allows `.`/`-`, accepting non-POSIX keys (`INVALID-KEY`, `INVALID.KEY`) into `process.env`, which then can't be read normally. | Tighten to `^[A-Za-z_][A-Za-z0-9_]*$`; warn on rejected keys. |
| `packages/secret-manager/src/index.ts:132-137` | Medium — `fetchResolve` does not verify that response `body.values` keys match the requested pointer set; a compromised server can inject extra cached values via `getCachedResolution()`. | Filter the response to requested keys only; treat `getCachedResolution()` output as sensitive. |
| `packages/secret-manager/src/index.ts:117` | Medium — endpoint built by trimming slashes + appending `/resolve` with no URL/scheme validation; a relative or `file://` URL could cause unexpected fetch behavior / SSRF-adjacent issues. | Validate with `new URL(config.url)` at init; require absolute `http(s)` scheme; throw on failure. |
| `packages/secret-manager/src/index.ts:237-247,299-306` | Medium — dev hot-reload watches/reads `config.dev.envFiles` paths directly (`fsWatch`/`readFileSync`) with no path validation; `../../../etc/passwd` or absolute paths would be parsed into `process.env`. | Require relative paths; resolve against `process.cwd()` and reject `path.relative` escapes; restrict to expected locations. |
| `packages/secret-manager/src/index.ts:109` | Low — `resolveToken` uses `readFileSync` with no try/catch; a deleted/unreadable token file mid-session can crash a hot-reload poll. Boot-time fail-closed is correct; dev mid-session handling is unclear. | Document that the token file must stay readable during dev; optionally cache at config time; distinguish file-not-found from other I/O errors in logs. |

---

## Refuted / By-design (Appendix)

The following high/critical findings were **dismissed** after adversarial verification. They are recorded so they are not re-raised.

1. **Timing attack / user enumeration in credentials login** (`packages/login/src/login.ts`) — Coarse per-IP rate limiting on `/auth/api/credentials` (`authApiRoute.ts:69-96`) runs before the handler; DB/network variance (10-100ms+) dwarfs the ~100ms bcrypt signal. Rate-limiting-as-defense is a valid architectural choice. Not exploitable in practice.
2. **Rate-limit key collision via unsanitized IPv6 colons** (`packages/api/src/handleApiRequest.ts`) — Keys are opaque atomic strings; never parsed/split on delimiters (Map lookups in memory mode; atomic args to `redis.eval` in Redis mode). Colons are cosmetic. No collision possible.
3. **HTTP handler ignores `validation: 'relaxed'`** (`packages/api/src/handleHttpApiRequest.ts`) — Explicitly documented intentional divergence (`packages/api/docs/api-request-lifecycle.md:163`): HTTP always validates; webhooks needing relaxed validation use the socket variant. Known design choice, not a bug.
4. **Response header injection via upstream headers (HTTP proxy)** (`packages/router/src/httpProxy.ts:123-127`) — Node's RFC-7230 HTTP parser strips CRLF during parsing; `res.setHeader` throws `ERR_INVALID_CHAR` on invalid chars (Node 20+). Parsed values cannot carry CRLF. False positive.
5. **Response header injection via upstream headers (WS upgrade proxy)** (`packages/router/src/wsProxy.ts:77-87`) — Same parser-level guarantee; `upstreamRes.headers` is already validated and cannot contain literal CRLF. False positive.
6. **Health store poisoning via untrusted service key (Redis pub/sub)** (`packages/router/src/redisHealthStore.ts:59`) — `resolveTarget.ts:231` (`if (!locallyOwnedSet.has(service)) return;`) blocks unowned services; routing reads health only for locally-owned services. Poisoned cache never reaches routing decisions.
7. **Proxy header injection: `x-forwarded-proto` echo (HTTP proxy)** (`packages/router/src/httpProxy.ts`) — Router sits behind a trusted TLS-terminating proxy by design; backend derives protocol from `SECURE` env, OAuth uses hardcoded `callbackURL` and config `publicOrigin`, not request headers. No security decision consumes the header.
8. **Proxy header injection: `x-forwarded-proto` (WS upgrade path)** (`packages/router/src/wsProxy.ts:68`) — Backend (`loadSocket.ts`) reads only language/token headers; cookie security uses `process.env.SECURE`. The forwarded header is informational; no exploitable consumer.
9. **No TLS cert validation for remote secret server** (`packages/secret-manager/src/index.ts`) — Node 20+ global `fetch` (undici) enforces cert validation by default; remote mode fails-fast (hard boot crash) on any TLS/network failure. Custom CAs available via `fetchImpl` override. By design.
10. **Secret values leak in error messages** (`packages/secret-manager/src/index.ts`) — Error paths (159, 183, 221, 253) log pointer identifiers and status/text only; resolved `values` are never attached to error objects, and the Authorization header/response body are never logged. False positive.
11. **CSS injection via unvalidated `accent` color** (`packages/email/src/renderEmailLayout.ts:58`) — Never wired to user input; all framework callers omit it and use the hardcoded default. Low-level dev utility, not a public untrusted-input API.
12. **HTML attribute injection via `ctaUrl`** (`packages/email/src/renderEmailLayout.ts:59`) — Intentional escape-free handling (test-documented) for query-param URLs; all call-sites build it safely (`encodeURIComponent`, hardcoded paths). Email clients disable inline JS, neutralizing the claimed `onclick` vector.
13. **Session token exposure in AFK broadcast** (`packages/presence/src/activity/afkEvent.ts:31`) — The `{ token }` broadcast lives in `dispatchActivitySample`, which is **dead code** (called only from tests). Production AFK uses `initActivityBroadcaster` → `informRoomPeers`, broadcasting only `{ userId, endTime }`. Zero exploitable risk (dead-code cleanup item only).

---

## Prioritized Remediation Checklist

- [ ] **1. (High, H-1/H-3)** Add a trusted-proxy IP-resolution helper and apply it on both transports — `packages/server/src/httpRoutes/apiRoute.ts:63` (HTTP) and `packages/api/src/handleApiRequest.ts:235` (Socket.io) — resolving the real client IP from `X-Forwarded-For`/`X-Real-IP` only when a proxy is explicitly trusted.
- [ ] **2. (High, H-2)** Build the scaffold target dir from the sanitized `slug` and assert it stays within `process.cwd()` — `packages/create-luckystack-app/src/index.ts:826`.
- [ ] **3. (Medium)** Stop leaking validation type/shape to clients; return a generic code and route detail to `postApiValidate` — `packages/api/src/handleHttpApiRequest.ts:470-478`.
- [ ] **4. (Medium)** Redact PII (`to`/`cc`/`bcc`, sanitize `subject`) before Sentry capture — `packages/email/src/sendEmail.ts:148-154`.
- [ ] **5. (Medium)** Rotate the CSRF token on new-session / OAuth login — `packages/login/src/session.ts:66`.
- [ ] **6. (Medium)** Normalize duplicate/array Authorization headers — `packages/core/src/extractTokenFromRequest.ts:16-19`.
- [ ] **7. (Medium)** Canonicalize IPs before rate-limit keying (IPv4-mapped IPv6, IPv6 variants) — `packages/api/src/handleHttpApiRequest.ts:401-407`.
- [ ] **8. (Medium)** Harden the `ip:unknown` fallback bucket (reject or stricter-limit + alert) — `packages/api/src/handleApiRequest.ts:198,235`.
- [ ] **9. (Medium)** Add boolean type-check for `ignoreSelf` in the HTTP sync handler — `packages/sync/src/handleHttpSyncRequest.ts:533`.
- [ ] **10. (Medium)** Validate `envKey` characters at config load before forwarding as a header — `packages/router/src/httpProxy.ts:118` (+ `resolveTarget.ts`).
- [ ] **11. (Medium)** Secret-manager input hardening: validate bearer token (`:121`), tighten env-key regex (`:201`), filter server response to requested pointers (`:132-137`), validate `config.url` scheme (`:117`), validate dev `envFiles` paths (`:237-247,299-306`) — `packages/secret-manager/src/index.ts`.
- [ ] **12. (Medium)** Defensive null/sanitization in credentials login: null-check before `bcrypt.compare` (`:214`), `toReasonKey` the bcrypt error (`:216-218`), whitelist OAuth provider name early (`:532`) — `packages/login/src/login.ts`.
- [ ] **13. (Low)** Fix `recipientCount` accounting in the HTTP sync fanout — `packages/sync/src/handleHttpSyncRequest.ts:529-622`.
- [ ] **14. (Low)** OAuth hardening: document/configure state TTL (`:47`), re-validate `redirect_uri` at token exchange (`:313`) — `packages/login/src/login.ts`.
- [ ] **15. (Low)** Secret-manager dev token-file resilience: distinguish file-not-found from I/O errors; document readability requirement — `packages/secret-manager/src/index.ts:109`.
- [ ] **16. (Cleanup)** Remove dead `dispatchActivitySample`/`afkEvent.ts` token-broadcast path — `packages/presence/src/activity/afkEvent.ts:31`.
