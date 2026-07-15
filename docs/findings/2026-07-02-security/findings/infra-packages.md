# Infra-packages security + correctness audit (2026-07-02)

Scope: `packages/secret-manager`, `packages/email`, `packages/error-tracking`, `packages/presence`, `scripts/`.
Method: read every source file in full (adapters, config, orchestrators, lifecycle) + the sibling regression tests where behaviour was ambiguous. SCAN ONLY — nothing was modified.

Overall these packages are unusually well-hardened: CRLF stripping, scheme allowlists, body caps, redirect:error, HMAC recipient hashing, ALS per-request identity, secure-default deny-all env scanning, atomic apply, fail-open contracts that are deliberate and correctly *not* applied in `remote` mode. Most classic vulns (email header injection, SSRF via secret-manager fetch, redirect-based token exfil, unbounded response OOM, cross-request identity bleed) are already closed. The findings below are the residual gaps.

---

## MEDIUM

### M1 — PostHog `captureException` native path leaks UNSCRUBBED `error.message` / `error.stack`
**File:** `packages/error-tracking/src/adapters/posthog.ts` lines 89–118 (esp. 110–113)

```ts
const scrubbed = sanitizeErrorStrings(fwdError);
const errorMessage = scrubbed?.message ?? (fwdError instanceof Error ? fwdError.message : ...);
const errorStack  = scrubbed?.stack   ?? ...;
const properties = { ...fwdContext, 'error.type': ..., 'error.message': errorMessage, ...('error.stack'...) };
...
if (options.client.captureException) {
  options.client.captureException(fwdError, distinctId, properties);   // <-- RAW fwdError
  return;
}
options.client.capture({ distinctId, event: '$exception', properties }); // fallback = scrubbed only
```

`sanitizeErrorStrings` returns a *new* `{message, stack}` (it does NOT mutate `fwdError` — the Sentry adapter at `adapters/sentry.ts:99-104` proves this by rebuilding a fresh `Error` from the scrubbed values). On the native branch the adapter hands the **raw** `fwdError` to `posthog-node`, whose `captureException` parses the error object itself and builds a `$exception`/`$exception_list` from the raw `error.message` + stack trace. The scrubbed values are only attached as extra `properties`; they do NOT replace what posthog-node extracts from the raw object.

**Failure scenario:** `throw new Error('db connect failed: password=hunter2')` (or a JWT/API-key interpolated into a message or stack frame). With a `posthog-node` version that exposes `captureException` and `POSTHOG_KEY` set, the raw secret ships to PostHog even though ET-O2 hardening was added specifically to prevent it. The Sentry adapter rebuilds a scrubbed Error before sending; the Datadog adapter only ever sends scrubbed span tags (never the raw error object) — PostHog is the sole adapter that regressed.

**Why it's wrong:** breaks the stated ET-O2 invariant ("scrub secrets interpolated into error.message / error.stack before they reach PostHog") on the preferred code path. The regression test (`posthog.regression.test.ts`) uses a mock client with **no** `captureException` method, so every test exercises only the safe `capture` fallback — the leaky branch is entirely untested.

**Fix direction (report-only):** mirror the Sentry adapter — pass a rebuilt, scrubbed `Error` (name preserved for grouping) to `client.captureException`, not the raw `fwdError`.

---

## LOW

### L2 — `autoSelectEmailSender` silently degrades to `ConsoleSender` in production → password-reset URLs (with tokens) written to server logs
**Files:** `packages/email/src/autoSelect.ts:86-89`, `packages/email/src/register.ts:19`, `packages/email/src/adapters/console.ts:11-32`

`register.ts` runs `registerEmailSender(autoSelectEmailSender())` at boot. When neither `RESEND_API_KEY` nor `SMTP_HOST` is set — a very common prod-misconfig — `autoSelect` returns `ConsoleSender` with **no warning and regardless of `NODE_ENV`**. `ConsoleSender.send` `console.log`s the full rendered body. If `@luckystack/login`'s `forgotPassword: 'framework'` is enabled, the reset email body contains the reset URL (`resetUrl` → reset token, see `builtInTemplates.ts:61`). Result: (a) users never receive the mail, and (b) valid password-reset tokens land in the server log sink, usable by anyone with log access until TTL expiry.

**Why it's wrong:** a dev-only fallback is auto-selected in production silently. Consider a production warning when Console is selected outside development, or making `emailConfig.required` interact with the fallback. (Operational/mis-config class, not a code-path vuln — hence LOW, but the token-in-logs impact is real.)

### L3 — Error-tracker user identity (email/username) sent in plaintext on the Datadog + PostHog paths
**Files:** `packages/error-tracking/src/adapters/datadog.ts:122-130` (`usr.email`), `packages/error-tracking/src/adapters/posthog.ts:139-147` (`identify` with `email`, `username`)

`setUser` propagates `email`/`username` verbatim as span tags (`usr.email`, `usr.name`) and as PostHog person properties. There is no framework-level redaction (the Datadog adapter's own `@security` docstring at lines 53-61 acknowledges this and pushes responsibility to the consumer). This is *documented and intentional*, and Sentry behaves the same (its `builtinBeforeSend` deliberately does not scrub `user`), so it is standard error-tracking behaviour rather than a defect — flagged only so an org with a "PII must not leave the process boundary" requirement knows the recipient-hashing done in `@luckystack/email` is NOT mirrored here. This is the residue of the prior audit's "PostHog+Datadog bleed" note; the *cross-request* identity bleed itself is now fixed via the ALS `getCurrentErrorTrackerIdentity()` path (verified in `posthog.regression.test.ts`).

### L4 — `prismaWithSecrets.ts` spawns `prisma` with `shell: true` and unescaped forwarded argv
**File:** `scripts/prismaWithSecrets.ts:31-35`

```ts
const result = spawnSync('prisma', process.argv.slice(2), { stdio: 'inherit', env: process.env, shell: true });
```

With `shell: true`, args are concatenated into a shell command line without quoting, so shell metacharacters in `process.argv` would be interpreted (command injection surface). Input is the **developer's own** `npm run prisma:* -- <args>` invocation (trusted, not a network/request path), so real-world exploitability is negligible — hence LOW. Noted because `shell:true` + forwarded argv is the exact footgun class the prior overnight-audit memory flagged on Windows (`npm.cmd` space-splitting); here the risk is inverted (over-permissive shell parsing rather than under-quoting). Passing the resolved secrets to the child via `env: process.env` is correct and intended.

### L5 — CRLF header sanitization lives only in the `sendEmail` orchestrator; direct adapter calls bypass it
**Files:** `packages/email/src/sendEmail.ts:119-149` (`sanitizeMessageHeaders`, applied at line 328) vs `packages/email/src/adapters/{smtp,resend}.ts` + `providerPayload.ts`

`stripCrlf`/`sanitizeMessageHeaders` runs inside `sendEmail` before the adapter is invoked. The adapters (`SmtpSender.send`, `ResendSender.send`) and `toProviderPayload` do **no** CRLF stripping themselves. Any code that constructs an `EmailSender` and calls `.send(message)` directly (bypassing `sendEmail`) loses the header-injection defence. Adapters are contractually meant to be driven through `sendEmail`, so this is defence-in-depth only (LOW). Worth a one-line note in the adapter docstrings, or moving the strip into `toProviderPayload`.

### L6 — `formatTags` (Datadog) can throw on a circular / BigInt context value, dropping the metric
**File:** `packages/error-tracking/src/adapters/datadog.ts:85-96`

`JSON.stringify(v)` for object-valued tags throws on circular references and on `BigInt`. It is reached from `captureException`/`captureMessage` via `formatTags(fwdContext)`. The throw is swallowed one level up by `captureExceptionAcrossTrackers` (per-tracker isolation), so it cannot crash the chain, but the Datadog exception counter for that event is silently lost and the sibling `span` may already be open. Edge case (requires a circular/BigInt value in capture context) — LOW.

---

## Verified NOT issues (checked, deliberately excluded)

- **Secret-manager fail-OPEN** — confirmed intended in `hybrid` and correctly NOT applied in `remote` (`doResolveInner` re-throws in remote at `index.ts:695`; `applyResolved` fails atomically before mutating `process.env`). No misplaced fail-open found.
- **Secret-manager SSRF / token exfil** — `validateUrl` rejects non-http(s) + non-loopback plain http; `redirect: 'error'` (line 506) blocks redirect-based token/secret exfil to an unvalidated origin; `stripAuthorizationHeaders` makes the "cannot override Authorization" guard real for every header casing; response body is byte-capped (1 MiB) and abort-timed. Solid.
- **`renderEmailLayout` HTML/CSS injection** — all text `escapeHtml`'d; `safeCta` scheme-allowlists (blocks `javascript:`/`data:`); `safeAccent` restricts to hex or `[a-zA-Z]+` (no `;`/`url()` breakout). Solid.
- **Error-tracking "dead ALS wiring"** (prior audit) — now live: `autoInstrumentation.ts` sets `setCurrentErrorTrackerIdentity` on `preApiValidate`/`preSyncAuthorize`, adapters read it per-capture, `postLogout` clears it. ET-N3 (postLogin/apiError not wired) is a non-issue because identity is refreshed every request and ALS isolates concurrent requests.
- **Sentry redaction** — `builtinBeforeSend` scrubs cookies, headers (suffix-aware `isRedactedLogKey`), `request.data`, `query_string` (both forms), `extra`, `event.message`, and each `exception.values[].value`. The adapter additionally rebuilds a scrubbed Error. No gap found on the Sentry path (contrast M1 for PostHog).
- **Presence token leakage** — raw session tokens never broadcast; `tokenFingerprint` truncates to 8 chars for logs; `getRoomPresence`/peer fan-out expose only `userId`, never the token; `LocationProvider` forwards no query params by default. Grace-expiry/teardown paths are `tryCatch`-wrapped with idempotent `finally` cleanup (no timer/session leak).

---

## Summary counts
- CRITICAL: 0
- HIGH: 0
- MEDIUM: 1 (M1 — PostHog native captureException scrubbing bypass)
- LOW: 5 (L2 console-in-prod token logging, L3 plaintext user PII, L4 shell:true argv, L5 adapter CRLF bypass, L6 formatTags throw)
