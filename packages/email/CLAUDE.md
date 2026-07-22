# @luckystack/email

> AI summary + function INDEX. For deep specs see `docs/` next to this file.

## What this package does

Pluggable transactional email for LuckyStack. Ships three built-in adapters (`ConsoleSender`, `ResendSender`, `SmtpSender`) registered through `@luckystack/core`'s sender registry, a tiny `renderEmailLayout` helper for one-CTA HTML+text emails, a named template registry, and `preEmailSend` / `postEmailSend` hooks. Optional package — install only when the framework's password-reset flow needs to send mail or when the project sends its own transactional messages.

## When to USE this package

- The project enables `forgotPassword: 'framework'` in `@luckystack/login` and needs real outbound mail.
- The project sends its own transactional emails (welcome, invite, receipt) and wants a unified adapter + hook surface instead of calling Resend/nodemailer directly.
- Multiple adapters need to coexist (e.g. `'transactional'` slot for password resets, `'marketing'` slot for invites) — use the named-sender registry via `registerEmailSenders({...})`.
- An installer needs to rename email-related env vars without forking the framework (`emailConfig.envVars`).
- The project needs `preEmailSend` suppression-list logic, or `postEmailSend` audit/DLQ wiring.

## When to NOT suggest this (yet)

- The project is content with `forgotPassword: 'disabled'` or `'custom'` and does not send transactional mail — keep `@luckystack/email` out of dependencies entirely.
- The project already imports `resend` / `nodemailer` directly and does not need hooks, registry, templates, or Sentry capture — adding this package is a wrapper for no gain.
- Bulk / marketing email (newsletters, drip campaigns). This package targets transactional mail; use a dedicated ESP SDK for bulk and only wire its delivery receipts through `postEmailSend` if needed.
- Inbound email parsing — out of scope. Use a provider webhook directly.

## Function Index

| Function / Export | 1-liner | Deep doc |
|---|---|---|
| `sendEmail(input)` | Send via the resolved sender; supports raw/template input plus optional `signal` + stable `idempotencyKey`. Timeout/late abort returns `deliveryOutcome: 'unknown'`; retry only with the same key. | -> docs/sending.md |
| `renderEmailLayout({ title, intro, ctaLabel?, ctaUrl?, outro?, footer?, brand?, accent? })` | Render inline-styled HTML + plain-text fallback with optional CTA button. | -> docs/templates.md |
| `ConsoleSender(options?)` | Dev-mode adapter. Logs to terminal, never sends real mail. Returns `EmailSender`. | -> docs/adapters.md |
| `ResendSender({ apiKey, from? })` | Production adapter using `resend` SDK (lazy peer-dep). | -> docs/adapters.md |
| `SmtpSender({ host, port, secure?, auth?, from? })` | SMTP adapter using `nodemailer` (lazy peer-dep). | -> docs/adapters.md |
| `autoSelectEmailSender(options?)` | Pick `Resend -> SMTP -> Console` based on env. Supports `{ force }`. | -> docs/adapters.md |
| `registerEmailTemplate(name, template)` | Register or override a named template (`{ subject, render }`). Returns the previous entry. | -> docs/templates.md |
| `getEmailTemplate(name)` | Read a registered template by name. | -> docs/templates.md |
| `listEmailTemplates()` | Alphabetical list of registered template names. | -> docs/templates.md |
| `resetEmailTemplatesForTests()` | Clear the template registry. Test-only. | -> docs/templates.md |
| `registerEmailConfig(input)` | Deep-merge config overrides (`from`, `required`, `logging`, `envVars`, `defaults`). | -> docs/sending.md |
| `getEmailConfig()` | Read the merged active config. | -> docs/sending.md |
| `DEFAULT_EMAIL_CONFIG` | The baseline config object before any overrides. | -> docs/sending.md |
| `registerEmailSender(sender)` | Register the legacy single sender (re-export from `@luckystack/core`). | -> docs/adapters.md |
| `registerEmailSenders({ default?, transactional?, marketing?, ... })` | Register multiple named senders at once (re-export). | -> docs/adapters.md |
| `getEmailSender()` | Read the legacy default sender (re-export). | -> docs/adapters.md |
| `getEmailSenderByName(name)` | Read a named sender from the registry (re-export). | -> docs/adapters.md |
| `listEmailSenderNames()` | List every registered sender name (re-export). | -> docs/adapters.md |
| `isEmailSenderRegistered()` | True when any sender is registered (re-export). | -> docs/adapters.md |
| Hook `'preEmailSend'` | Fires before each adapter send. Payload: `{ message, adapter }`. Returning a stop signal aborts the send. | -> docs/hooks.md |
| Hook `'postEmailSend'` | Fires after each send attempt. Payload: `{ message, adapter, ok, messageId?, reason? }`. | -> docs/hooks.md |

### Exported types

| Type | Source | Purpose |
|---|---|---|
| `SendEmailInput` | `./sendEmail` | Discriminated union: raw `{ subject, html }` vs `{ template, data }`. |
| `EmailTemplate<TData>` | `./templates` | `{ subject(data), render(data) }`. |
| `EmailConfig`, `EmailConfigInput`, `EmailLoggingConfig`, `EmailEnvVarsConfig`, `EmailDefaultsConfig` | `./emailConfig` | Config shape + deep-partial input. |
| `RenderEmailLayoutInput`, `RenderedEmail` | `./renderEmailLayout` | Layout helper input/output. |
| `AutoSelectEmailSenderOptions` | `./autoSelect` | `{ from?, force? }`. |
| `EmailSender`, `EmailSendContext`, `EmailMessage`, `EmailResult`, `EmailDeliveryOutcome`, `EmailSenderRegistry` | Re-exported from `@luckystack/core` | Adapter contract, cancellation/idempotency context, and outcome-aware result. |
| `PreEmailSendPayload`, `PostEmailSendPayload` | `./hookPayloads` | Hook payload shapes (also augmented onto `HookPayloads`). |

## Config keys

Configured via `registerEmailConfig({...})` (deep-merged on top of `DEFAULT_EMAIL_CONFIG`):

| Key | Default | Purpose |
|---|---|---|
| `from` | `'noreply@example.com'` | Default sender address when a message omits `from`. |
| `required` | `false` | When `true`, `sendEmail` throws if no sender is registered; otherwise returns `{ ok: false, reason: 'no-sender' }`. |
| `logging.errors` | `true` | Terminal warning on send failure. |
| `logging.sends` | `false` | Terminal info line per successful send. |
| `envVars.resendApiKey` | `'RESEND_API_KEY'` | Env var read by `autoSelectEmailSender` for Resend. |
| `envVars.smtpHost` / `smtpPort` / `smtpSecure` / `smtpUser` / `smtpPass` | `'SMTP_HOST'` / `'SMTP_PORT'` / `'SMTP_SECURE'` / `'SMTP_USER'` / `'SMTP_PASS'` | Env vars read by `autoSelectEmailSender` for SMTP. |
| `envVars.emailFrom` | `'EMAIL_FROM'` | Env var fallback for the default `from` address. |
| `defaults.smtpPort` | `587` | Fallback SMTP port when the env var is unset. |
| `sendTimeoutMs` | `30_000` | Max wait for one send. On expiry the adapter signal aborts and result is `{ ok:false, reason:'send-timeout', deliveryOutcome:'unknown' }`; provider delivery may already have happened. Set `false` to disable. |
| `recipientHmacKey` | `undefined` | HMAC-SHA-256 key for recipient hashing in error-tracker + log contexts. When unset, falls back to un-keyed SHA-256 with a one-time dev warning. Set to `''` to silence the warning and keep un-keyed hashing (document the tradeoff). (EMAIL-O5). |

Environment variables read at adapter-selection time (names overridable via `envVars` above):

- `RESEND_API_KEY` — selects `ResendSender` when set.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` — select `SmtpSender` when `SMTP_HOST` is set.
- `EMAIL_FROM` — populates the adapter's default `from` if `autoSelectEmailSender` wasn't given a `from` option.

If no env var matches, `autoSelectEmailSender` returns `ConsoleSender`.

## Peer dependencies

- `@luckystack/core` — runtime dep (registry, hooks, logger, Sentry capture, `tryCatch`).
- `resend` — **optional peer**. Required only when `ResendSender` is registered. Lazy-imported on first send.
- `nodemailer` (+ `@types/nodemailer` in dev) — **optional peer**. Required only when `SmtpSender` is registered. Lazy-imported on first send.
- For non-`ConsoleSender` use, at least one of `resend` or `nodemailer` must be installed. `ConsoleSender` needs nothing extra.

Peer-dep guard policy: setting an adapter's env keys (e.g. `RESEND_API_KEY`) without the corresponding peer installed will fail loudly at send time — never silent fallthrough.

## Related

- Architecture deep-dive: `/docs/ARCHITECTURE_EMAIL.md` (full lifecycle + forgot-password modes), `/docs/ARCHITECTURE_AUTH.md` (login consumer).
- Sister package: `@luckystack/login` (consumes `sendEmail` for password-reset when `forgotPassword: 'framework'`).
- Downstream consumer: `@luckystack/login.sendEmailChangeConfirmation` — orchestrator that lives in `@luckystack/login`, lazy-imports `@luckystack/email`, and uses `sendEmail` + `renderEmailLayout` to deliver the email-change confirmation message to the new address (with `adapterHint: 'transactional'`).
- README (consumer quickstart): `./README.md`.
