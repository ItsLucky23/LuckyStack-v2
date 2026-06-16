# Reconciled area report: email (FINAL)

Area: `@luckystack/email` (`packages/email/**`) + the core-owned `EmailMessage` contract (`packages/core/src/emailRegistry.ts`).
Tree audited: branch `chore/package-split-prep`, HEAD `302cbf1` + ~248 uncommitted edits (this week's fixes).

## Inputs reconciled

- Wave-2 per-area: `codebase-scan--wave2-14-06--1/per-area/email.md`, `--3/per-area/email.md`, `--4/per-area/email.md` (run 2 = input digest, ignored).
- Wave-1 baseline: `codebase-scan-14-06-MERGED/per-area/email.md` (6-run merge, items #1–#20) + `LOW_ANALYSIS/email.md` (E1–E20, what THIS session fixed/deferred).

## Headline

The wave-1 MERGED baseline (#1, #2, #5, #6, #9, #10, #13) was written against a **hallucinated, more-elaborate `sendEmail.ts`/`console.ts`** containing helpers that NEVER existed in git history (`sanitizeHeaderMap`, `stripCrlf`, `sanitizeHeaders`, `withSendTimeout`/`sendTimeoutMs`, `dispatchEarlyDrop`, `redactUrlSecrets`, `safeColor`/`SAFE_COLOR`, `safeCtaUrl`). All three wave-2 runs independently confirmed this. I re-verified every cited symbol against the current tree — they are absent. Those wave-1 findings are therefore FALSE-POSITIVE (phantom-code) and re-characterized below where a genuine residual gap exists.

The single genuine **NEW HIGH** is the `preEmailSend` stop-signal being ignored: the suppression/abort contract is advertised as live in README + CLAUDE.md but `sendEmail` discards the `DispatchResult` (2/3 runs, verified). No CRITICAL in this area.

This session DID land real fixes verified present: ResendSender floating-promise `.catch` (wave-1 #3 / E3), `sendEmail` god-function decomposition (#13/E13), shared `toProviderPayload` (#14/E14), and the password-reset doc reconciliation (#16/E16).

---

## FIXED (verified resolved in current tree)

| # | Finding | Severity | Status | Wave1 | Wave2 | Location | Note/Recommendation |
|---|---|---|---|---|---|---|---|
| F1 | ResendSender floating eager `clientPromise` → possible `unhandledRejection` on import failure before first `send()` | medium | FIXED | 2/6 (#3/E3) | 1/3 (r4 "fixed") | `packages/email/src/adapters/resend.ts:55-60` | `void clientPromise.catch(() => {});` attaches a no-op handler to a SEPARATE promise; `send` still awaits the original. Strictly-additive defense, behavior-preserving. Confirmed at lines 55-60. |
| F2 | `sendEmail` ~165-line multi-responsibility god-function | low (refactor) | FIXED | 6/6 (#13/E13) | refuted-as-fixed (r1,r4) | `packages/email/src/sendEmail.ts:177-218` | Decomposed into `buildMessage` / `normalizeSendResult` / `reportSendOutcome`; orchestrator is ~42 lines. Characterization tests in `sendEmailOrchestration.test.ts`. |
| F3 | Duplicated SMTP/Resend provider field-mapping | low (refactor) | FIXED (partial) | 6/6 (#14/E14) | 1/3 (r1 "now-fixed partial") | `packages/email/src/adapters/providerPayload.ts`, used `smtp.ts`, `resend.ts:71` | Shared `toProviderPayload` is the single source of truth. The `missing-from` guard stays duplicated per adapter (intentional — returns adapter-specific `EmailResult`). NOTE: this shared mapper is the site of EMAIL/O5 (drops attachments/headers). |
| F4 | `password-reset-integration.md` contradicted the built-in-template implementation (claimed login bypasses the template registry) | medium (quality) | FIXED | 1/6 (#16/E16) | refuted-as-fixed (r1,r4) | `packages/email/docs/password-reset-integration.md`; verified vs `packages/login/src/forgotPassword.ts` + `builtInTemplates.ts:84-91` + `sendEmail.ts:99` | Doc reconciled this session. `forgotPassword` passes `template: 'password-reset'`; `sendEmail` resolves consumer→built-in. Doc and code now agree. |

---

## OPEN (real and still present)

| # | Finding | Severity | Status | Wave1 | Wave2 | Location | Note/Recommendation |
|---|---|---|---|---|---|---|---|
| O1 | **`preEmailSend` stop-signal IGNORED — documented suppression/abort seam is a silent no-op.** `sendEmail` awaits `dispatchHook('preEmailSend', …)` and discards the returned `DispatchResult`; never checks `.stopped`; falls straight through to `sender.send`. README.md:140-155 + CLAUDE.md:15,47 present suppression/abort as LIVE; docs/hooks.md:135 admits the wiring is absent (docs openly disagree). | **HIGH** | NEW (open) | **2/3 (r1 HIGH, r4 HIGH)** | `packages/email/src/sendEmail.ts:199-204` (discard); `packages/core/src/hooks/registry.ts:44-68` (dispatch DOES return `{stopped,signal}`); docs README.md:140-155, CLAUDE.md:15,47, hooks.md:135 | **Flagged prominently — biggest real finding.** A consumer/AI wiring a GDPR opt-out / bounce / unsubscribe suppression list ships a no-op; suppressed recipients still get mail, `sendEmail` returns the adapter success result, silent. Fix: `const pre = await dispatchHook('preEmailSend', …); if (pre.stopped) return { ok:false, reason:(pre.signal as {errorCode?:string}).errorCode ?? 'email.suppressed' };` BEFORE `sender.send`; add an orchestration test asserting `sender.send` isn't called + `postEmailSend` isn't dispatched. Mirrors sibling sites that honor stop signals (loadSocket/httpHandler/login `_api`). Verified: HIGH not CRITICAL because hooks.md secondary doc discloses the gap. |
| O2 | **`EmailMessage.attachments` + `headers` are typed + JSDoc-promised as adapter-forwarded, but `toProviderPayload` silently drops them (and a test pins the drop).** Core declares both fields a real contract ("adapters thread these into their provider's attachment payload" / "Adapters merge these over the headers they set themselves"); the shared mapper projects only 8 scalar fields. | medium | OPEN (known) | NEW in wave1 #-none; surfaced E14-adjacent | **3/3 (r1, r3, r4)** | `packages/email/src/adapters/providerPayload.ts:17-29` (+ `smtp.ts`, `resend.ts:71`); contract `packages/core/src/emailRegistry.ts:48-61`; test `providerPayload.test.ts` pins the drop | Verified: emailRegistry.ts:54,61 declare `attachments`/`headers`; mapper omits both (lines 13-16 comment + return at 17-29). Silent typed-contract violation — a consumer sets `attachments` (invoice) or `headers['List-Unsubscribe']`/idempotency key, type accepts it, send returns `{ok:true}`, data never reaches Resend/nodemailer (both natively support these). Fix: forward them in `toProviderPayload` + update the pinning test; OR remove/`@deprecated` the fields from `EmailMessage` so the type stops promising delivery. Do not ship a type+doc contract the adapters don't honor. |
| O3 | **`renderEmailLayout` interpolates `ctaUrl` raw into `href="${ctaUrl}"` and `accent` raw into `background:${accent}` with no escaping/validation** (every text field IS `escapeHtml`'d). Exported general-purpose helper. | medium | OPEN (known) | 2/6 as #9+#10 (cosmetic framing — re-characterized) | **2/3 (r3 MEDIUM, r4 MEDIUM)** | `packages/email/src/renderEmailLayout.ts:52-53` | Verified raw at line 52 (`background:${accent}`) + 53 (`href="${ctaUrl}"`). Built-in reset/confirm URLs are server-built so not exploitable today, but a consumer/AI passing user-derived `ctaUrl`/`accent` gets attribute-breakout (`"`) / `javascript:` link. Rule 7a: a framework-shipped "safe layout" primitive should be safe-by-default. Fix: `new URL()` scheme-allowlist + `escapeHtml(parsed.href)` for href; validate `accent` against a color regex/allowlist with default fallback. Keep raw URL only in the plain-text branch. NOTE: a test (`renderEmailLayout.test.ts:96`) currently pins raw ctaUrl to preserve `&` — encode only attribute-breaking chars, not `&`, and update that test. |
| O4 | **`resolveSender` silently falls through when an EXPLICITLY-requested `adapter` slot is unregistered** — routes through default (or `ConsoleSender` in a misconfigured prod box) while caller sees `{ok:true}`. | medium / low (rated medium by r4, low by r3) | OPEN (known) | 5/6 (#4/E4 — DEFERRED this session) | **2/3 (r3 LOW, r4 MEDIUM)** | `packages/email/src/sendEmail.ts:64-76` | Verified at 64-70: `if (input.adapter){ const named=getEmailSenderByName(input.adapter); if(named) return named; /* fall through */ }`. Confused-deputy / silent mis-delivery for security mail (login passes `adapterHint:'transactional'`). Take MEDIUM (highest). Fix: distinguish explicit `adapter` (warn under `logging.errors`, or `{ok:false, reason:'unknown-adapter'}` in a strict mode) from best-effort `adapterHint` (keep silent fall-through). See DD1 — wave-1 DEFERRED this as a documented-policy change. |
| O5 | **Unsalted recipient hash** — `sha256(address.trim().toLowerCase()).slice(0,16)`, no salt/HMAC → offline confirm-the-recipient enumeration oracle for anyone holding error-tracker data. | low | OPEN (known) | 1/6 (#8/E8 — DEFERRED) | **2/3 (r1, r4)** | `packages/email/src/sendEmail.ts:24-25` | Verified at 24-25. The `//?` comment (18-23) already scopes it as correlation, not enumeration-resistance. Fix needs an HMAC secret source + key-mgmt decision → see DD2. Partially defeats the stated "no account-existence signal" goal. |
| O6 | **`reportSendOutcome` logs UNREDACTED recipient + subject to the registered logger** (`{ to: String(message.to), subject: message.subject }`) on both success + failure — while the Sentry path redacts. Leaks PII to remote log SaaS when a Pino/Winston/Datadog logger is registered + `logging.sends`/`logging.errors` enabled. | low | NEW (open) | new | 1/3 (r1) | `packages/email/src/sendEmail.ts:149,155` | Verified: line 149 (success) + 155 (failure) pass raw `message.to`/`message.subject`; only the `captureException` path (158-166) redacts. The code comment (18-23) justifies "local server-log keeps real values" — true for console, but core supports `registerLogger`. Fix: gate raw values behind a console-logger/dev check, route through `sanitizeForLog`/`getRedactedLogKeys` (core has the machinery), or hash recipient in the logger payload too. At minimum document that `logging.*` emits raw PII. |
| O7 | **`ConsoleSender` prints recipient + body verbatim, no token/URL redaction** — the reset-template plain-text body contains the live one-time token; printed + retained in dev/CI scrollback. | low | OPEN (re-characterized) | 6/6 as #6 (phantom `redactUrlSecrets` — see FP3) | 2/3 (r4 LOW, r3 via EMAIL-05) | `packages/email/src/adapters/console.ts:13-30` | Verified: line 15 builds `body` from `message.text ?? stripped html`; line 17-27 `console.log`s `to`/`subject`/`body`. The wave-1 `redactUrlSecrets` does NOT exist (FP3); the genuine residual is "dev adapter prints token-bearing body unredacted". Low (dev-only, token short-lived). Fix: document that ConsoleSender prints the full body incl. embedded tokens and must never run where logs are retained; optionally redact high-entropy segments. |
| O8 | **No send timeout** — `sendEmail` awaits `sender.send` unbounded; a hung SMTP/Resend connection blocks the request handler (e.g. unauthenticated forgot-password) for the full socket timeout. | low | OPEN (re-characterized) | 6/6 as #5 (phantom `withSendTimeout` — see FP2) | 1/3 (r4 MEDIUM via EMAIL-05) | `packages/email/src/sendEmail.ts:204` | Verified: line 204 `await tryCatch(() => sender.send(message))` with no `Promise.race`/`AbortSignal`. The wave-1 `withSendTimeout` never existed (FP2). Genuine residual gap, OPPOSITE of wave-1's claim (no timeout at all). Low (callers run inside framework API timeout, but that won't abort the in-flight provider socket). Fix: optional `sendTimeoutMs` in `EmailConfig`, race + return `{ok:false, reason:'send-timeout'}` documented non-authoritative. |
| O9 | No CR/LF defense-in-depth on header-bound scalar fields (`to/cc/bcc/from/replyTo/subject`) — relies entirely on nodemailer/Resend to reject embedded CRLF. | low | OPEN (re-characterized) | 4/6+2/6 as #1+#2 (phantom sanitizers — see FP1) | 2/3 (r1 EMAIL-04, r4 LOW) | `packages/email/src/sendEmail.ts:93-133` (buildMessage projects verbatim), `providerPayload.ts:17-29` | Verified: no sanitizer exists (the wave-1 `sanitizeHeaderMap`/`stripCrlf` are phantom, FP1). Latent today (SDKs guard, custom headers not forwarded — O2). Becomes live IF O2 is fixed without adding key/value sanitization, or if a consumer writes a raw-MIME custom adapter. Fix: `stripCrlf` scalar fields (+ any forwarded header keys/values) once in `buildMessage` so every adapter inherits it. |

---

## NEW (wave-2 found, real, wave-1 missed) — already itemized above

- **O1 (HIGH)** — `preEmailSend` stop-signal ignored. Wave-1 entirely missed this (it audited a phantom file). The strongest NEW finding; flagged prominently.
- **O2 (MEDIUM)** — attachments/headers silent drop. Wave-1 only touched the duplication (#14), never the dropped-contract.
- **O6 (LOW)** — unredacted PII to the registered logger (r1 only).

LOW-only NEW robustness items (verified, lower priority):

| # | Finding | Severity | Status | Wave1 | Wave2 | Location | Note/Recommendation |
|---|---|---|---|---|---|---|---|
| N1 | Non-numeric `SMTP_PORT` silently becomes `NaN` port → opaque nodemailer failure at first send (empty/unset case IS handled). | low | NEW (open) | new | 1/3 (r3) | `packages/email/src/autoSelect.ts:56` | Verified: `smtpPortRaw ? Number(smtpPortRaw) : defaults.smtpPort` — `Number('smtp')` = NaN, passed to `SmtpSender({port:NaN})` unvalidated. Mirrors the package's fail-loud-at-boot philosophy (the `force=resend/smtp` guards). Fix: `if(!Number.isInteger(parsed)||parsed<=0) throw …naming the env var`. |
| N2 | Built-in templates accept zero/negative `ttlMinutes` (`num()` allows 0/negatives → "expires in 0/-5 minutes"); empty `resetUrl`/`confirmUrl` falls back to `''` → dead `href=""` CTA. | low | NEW (open) | new | 1/3 (r3) | `packages/email/src/builtInTemplates.ts:23-24,51-52,70-71` | Verified: `num` (23-24) accepts any finite number; `str(data.resetUrl,'')` (51) yields `''`. Caller-misuse only (framework login callers always pass valid values). Cosmetic/dead-button. Fix: clamp ttl to a >0 min; omit CTA (or fail) when url resolves empty. |
| N3 | Unguarded `template.render(data)` / `template.subject(data)` in `buildMessage` — a throwing consumer-override template rejects `sendEmail` instead of returning a typed `{ok:false}`, breaking the function's own "returns a typed result rather than throwing" doc contract. | low | NEW (open) | new (noted in wave-1 LOW_ANALYSIS robustness aside) | 1/3 (r1 EMAIL-09) | `packages/email/src/sendEmail.ts:107,111` | Verified: lines 107/111 called without `tryCatch`. Wave-1 LOW_ANALYSIS flagged the same as report-only "robustness". Fix: wrap in `tryCatchSync` → `{ok:false, reason:'template-render-failed', cause}`. NOTE: changing throw→typed-failure alters the error contract → treat as DD (deferred decision) per wave-1's reasoning. |

---

## DEFERRED-DECISION (real, intentionally deferred this session pending policy/ADR)

| # | Finding | Severity | Status | Wave1 | Wave2 | Location | Note/Recommendation |
|---|---|---|---|---|---|---|---|
| DD1 | `resolveSender` explicit-adapter silent fall-through (= O4) — fixing CHANGES the documented "send via fallback rather than drop" policy (comment 67-69). | medium | DEFERRED-DECISION | 5/6 (#4/E4) | 2/3 | `sendEmail.ts:64-76` | Wave-1 deferred for an ADR (explicit-vs-hint policy). Still real (O4). Needs a product call on whether an explicit-adapter miss should fail/warn. |
| DD2 | Unsalted recipient hash (= O5) — HMAC fix needs a secret source + key-rotation/cross-report-correlation decision. | low | DEFERRED-DECISION | 1/6 (#8/E8) | 2/3 | `sendEmail.ts:24-25` | Wave-1 deferred on config/key-mgmt. Still real (O5). |
| DD3 | `adapterHint` typed "Internal" but documented as consumer API (`password-reset-integration.md` shows consumers passing it; login uses it). | low (quality) | DEFERRED-DECISION | 1/6 (#19/E19) | 0/3 (not re-raised in wave-2) | `sendEmail.ts:56`; `docs/password-reset-integration.md:168-176` | Verified: line 56 comment "Internal hint used by framework callers". API-surface decision (publish-vs-internal) → deferred. |
| DD4 | Re-introduce-hardening notes: CRLF sanitization (O9), send-timeout (O8), ConsoleSender token redaction (O7), CTA-URL/accent validation (O3) are NEW features relative to the simplified tree. | low–medium | DEFERRED-DECISION (overlaps O3/O7/O8/O9) | wave-1 WONT-FIX/DEFERRED (phantom code) | — | `packages/email/src/**` | Wave-1 LOW_ANALYSIS classed these as new features (not behavior-preserving) → deferred. They remain genuine gaps (now listed OPEN as O3/O7/O8/O9 since wave-2 re-verified them against real code). The DECISION is whether to add the hardening, not whether the gap exists. |

---

## FALSE-POSITIVE (phantom code / stale assumption — re-characterized residuals tracked in OPEN)

| # | Wave-1 claim | Severity | Status | Wave1 | Wave2 | Location | Note |
|---|---|---|---|---|---|---|---|
| FP1 | `sanitizeHeaderMap` strips CR/LF from values only, keys pass through (#1); `preEmailSend` re-sanitizes only `message.headers` (#2). | medium | FALSE-POSITIVE (phantom) | 4/6 + 2/6 | 3/3 refute | `sendEmail.ts` | No `sanitizeHeaderMap`/`sanitizeHeaders`/`stripCrlf` anywhere (`grep`+`git log -S` empty across all 3 runs; re-verified). Cited lines 54-63 are the `SendEmailInput` union; 261-284 don't exist (file is 218 lines). Genuine residual = no CRLF defense at all → tracked as O9. |
| FP2 | `withSendTimeout` rejects without cancelling underlying send → retry double-send (#5). | medium | FALSE-POSITIVE (phantom) | 6/6 | 3/3 refute | `sendEmail.ts:141-150` | No `withSendTimeout`/`sendTimeoutMs` ever committed. Cited 141-150 = `normalizeSendResult`. Genuine residual = NO timeout (opposite) → tracked as O8. |
| FP3 | `ConsoleSender` `redactUrlSecrets` strips only query/fragment, not path tokens (#6). | medium | FALSE-POSITIVE (phantom) | 6/6 | 3/3 refute | `console.ts:13-16` | No `redactUrlSecrets` ever existed; `console.ts` does no redaction at all. Residual = prints token-bearing body verbatim → tracked as O7. |
| FP4 | `dispatchEarlyDrop` forwards raw `input.to` to `postEmailSend` (#7). | low | FALSE-POSITIVE (phantom) | 2/6 | 3/3 refute | `sendEmail.ts:156-163` | No `dispatchEarlyDrop`/early-drop path exists. The only `postEmailSend` dispatch (207-213) is the normal path and forwards `message` by design. No separate raw-leak path. |
| FP5 | `safeColor`/`SAFE_COLOR` regex over-permissive, "cosmetic only" (#9); `safeCtaUrl` interpolates original value not `parsed.href` (#10). | low | FALSE-POSITIVE (phantom framing) | 2/6 + 1/6 | 3/3 refute | `renderEmailLayout.ts:43-45,51-60` | No `safeColor`/`SAFE_COLOR`/`safeCtaUrl` exist. The "cosmetic-only, can't break out" framing was WRONG — `accent`/`ctaUrl` are interpolated fully raw. Re-characterized as the real O3 (MEDIUM attribute-breakout). |
| FP6 | Template render-error message logged verbatim → PII echo (#11). | low | FALSE-POSITIVE (phantom) | 1/6 | refuted (r1) | `sendEmail.ts:222-225` | No render-error try/catch / `getLogger().warn(...renderError)` exists. `template.render` is unguarded (a different, arguably worse robustness item → N3). The specific "logged verbatim" line does not exist. |
| FP7 | `getEmailConfig()` re-reads `process.env` + re-allocates per send (#12). | low | FALSE-POSITIVE (stale) | 1/6 | refuted (r1) | `emailConfig.ts` | `getEmailConfig()` returns the cached module-level `activeConfig`; no per-call env read/allocation. The placeholder-`from` env-re-read path described does not exist. |
| FP8 | Redaction split across `sendEmail.ts` + `console.ts`, no single module (#20). | low | FALSE-POSITIVE (stale premise) | 1/6 | refuted (r1) | `sendEmail.ts`, `console.ts` | `console.ts` does NO redaction now (see O7/FP3), so there is no second redaction site to centralize. Only `sendEmail.ts` holds redaction helpers. Nothing to merge today. |

### Cross-package wave-1 items (outside the email package's owned source — not re-verified here)

- #15/E15 loose `EmailModule` lazy-import type → `packages/login/**` (login cluster owns).
- #17/E17 `EmailResult.reason` open `string` not a typed union → `packages/core/src/emailRegistry.ts` (core cluster owns). Verified still an open string at emailRegistry.ts:64-66. Quality/feature idea, not a defect.
- #18/E18 built-in templates store untyped `data` forcing `str()`/`num()` coercers → verified still present (`builtInTemplates.ts:20-24`); wave-1 classed WONT-FIX (defensive coercion is correct because the registry dispatch is untyped). Not a defect.

---

## Status counts (this area)

- FIXED: 4 (F1–F4)
- OPEN: 12 (O1–O9 + N1–N3)
- NEW confirmed (subset of OPEN, wave-1 missed): O1, O2, O6, N1, N2, N3 = 6
- DEFERRED-DECISION: 4 (DD1–DD4; DD1/DD2 overlap O4/O5, DD4 overlaps O3/O7/O8/O9)
- FALSE-POSITIVE: 8 (FP1–FP8)

Most serious still-open: **O1 (HIGH)** preEmailSend stop-signal ignored — verified, prominent.
