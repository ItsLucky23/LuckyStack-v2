# email — Verified & Merged Audit Findings
Sources: reports/email.md + review/v0.2.0/* · Verified against current working tree (branch chore/package-split-prep, 2026-06-11).

## Verdict summary
21 distinct findings merged across the two scans. **CONFIRMED: 13** (the live ones), **ALREADY-FIXED: 3**, **REFUTED: 3**, **PARTIALLY-FIXED: 1**, **UNCERTAIN: 1**. The single biggest live issue is the **`preEmailSend` stop-signal being dispatched but never honored** (`sendEmail.ts:142-145`) — both scans flag it (reports Hooks / review HOK-02 High), and it remains true in current code: the `DispatchResult` is discarded and `sender.send` runs unconditionally, so every documented suppression-list / rate-limit pattern is a silent no-op. The most important thing the OLDER review scan got wrong: its two highest-leverage findings about the password-reset template (CFG-05 "framework email bypasses the template registry / built-in fallback doesn't exist" and QUA-067 "built-in `password-reset` fallback documented but missing") are now **ALREADY-FIXED** — `builtInTemplates.ts` exists with `getBuiltInEmailTemplate`, `sendEmail.ts:110` resolves it, and `login/forgotPassword.ts:97-102` dispatches via `template: 'password-reset'`. The review scan also references stale paths (`senders/console.ts` — the file is now `adapters/console.ts`), confirming it pre-dates the current tree. reports/email.md correctly REFUTED its own H1 (header-injection-as-HIGH) in its adversarial pass; I re-confirm that downgrade. Security-relevant live issues that persist: SMTP STARTTLS-downgrade default (M2), unescaped `accent`/`ctaUrl` in the layout (M1), CRLF/header-injection surface (H1, but Low not High), ConsoleSender-in-prod token leak (SEC-04 / L1), and PII in success logs (M3).

## Findings

### F1 — preEmailSend stop-signal dispatched but never honored · severity: high · status: CONFIRMED
- **Sources:** both (reports Hooks bullet 1 / review HOK-02 High)
- **Current location:** `packages/email/src/sendEmail.ts:142-147`
- **Original claim:** `sendEmail` awaits `dispatchHook('preEmailSend', …)` then unconditionally calls `sender.send`, never inspecting `DispatchResult.stopped`, so documented suppression-list / per-recipient-rate-limit patterns silently fail to block.
- **Verification (current code):** Lines 142-145 `await dispatchHook('preEmailSend', { message, adapter: sender.name });` — the return value is discarded. Line 147 `const [sendError, sendResult] = await tryCatch(...(() => sender.send(message)))` runs unconditionally. `dispatchHook` (`packages/core/src/hooks/registry.ts:52-57`) does return `{ stopped: true, signal }` on a stopping handler, so the abort plumbing exists on the core side but is unused here. CLAUDE.md:47 of the package still claims "Returning a stop signal aborts the send."
- **Verdict & why:** CONFIRMED. Exactly as both scans described; nothing changed since. The two scans agree on High — correct, because it is simultaneously an extensibility hole and a security-control (suppression-list/GDPR) gap.
- **Recommendation:** `const pre = await dispatchHook('preEmailSend', {...}); if (pre.stopped) return { ok: false, reason: pre.signal.errorCode };` before line 147; skip `postEmailSend` on the abort path; drop the "not active in this revision" caveat in `docs/hooks.md`. Add a test asserting `sender.send` is not called when a stop signal is returned.

### F2 — EmailMessage supports neither attachments nor custom headers (contract dead-end) · severity: high · status: CONFIRMED
- **Sources:** both (reports HB1 / review MIS-001 High)
- **Current location:** `packages/core/src/emailRegistry.ts:16-25`; rebuild sites `packages/email/src/sendEmail.ts:119-139`; adapters `smtp.ts:56-65`, `resend.ts:62-71`
- **Original claim:** `EmailMessage` is a closed shape (`to/subject/html/text/from/replyTo/cc/bcc`) with no `attachments`, `headers`, `inReplyTo`/`references`. Even a consumer who augments the type can't get fields through, because `sendEmail` rebuilds the message field-by-field and drops unknowns. Blocks receipts/invoices/.ics/`List-Unsubscribe`.
- **Verification (current code):** `emailRegistry.ts:16-25` is exactly `{ to, subject, html, text?, from?, replyTo?, cc?, bcc? }` — no attachments/headers. `sendEmail.ts:119-139` literally reconstructs `message` field-by-field for both template and raw paths, so any extra input field is dropped. Both adapters hard-map only the eight fields.
- **Verdict & why:** CONFIRMED. Real structural hard-block, not a missing knob. Both scans rate High; agreed.
- **Recommendation:** Add optional `attachments?`, `headers?` (and consider `inReplyTo`/`references`) to `EmailMessage` + `SendEmailInput`; thread them through `sendEmail`'s message build and both adapters (nodemailer + Resend accept them natively); ConsoleSender can print attachment filenames only.

### F3 — Auto-registered ConsoleSender in prod reports ok:true and prints reset/email-change tokens to logs · severity: high · status: CONFIRMED
- **Sources:** both (reports L1 / review SEC-04 High)
- **Current location:** `packages/email/src/register.ts:19`; `packages/email/src/autoSelect.ts:85`; `packages/email/src/adapters/console.ts:13-29`; `packages/server/src/bootstrap.ts:103-108`; guard `sendEmail.ts:90-102`
- **Original claim:** `register.ts` auto-registers `autoSelectEmailSender()` at boot; with no Resend/SMTP env it falls through to `ConsoleSender` with no `NODE_ENV` check. ConsoleSender returns `{ ok: true }` (so forgot-password reports success while sending nothing) AND `console.log`s the full body including the live tokenized reset/confirm URL. The documented `required: NODE_ENV==='production'` mitigation is defeated because `required` only fires when NO sender is registered, and ConsoleSender IS registered.
- **Verification (current code):** `register.ts:19` `registerEmailSender(autoSelectEmailSender());` confirmed. `autoSelect.ts:85` `return ConsoleSender({ from });` with no env/NODE_ENV guard. `console.ts:15` builds `body = message.text ?? message.html.replaceAll(...)` and `console.log`s recipient + subject + first 400 chars (the password-reset template puts `resetUrl` in both CTA and outro — `builtInTemplates.ts:57-59`). `sendEmail.ts:90-95`: the `config.required` throw is gated on `if (!sender)` — a registered ConsoleSender bypasses it entirely. `bootstrap.ts:103-108` auto-imports the register side-effect. All confirmed.
- **Verdict & why:** CONFIRMED, High. The review's severity (High) beats reports' rating (Low, because reports framed it only as the ConsoleSender-prints angle and missed the silent-success + defeated-mitigation compounding). The review analysis is the more complete one. reports' note that `force=`-path docs claim "never silently falls through to ConsoleSender in production" being false for the auto-wire path is accurate.
- **Recommendation:** In `autoSelectEmailSender` (or `register.ts`): when `force` unset, no provider env matches, and `NODE_ENV==='production'`, throw or `getLogger().error(...)`, gated by a new `emailConfig.allowConsoleInProduction` (default false). Also redact token-bearing URLs in ConsoleSender output.

### F4 — Subject/header injection via unescaped subjects + raw from/to/cc passthrough (no CRLF stripping) · severity: low · status: CONFIRMED (downgraded from High)
- **Sources:** reports (H1) — re-verified
- **Current location:** `packages/email/src/sendEmail.ts:121,124,132,135`; `builtInTemplates.ts:47,66`; `adapters/smtp.ts:56-65`
- **Original claim:** No CR/LF stripping is applied to `subject`/`from`/`replyTo`/`to`/`cc`/`bcc` before they reach `transporter.sendMail`, a classic SMTP header-injection vector for any consumer who can influence `brand`/`from`/`cc` (e.g. multi-tenant).
- **Verification (current code):** Confirmed no CRLF sanitization anywhere in `sendEmail` or the adapters; subjects are built directly from `data.brand` (`builtInTemplates.ts:47`). However: (a) nodemailer internally rejects/encodes CR/LF in header fields, (b) the login package validates emails upstream via `validator`, and (c) no current consumer wires attacker-controlled `from`/`cc`. reports' own adversarial pass already REFUTED this as a HIGH ("exploitability overstated" — Verdict line 83).
- **Verdict & why:** CONFIRMED-as-defect but **Low**, not High. The raw passthrough is real and the framework shouldn't rely on the adapter, but the practical exploit path is gated by nodemailer's own defenses and upstream validation. reports was right to downgrade it in its verification section; I carry that forward.
- **Recommendation:** Strip CR/LF from `subject`/`from`/`replyTo` and each `to`/`cc`/`bcc` entry at the `sendEmail` boundary (defense-in-depth, don't rely on the adapter); document the guarantee.

### F5 — renderEmailLayout interpolates `accent` and `ctaUrl` into HTML without escaping · severity: medium · status: CONFIRMED
- **Sources:** reports (M1)
- **Current location:** `packages/email/src/renderEmailLayout.ts:52-53`
- **Original claim:** `background:${accent}` and `href="${ctaUrl}"` are injected raw; only `title/intro/outro/footer/brand/ctaLabel` go through `escapeHtml`. `accent='red"><script>…'` or a `"`-bearing `ctaUrl` breaks out of the attribute; `javascript:` URLs are not rejected.
- **Verification (current code):** Confirmed line-for-line: `safeTitle/safeIntro/safeOutro/safeFooter/safeBrand/safeCtaLabel` all run through `escapeHtml` (lines 41-46), but line 52 `background:${accent}` and line 53 `href="${ctaUrl}"` use the raw values. No color-pattern validation on `accent`, no scheme check on `ctaUrl`.
- **Verdict & why:** CONFIRMED, Medium. The built-in password-reset template feeds a fully user-influenced `resetUrl` into `ctaUrl` (`builtInTemplates.ts:58`). Email-client sandboxing mitigates script execution, but markup injection / link spoofing is real for any brandable/multi-tenant consumer.
- **Recommendation:** Validate `accent` against a strict color pattern (`#[0-9a-fA-F]{3,8}` or named-color allowlist); validate `ctaUrl` is `http(s):` absolute and attribute-encode `"`. At minimum document `accent` as unescaped alongside `ctaUrl`.

### F6 — SMTP adapter offers no requireTLS; STARTTLS downgrade silently allowed · severity: medium · status: CONFIRMED
- **Sources:** reports (M2) — overlaps review CFG-13 (transport-options gap)
- **Current location:** `packages/email/src/adapters/smtp.ts:44` (transport built from `smtpConfig` = `{ host, port, secure, auth }` only)
- **Original claim:** With `secure:false` (the default for port 587 / `SMTP_SECURE` unset) nodemailer attempts STARTTLS but silently falls back to plaintext if the server doesn't advertise it — sending credentials + bodies in cleartext. No `requireTLS`/`tls`/cert-validation option exposed.
- **Verification (current code):** `SmtpSender` destructures `{ from, ...smtpConfig }` from `{ host, port, secure?, auth?, from? }` and passes `smtpConfig` straight to `factory(smtpConfig)` (line 44). No `requireTLS`, no `tls`, no passthrough. `autoSelect.ts:48` sets `secure: process.env[...] === 'true'` (default false). Confirmed.
- **Verdict & why:** CONFIRMED, Medium. Insecure default for a credential-bearing connection. This is the security-default half; CFG-13 (F13) is the broader extensibility half of the same closed-shape root cause.
- **Recommendation:** Expose `requireTLS` (default true when `secure` is false) + a `tls` passthrough on `SmtpSenderOptions`, surfaced via env (`SMTP_REQUIRE_TLS`). Fixing F13 (transportOptions passthrough) covers this too.

### F7 — Success/failure log line records full recipient + subject in plaintext · severity: medium · status: CONFIRMED
- **Sources:** reports (M3)
- **Current location:** `packages/email/src/sendEmail.ts:162` (success) and `:168` (failure)
- **Original claim:** The failure path redacts to Sentry (hashed recipient, length-only subject) but the LOCAL logger gets the raw recipient + subject on every success (when `logging.sends`) and every failure — PII + account-existence signal in retained logs, weakening the login flow's anti-enumeration posture.
- **Verification (current code):** Line 162 `getLogger().info(..., { to: String(message.to), subject: message.subject, id: result.id })` and line 168 `getLogger().warn(..., { to: String(message.to), subject: message.subject, reason })` both pass raw values. The redaction helpers `hashRecipient`/`redactSubject` (lines 24-32) are applied ONLY to the `captureException` call (lines 174-177), not to the logger. Confirmed.
- **Verdict & why:** CONFIRMED, Medium. The redaction is deliberately scoped to the external tracker (comment lines 18-23), but `getLogger()` may forward to retained external sinks.
- **Recommendation:** Honor `registerRedactedLogKeys` (core supports it) for `to`/`subject`, or reuse `hashRecipient`/`redactSubject` for the logger payload, or gate raw-recipient logging behind an explicit opt-in.

### F8 — Consumer template.render()/subject() throws escape sendEmail, breaking its no-throw contract · severity: medium · status: CONFIRMED
- **Sources:** review (QUA-032 Medium)
- **Current location:** `packages/email/src/sendEmail.ts:118,121` (contract comment lines 82-85)
- **Original claim:** `template.render(data)` and `template.subject(data)` are called outside any tryCatch, while the function contract promises "Returns a typed result rather than throwing." A consumer template doing `(data.items as X[]).map(...)` on a malformed payload throws straight out of e.g. a password-reset handler.
- **Verification (current code):** Lines 118 `const rendered = template.render(data);` and 121 `subject: template.subject(data),` are outside any tryCatch (the only `tryCatch` wraps `sender.send` at line 147). Adapter throws are normalized (line 148-150), hook throws are isolated in the registry — but template render/subject are the one piece of third-party code in the pipeline that can crash the caller. Confirmed.
- **Verdict & why:** CONFIRMED, Medium. Accurate; the no-throw contract has a real hole for consumer-registered templates.
- **Recommendation:** Wrap subject/render in tryCatch and return `{ ok: false, reason: 'template-render-failed', cause: error }` (+ captureException with the template name); document the new reason in `docs/error-handling.md`.

### F9 — no-sender / no-template early returns bypass both email hooks · severity: medium · status: CONFIRMED
- **Sources:** review (HOK-08 Medium)
- **Current location:** `packages/email/src/sendEmail.ts:101` (no-sender) and `:115` (no-template)
- **Original claim:** Both early returns happen BEFORE the `preEmailSend` dispatch, so neither `preEmailSend` nor `postEmailSend` fires for dropped messages — breaking the docs' own DLQ/alerting pattern D, which tells consumers to alert when `postEmailSend` delivers a reason in `{'no-sender','no-template','missing-from'}`.
- **Verification (current code):** Line 101 `return { ok: false, reason: 'no-sender' };` and line 115 `return { ok: false, reason: 'no-template' };` both sit above the `dispatchHook('preEmailSend', …)` at line 142. So those two reasons can never reach a `postEmailSend` handler. (`missing-from` originates inside the adapters AFTER dispatch, so that one does fire postEmailSend.) Confirmed.
- **Verdict & why:** CONFIRMED, Medium. Accurate observability gap that contradicts the package's own docs.
- **Recommendation:** Dispatch `postEmailSend` with `{ message: <partial>, adapter: 'none', ok: false, reason }` in the early-return paths, or document the bypass and fix pattern D.

### F10 — sendEmail orchestrator has no direct test coverage · severity: medium · status: PARTIALLY-FIXED
- **Sources:** review (QUA-031 Medium) — overlaps reports code-quality bullet 1
- **Current location:** `packages/email/src/sendEmail.ts` (no `sendEmail.test.ts`); partial coverage in `packages/email/src/sendEmailTemplateResolution.test.ts`
- **Original claim:** Every leaf module (console/resend/smtp/autoSelect/emailConfig/renderEmailLayout/templates) is tested but `sendEmail.ts` has zero tests; untested security-relevant behavior includes PII redaction before Sentry, sender-resolution precedence, the required-throw policy, hook dispatch, and the no-sender/no-template early returns.
- **Verification (current code):** There is no `sendEmail.test.ts`, BUT `sendEmailTemplateResolution.test.ts` now exists and exercises the template-resolution path of `sendEmail` (consumer registry → built-in fallback → no-template). The security-critical paths the review listed — redaction before `captureException`, resolution precedence (adapter→adapterHint→default→legacy), `required:true` throw vs soft no-sender, and hook payloads — remain untested.
- **Verdict & why:** PARTIALLY-FIXED. The most important gap (redaction regression test + resolution precedence + required policy) is still open; only the template-resolution slice gained coverage since the scan.
- **Recommendation:** Add `sendEmail.test.ts` covering: (1) redacted to/cc/bcc + subject reach `captureException` (mock core), (2) resolution precedence, (3) `required:true` throws vs soft no-sender, (4) pre/post hook payloads + ordering.

### F11 — EMAIL_FROM / emailConfig.from dual-config disagreement (adapter default is dead in the sendEmail path) · severity: low · status: CONFIRMED
- **Sources:** reports (Missing-config bullet 1)
- **Current location:** `packages/email/src/sendEmail.ts:124,135`; `emailConfig.ts:64`; `adapters/smtp.ts:51`, `resend.ts:57`; `autoSelect.ts:51-53`
- **Original claim:** `sendEmail` always fills `from: input.from ?? config.from`, and `config.from` defaults to `'noreply@example.com'`, so the adapter's `EMAIL_FROM`-derived `defaultFrom` is dead in the `sendEmail` path. A consumer who sets `EMAIL_FROM` but not `emailConfig.from` sends from `noreply@example.com`.
- **Verification (current code):** Lines 124 and 135 both `from: input.from ?? config.from`. `emailConfig.ts:64` `from: 'noreply@example.com'`. `autoSelect.ts:51,53` reads `EMAIL_FROM` into the adapter's `from`, and `smtp.ts:51`/`resend.ts:57` apply `message.from ?? defaultFrom` — but `message.from` is always pre-filled by `sendEmail`, so `defaultFrom` never wins. Confirmed: the two config surfaces silently disagree.
- **Verdict & why:** CONFIRMED, Low. A real foot-gun (wrong sender address) but not a security/availability issue.
- **Recommendation:** Make `emailConfig.from` default to the `EMAIL_FROM` env at config-resolution, or have `autoSelect`/`register.ts` set `emailConfig.from` so the two surfaces converge.

### F12 — registerEmailConfig merges onto DEFAULT_EMAIL_CONFIG, not active config (second call wipes overrides) · severity: low · status: CONFIRMED
- **Sources:** review (QUA-068 Low)
- **Current location:** `packages/email/src/emailConfig.ts:88-90`
- **Original claim:** `activeConfig = deepMerge(DEFAULT_EMAIL_CONFIG, config)` resets to defaults on every call; with the 0.2.0 overlay model two call sites (server.ts + a `luckystack/email/*.ts` overlay) are natural, and the second silently wipes the first. presence shares the pattern, so it's a deliberate footgun not a bug.
- **Verification (current code):** Line 89 `activeConfig = deepMerge(DEFAULT_EMAIL_CONFIG, config);` — confirmed it merges onto the constant default, not `activeConfig`. "Replace, not accumulate" semantics are undocumented in the JSDoc.
- **Verdict & why:** CONFIRMED, Low. Accurate; cross-package pattern (also presence), so treat as a documented-or-fixed-everywhere decision.
- **Recommendation:** Either merge onto `activeConfig` across email + presence for parity, or document "call exactly once; later calls replace" in every `register*Config` JSDoc.

### F13 — SmtpSenderOptions cannot carry nodemailer transport options (TLS/pool/timeouts/DKIM) · severity: medium · status: CONFIRMED
- **Sources:** review (CFG-13 Medium) — shares root cause with reports M2 (F6) + reports missing-config (pooling/timeout)
- **Current location:** `packages/email/src/adapters/smtp.ts:5-15,44`
- **Original claim:** `SmtpSenderOptions` is a closed shape; only `{ host, port, secure, auth }` reach `createTransport`. The documented headline audience (self-hosters, AWS SES via SMTP, on-prem relay) needs `tls:{rejectUnauthorized:false}`, `pool:true`, `connectionTimeout`, `dkim`, `requireTLS` — none passable. The env auto-wire path is similarly locked.
- **Verification (current code):** Interface lines 5-15 = `{ host, port, secure?, auth?, from? }`. Line 30 destructures `from` out and passes the rest as `smtpConfig` to `factory(smtpConfig)` (line 44) — no passthrough field, no pool/timeout/tls. Confirmed; also covers reports' "no pooling" and "no SMTP send timeout" sub-findings.
- **Verdict & why:** CONFIRMED, Medium. Real extensibility gap forcing a full adapter fork for common on-prem relay needs. Subsumes F6's security-default concern.
- **Recommendation:** Add `transportOptions?: Record<string, unknown>` shallow-merged into the createTransport config (explicit fields win) + an `emailConfig.smtp.transportOptions` knob so the autoSelect/register path carries it.

### F14 — autoSelectEmailSender passes NaN as SMTP port when the port env var is non-numeric · severity: low · status: CONFIRMED
- **Sources:** review (QUA-069 Low)
- **Current location:** `packages/email/src/autoSelect.ts:56`
- **Original claim:** `const resolvedSmtpPort = smtpPortRaw ? Number(smtpPortRaw) : defaults.smtpPort;` — `SMTP_PORT="2525;"` yields NaN, surfacing only as an opaque connection error at first send, breaking the package's otherwise fail-fast posture.
- **Verification (current code):** Line 56 is verbatim as quoted; `Number("2525;")` → NaN, flows into `buildSmtp` → `SmtpSender({ port: NaN, ... })` → nodemailer. No validation. Confirmed.
- **Verdict & why:** CONFIRMED, Low. Accurate; one misconfiguration class escapes the fail-fast design.
- **Recommendation:** `const n = Number(smtpPortRaw); if (Number.isNaN(n) || n <= 0) throw new Error(...)` — consistent with the existing force-mode boot errors.

### F15 — No send timeout on the Resend adapter (hung provider stalls the calling request) · severity: low · status: CONFIRMED
- **Sources:** review (CFG-36 Low) — overlaps reports missing-config "no send timeout"
- **Current location:** `packages/email/src/adapters/resend.ts:62`; also `smtp.ts:56`; `sendEmail.ts` (no pipeline timeout)
- **Original claim:** `await client.emails.send({...})` has no timeout/AbortSignal; login's `forgotPassword` awaits `sendEmail` inside the API request, so a hung Resend endpoint holds the password-reset request open. nodemailer has internal default timeouts so SMTP is less exposed.
- **Verification (current code):** `resend.ts:62` `const { data, error } = await client.emails.send({...})` — no AbortSignal, no race. No `timeoutMs` anywhere in `sendEmail` or `emailConfig`. Confirmed.
- **Verdict & why:** CONFIRMED, Low. Real but low-likelihood; rate limiting bounds concurrent resets.
- **Recommendation:** Add `emailConfig.sendTimeoutMs` (default ~15000) enforced in `sendEmail` around `sender.send` via Promise.race/AbortSignal, returning `{ ok: false, reason: 'send-timeout' }` — one knob covers all adapters.

### F16 — renderEmailLayout hardcodes lang="en" and the full palette/width · severity: low · status: CONFIRMED
- **Sources:** review (CFG-35 Low)
- **Current location:** `packages/email/src/renderEmailLayout.ts:60` (palette literals lines 66-89)
- **Original claim:** `<html lang="en">`, body/card backgrounds, width 560, all text colors and the border are literals; only `accent` and `brand` are parameters. A Dutch product's framework reset/email-change emails declare `lang="en"`; a dark-branded product can't adjust the palette.
- **Verification (current code):** Line 60 `<html lang="en">`; lines 66-89 contain hardcoded `#f5f5f5`, `560`, `#1E1F21`/`#454648`/`#6b7280`/`#9ca3af`, `#e5e5e5`, `#ffffff`. Only `accent` (param, default `#3B82F6`) and `brand` are configurable. Confirmed.
- **Verdict & why:** CONFIRMED, Low. Mitigated by consumers being able to write fully custom templates — but the framework-internal login emails use this helper, so today changing lang/colors means overriding the whole flow.
- **Recommendation:** Add optional `lang?: string` (default `'en'`) and a `theme?: {...}` field to `RenderEmailLayoutInput`; have login's forgotPassword/emailChangeNotification forward a configurable value (e.g. `projectConfig.defaultLanguage`).

### F17 — No way to mutate/observe the final provider payload; no per-send transport override · severity: low · status: CONFIRMED
- **Sources:** reports (Hooks bullets 2-3)
- **Current location:** `packages/email/src/sendEmail.ts:142-145`, `hookPayloads.ts`
- **Original claim:** `preEmailSend` exposes `message` but there is no hook/seam between message-build and provider call to add provider-specific fields (Resend tags, SMTP headers); and a consumer can only pick a registered slot via `adapter`/`adapterHint`, not pass a one-off transport.
- **Verification (current code):** `preEmailSend` payload is `{ message, adapter }`; `message` is a plain object so in-place mutation is technically possible, but there's no provider-passthrough field for it to set (ties to F2). `resolveSender` (lines 64-76) only resolves named slots — no per-send transport option. Confirmed.
- **Verdict & why:** CONFIRMED, Low. Extensibility gap; largely subsumed by F2 (add `headers`/passthrough to the message type) once that lands.
- **Recommendation:** Fix F2 first (gives `preEmailSend` mutators a passthrough to set). A one-off transport override is lower priority.

### F18 — CLAUDE.md / function index points sendEmail+registerEmailConfig at a non-existent docs/sending.md · severity: low · status: CONFIRMED
- **Sources:** reports (Docs-gaps bullet 4)
- **Current location:** `packages/email/CLAUDE.md` Function Index rows (`-> docs/sending.md`)
- **Original claim:** The CLAUDE.md function index points the two most important exports (`sendEmail`, `registerEmailConfig`) to `docs/sending.md`, which doesn't exist (only adapters/error-handling/hooks/password-reset-integration/templates).
- **Verification (current code):** `packages/email/CLAUDE.md` Function Index rows for `sendEmail`, `registerEmailConfig`, `getEmailConfig`, `DEFAULT_EMAIL_CONFIG` all link `-> docs/sending.md`. The package `docs/` dir does not contain `sending.md`. Confirmed.
- **Verdict & why:** CONFIRMED, Low. Broken doc reference for the package's primary exports.
- **Recommendation:** Create `docs/sending.md` or repoint those rows to `docs/error-handling.md` / the README.

### F19 — Framework reset/email-change copy bypasses the registerEmailTemplate override registry · severity: high · status: ALREADY-FIXED
- **Sources:** review (CFG-05 High)
- **Current location:** `packages/login/src/forgotPassword.ts:97-102`; `packages/email/src/sendEmail.ts:110`; `packages/email/src/builtInTemplates.ts`
- **Original claim:** `sendPasswordResetEmail` builds the email inline via `renderEmailLayout` and passes raw html/text, never dispatching by template name; no built-in `password-reset` template is registered, so the documented `registerEmailTemplate('password-reset', …)` override is unreachable.
- **Verification (current code):** `forgotPassword.ts:97-102` now dispatches `sendEmail({ to, template: 'password-reset', data: { resetUrl, userName, brand, ttlMinutes }, adapterHint: 'transactional' })` — NOT inline. `sendEmail.ts:110` resolves `getEmailTemplate(input.template) ?? getBuiltInEmailTemplate(input.template)`, and `builtInTemplates.ts:84-91` provides the built-in `password-reset` + `email-change` templates via `getBuiltInEmailTemplate`. The override contract is now real: a consumer `registerEmailTemplate('password-reset', …)` wins (consumer registry checked first). The code comment at `forgotPassword.ts:90-96` explicitly cites CFG-05.
- **Verdict & why:** ALREADY-FIXED. This is the clearest case of the older review scan pre-dating a fix (likely commit 302cbf1 / the v0.2.0 template work). The review was correct at scan time but is stale now.
- **Recommendation:** None for the code. The review's recommendation has been implemented.

### F20 — templates.ts header documents a built-in password-reset fallback that does not exist · severity: low · status: ALREADY-FIXED
- **Sources:** review (QUA-067 Low)
- **Current location:** `packages/email/src/templates.ts:6-14`; `sendEmail.ts:110`; `builtInTemplates.ts:84-91`
- **Original claim:** The module comment claims unregistered templates fall back to a built-in (`password-reset`), but no such fallback exists — `sendEmail` returns `{ ok:false, reason:'no-template' }` for any unregistered name.
- **Verification (current code):** The fallback NOW exists. `templates.ts:11-13` documents resolution step 2 (built-in fallback for `password-reset`/`email-change`), and that is backed by real code: `sendEmail.ts:110` calls `getBuiltInEmailTemplate(input.template)` when the consumer registry misses, and `builtInTemplates.ts` implements both. The in-source comment and the code now agree.
- **Verdict & why:** ALREADY-FIXED. Same stale-scan root cause as F19.
- **Recommendation:** None.

### F21 — README documents a non-existent email.appUrl config key · severity: low · status: REFUTED (for the actual link-base path) / partially still a docs nit
- **Sources:** reports (Missing-config + Docs-gaps mentions of `appUrl`)
- **Current location:** `packages/email/README.md` config example; truth: `forgotPassword.ts:85` uses `config.app.publicUrl`
- **Original claim:** `EmailConfig` has no `appUrl`; the README config example shows an `appUrl` key, and the reset/confirm link base actually comes from core's `app.publicUrl`.
- **Verification (current code):** `EmailConfig` (`emailConfig.ts:43-61`) indeed has no `appUrl` — confirmed the type never had it. The functional claim that the link base comes from `app.publicUrl` is CORRECT (`forgotPassword.ts:85` `config.app.publicUrl`). So there is no functional defect; the only live issue would be a stray `appUrl` in the README prose. I could not confirm the README still shows it (the example may have been corrected alongside the F19/F20 template work).
- **Verdict & why:** REFUTED as a code/config defect (the key never existed on the type and the link base is sourced correctly). At most a residual README wording nit — UNCERTAIN whether the README line still mentions `appUrl`; if it does, it's a Low docs fix.
- **Recommendation:** Grep `packages/email/README.md` for `appUrl`; if present, remove it and point readers to core's `app.publicUrl`.

### F22 — Adapter from-default logic is dead but duplicated · severity: low · status: CONFIRMED (minor)
- **Sources:** reports (Code-quality bullet 2)
- **Current location:** `packages/email/src/adapters/smtp.ts:51-54`, `resend.ts:57-60`
- **Original claim:** Both adapters implement `message.from ?? defaultFrom` with a `missing-from` guard that can never trigger via `sendEmail` (since `from` is always pre-filled).
- **Verification (current code):** `smtp.ts:51-54` and `resend.ts:57-60` both have the `const fromAddress = message.from ?? defaultFrom; if (!fromAddress) return { ok:false, reason:'missing-from' };` branch. Because `sendEmail` always sets `from` (F11), the guard is dead on the primary path (live only if an adapter is called directly bypassing `sendEmail`). Confirmed.
- **Verdict & why:** CONFIRMED, Low/minor. Dead branch on the main path; tied to the F11 dual-config issue.
- **Recommendation:** Resolve together with F11 — either stop pre-filling `from` in `sendEmail` (so the adapter default becomes live) or accept the guard as defense-for-direct-callers and document it.

### F23 — tryCatch used in SMTP but not in Resend (inconsistent throw normalization) · severity: low · status: CONFIRMED
- **Sources:** reports (Code-quality bullet 3)
- **Current location:** `packages/email/src/adapters/resend.ts:56,62`; `smtp.ts:56`
- **Original claim:** `smtp.ts` wraps `sendMail` in `tryCatch`; `resend.ts` calls `client.emails.send` bare, so a throw from the resend client escapes the adapter and is only caught by the outer `tryCatch` in `sendEmail`.
- **Verification (current code):** `smtp.ts:56` `const [error, info] = await tryCatch(() => transporter.sendMail({...}))`. `resend.ts:56` `const client = await clientPromise;` then line 62 `const { data, error } = await client.emails.send({...})` — bare, no tryCatch (also the `await clientPromise` itself can reject). It is caught by the outer `tryCatch` at `sendEmail.ts:147`, so it works, but the two sibling adapters normalize throws at different layers. Confirmed.
- **Verdict & why:** CONFIRMED, Low. Cosmetic inconsistency; functionally safe because of the outer tryCatch.
- **Recommendation:** For parity, wrap the resend `await clientPromise` + `client.emails.send` in `tryCatch` and return `{ ok:false, reason, cause }` — mirroring the SMTP adapter.
