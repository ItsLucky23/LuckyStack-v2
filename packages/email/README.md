# @luckystack/email

> Pluggable transactional email for [LuckyStack](https://github.com/ItsLucky23/LuckyStack-v2). Three built-in adapters (Console, Resend, SMTP), one tiny `<CTA>` template helper, and integration with the existing notifier + Sentry hooks. Optional package — install only when you need the framework's password-reset flow or want to send transactional mail.

## Install

```bash
npm install @luckystack/email @luckystack/core
# Plus the adapter you want to use:
npm install resend                        # for ResendSender
npm install nodemailer @types/nodemailer  # for SmtpSender
# (ConsoleSender needs no extra dependency)
```

## Quickstart

Pick an adapter and register it once at server boot — before `createLuckyStackServer`:

```ts
import { registerEmailSender, ConsoleSender, ResendSender, SmtpSender } from '@luckystack/email';
import { createLuckyStackServer } from '@luckystack/server';

if (process.env.NODE_ENV === 'production' && process.env.RESEND_API_KEY) {
  registerEmailSender(ResendSender({
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM ?? 'noreply@yourdomain.com',
  }));
} else {
  registerEmailSender(ConsoleSender());
}

await createLuckyStackServer({ /* ... */ }).listen();
```

Or skip the boilerplate with `autoSelectEmailSender`, which picks the most-capable adapter your env can satisfy (`Resend → SMTP → Console`):

```ts
import { autoSelectEmailSender, registerEmailSender } from '@luckystack/email';

registerEmailSender(autoSelectEmailSender());
// Force a specific adapter (e.g. SMTP for staging tests):
// registerEmailSender(autoSelectEmailSender({ force: 'smtp' }));
```

Now anywhere — framework or project code — can call `sendEmail`:

```ts
import { sendEmail, renderEmailLayout } from '@luckystack/email';

const { html, text } = renderEmailLayout({
  brand: 'LuckyStack',
  title: 'Welcome aboard',
  intro: 'Your account is ready. Click below to log in for the first time.',
  ctaLabel: 'Open dashboard',
  ctaUrl: 'https://app.example.com/dashboard',
  footer: 'You received this because you registered an account at example.com.',
});

const result = await sendEmail({
  to: 'user@example.com',
  subject: 'Welcome aboard',
  html,
  text,
  // Reuse this exact key if the same logical email is retried.
  idempotencyKey: 'welcome:user-123:v1',
});

if (!result.ok) {
  console.error('email failed', result.reason, result.deliveryOutcome);
  // `unknown` means the provider may still deliver — never retry with a new key.
}
```

## Adapters

| Adapter | When to use | Setup |
| --- | --- | --- |
| `ConsoleSender()` | Local dev. Logs the email to terminal. Never sends real mail. | None. |
| `ResendSender({ apiKey, from })` | Production default. Free tier 3,000/mo; trivial setup. | Sign up at [resend.com](https://resend.com), verify a domain (or use `onboarding@resend.dev` for testing), copy API key. |
| `SmtpSender({ host, port, secure, auth, from })` | Self-hosters, Mailtrap testing, custom SMTP server. | Provide host/port/credentials. For Mailtrap testing: [mailtrap.io](https://mailtrap.io) → Sandbox → Inbox → SMTP Settings. |

Writing your own adapter is two methods on the `EmailSender` interface:

```ts
import type { EmailSender } from '@luckystack/email';

export const MyCustomSender: EmailSender = {
  name: 'my-custom',
  send: async (message, context) => {
    // Pass context?.signal + context?.idempotencyKey when your provider supports them.
    // Return { ok: true, id: '...' } or a typed failure; do not throw.
  },
};
```

## Configuration

Add an `email` block to `registerProjectConfig({...})`:

```ts
{
  email: {
    from: 'noreply@yourdomain.com', // default sender used if a message omits `from`
    required: false, // throw if `sendEmail` is called and no sender is registered
    logging: {
      errors: true,  // log a warning when send fails
      sends: false,  // log a concise success line per sent email
    },
    // Optional — override the env-var names autoSelectEmailSender reads:
    envVars: {
      resendApiKey: 'MY_APP_RESEND_KEY',  // default 'RESEND_API_KEY'
      smtpHost:    'MY_APP_SMTP_HOST',    // default 'SMTP_HOST'
      smtpPort:    'MY_APP_SMTP_PORT',    // default 'SMTP_PORT'
      smtpSecure:  'MY_APP_SMTP_SECURE',  // default 'SMTP_SECURE'
      smtpUser:    'MY_APP_SMTP_USER',    // default 'SMTP_USER'
      smtpPass:    'MY_APP_SMTP_PASS',    // default 'SMTP_PASS'
      emailFrom:   'MY_APP_EMAIL_FROM',   // default 'EMAIL_FROM'
    },
    // Optional — numeric defaults applied when an env var resolves to nothing:
    defaults: {
      smtpPort: 587,                       // fallback SMTP port
    },
  },
}
```

The `envVars` and `defaults` sub-blocks let installers rename the Resend/SMTP env vars without forking the framework — useful when an org enforces a per-app prefix on every secret. Both sub-shapes are exported as `EmailEnvVarsConfig` and `EmailDefaultsConfig` from `@luckystack/core`.

## Observability

Email send errors are auto-reported to Sentry **if `@luckystack/error-tracking` is installed and initialized**. No special wiring — `sendEmail` calls `captureException()` from `@luckystack/core`, which no-ops when error-tracking isn't registered.

Terminal logging is independent of Sentry and controlled entirely by `email.logging.errors` / `email.logging.sends`.

## Hooks

`sendEmail` dispatches `preEmailSend` before each call to the underlying adapter and `postEmailSend` after. Both fire for every send — application-driven mail AND framework-mode password-reset emails alike.

```ts
import { registerHook } from '@luckystack/core';

// Block sends to a suppression list — `pre*` hooks can return a stop signal.
registerHook('preEmailSend', async ({ message, adapter }) => {
  if (await isOnSuppressionList(message.to)) {
    return { stop: true, errorCode: 'email.suppressed' };
  }
});

// Audit / DLQ on failure.
registerHook('postEmailSend', async ({ adapter, messageId, reason, ok }) => {
  if (!ok) await alertOps({ adapter, reason });
});
```

Payloads are augmented onto `@luckystack/core`'s `HookPayloads` map via `packages/email/src/hookPayloads.ts`, so the type appears on `HookName` automatically when `@luckystack/email` is installed. Field shape:

- `preEmailSend` — `{ message: EmailMessage, adapter: string }`. A stop signal aborts the send; `sendEmail` returns `{ ok: false, reason: signal.errorCode }`.
- `postEmailSend` — `{ message, adapter, ok: boolean, messageId?, reason? }`. `messageId` is set on success; `reason` on failure.

## Public API

| Export | Purpose |
| --- | --- |
| `sendEmail(message)` | Send through the registered sender. Supports `signal` + `idempotencyKey`; failures may include `deliveryOutcome: 'not-sent' | 'unknown'`. |
| `renderEmailLayout({ title, intro, ctaLabel?, ctaUrl?, outro?, footer?, brand?, accent? })` | Render a clean responsive HTML email + plain-text fallback. |
| `ConsoleSender()` / `ResendSender(opts)` / `SmtpSender(opts)` | Built-in adapters. |
| `autoSelectEmailSender(opts?)` | Pick the most-capable adapter for the current env (`Resend → SMTP → Console`). Accepts `{ force }`. |
| `registerEmailSender(sender)` / `getEmailSender()` / `isEmailSenderRegistered()` | Registry (re-exported from `@luckystack/core` for convenience). |
| `EmailSender`, `EmailMessage`, `EmailResult`, `AutoSelectEmailSenderOptions`, `RenderEmailLayoutInput`, `RenderedEmail` (types) | Build your own adapter or render a layout. |

## Related architecture docs

- [`docs/ARCHITECTURE_EMAIL.md`](../../docs/ARCHITECTURE_EMAIL.md) — full email lifecycle + forgot-password modes (`framework` / `custom` / `disabled`).
- [`docs/ARCHITECTURE_AUTH.md`](../../docs/ARCHITECTURE_AUTH.md) — login flow that consumes the registered sender.

## Dependencies

- Runtime: `@luckystack/core`
- Optional adapter peers (lazy-imported — install only the one you use):
  - `resend` — for `ResendSender`
  - `nodemailer` (+ `@types/nodemailer`) — for `SmtpSender`
  - `ConsoleSender` needs nothing extra.

## License

MIT — see [LICENSE](../../LICENSE).
