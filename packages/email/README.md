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
});

if (!result.ok) {
  console.error('email failed', result.reason);
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
  send: async (message) => {
    // call your provider's API
    // return { ok: true, id: '...' } or { ok: false, reason: '...' }
  },
};
```

## Configuration

Add an `email` block to `registerProjectConfig({...})`:

```ts
{
  email: {
    from: 'noreply@yourdomain.com', // default sender used if a message omits `from`
    appUrl: 'https://app.example.com', // base URL used in absolute links inside emails
    required: false, // throw if `sendEmail` is called and no sender is registered
    logging: {
      errors: true,  // log a warning when send fails
      sends: false,  // log a concise success line per sent email
    },
  },
}
```

## Observability

Email send errors are auto-reported to Sentry **if `@luckystack/sentry` is installed and initialized**. No special wiring — `sendEmail` calls `captureException()` from `@luckystack/core`, which no-ops when Sentry isn't registered.

Terminal logging is independent of Sentry and controlled entirely by `email.logging.errors` / `email.logging.sends`.

## Public API

| Export | Purpose |
| --- | --- |
| `sendEmail(message)` | Send an email through the registered sender. Returns `{ ok: true, id } \| { ok: false, reason, cause? }`. |
| `renderEmailLayout({ title, intro, ctaLabel?, ctaUrl?, outro?, footer?, brand?, accent? })` | Render a clean responsive HTML email + plain-text fallback. |
| `ConsoleSender()` / `ResendSender(opts)` / `SmtpSender(opts)` | Built-in adapters. |
| `registerEmailSender(sender)` / `getEmailSender()` / `isEmailSenderRegistered()` | Registry (re-exported from `@luckystack/core` for convenience). |
| `EmailSender`, `EmailMessage`, `EmailResult` (types) | Build your own adapter. |

## License

MIT — see [LICENSE](../../LICENSE).
