# Password-Reset Integration (`@luckystack/login` forgot-password)

> Deep-doc for how `@luckystack/email` plugs into `@luckystack/login`'s forgot-password flow. See also:
> - Adapters: `packages/email/docs/adapters.md`
> - Templates: `packages/email/docs/templates.md`
> - Architecture (auth side): `docs/ARCHITECTURE_AUTH.md`
> - Architecture (email side): `docs/ARCHITECTURE_EMAIL.md`
> - Login package contract: `packages/login/CLAUDE.md`

`@luckystack/login` does not depend on `@luckystack/email` directly. It lists email as an **optional peer**, lazy-imports it from the forgot-password orchestrator, and gracefully no-ops the entire flow if the consumer chose `auth.forgotPassword !== 'framework'`. This doc explains how the two packages handshake, what slots the email package fills, and what an installer has to wire to make it work.

---

## The three forgot-password modes

`ProjectConfig.auth.forgotPassword` controls which flow login runs:

| Mode | Behavior | Needs `@luckystack/email`? |
| --- | --- | --- |
| `'disabled'` (default) | The "Forgot password?" link does not render. The reset APIs return `forgotPasswordDisabled`. | No. |
| `'framework'` | Login package owns the entire flow: `/reset-password` page, `sendReset` API, token mint, email send via `sendEmail({ adapterHint: 'transactional' })`, password update. | **Yes** — must be installed AND a sender must be registered before the first request. |
| `'custom'` | Login exports primitives (`createPasswordResetToken`, `consumePasswordResetToken`, `updatePasswordHash`, `verifyPassword`). The consumer wires its own UI + email. | Only if your custom flow chooses to use `sendEmail` — otherwise no. |

Only `'framework'` mode invokes `sendEmail`. Everything below is for that mode.

---

## End-to-end flow (`forgotPassword: 'framework'`)

Source-of-truth file: `packages/login/src/forgotPassword.ts`.

```
[client]
  POST /reset-password/api/sendReset/v1   { email, brand? }
       |
       v
[@luckystack/login] sendPasswordResetEmail({ email, brand? })
  1. Guard: getProjectConfig().auth.forgotPassword === 'framework' ? continue : { ok: false, reason: 'forgotPassword-not-framework' }
  2. Resolve brand:  args.brand ?? config.auth.passwordResetBrand ?? 'LuckyStack'
  3. Lazy import:    const { sendEmail, renderEmailLayout } = await import('@luckystack/email')
  4. Look up user:   getUserAdapter().findByEmail({ email, provider: 'credentials' })
       - not found -> dispatch passwordResetRequested({ email, matched: false }), return { ok: true } (anti-enumeration)
  5. Mint token:     createPasswordResetToken(user.id)
                     -> Redis: `${projectName}-pwreset:<token>` TTL `auth.passwordResetTtlSeconds`
  6. Dispatch hook:  passwordResetRequested({ email, matched: true, userId, token, ttlSeconds })
  7. Build URL:      `${config.app.publicUrl}/reset-password?token=${encodedToken}`
  8. Send:           sendEmail({ to: user.email, template: 'password-reset', data: { resetUrl, userName, brand, ttlMinutes }, adapterHint: 'transactional' })
                     -> resolves the `'password-reset'` template (consumer override -> built-in fallback) which renders via `renderEmailLayout`
  9. Return:         result.ok ? { ok: true } : { ok: false, reason: result.reason }
```

The client never learns whether the email matched a real account — both branches return `{ ok: true }`. This anti-enumeration behavior is per-spec, not a bug.

### Adapter resolution

Login passes `adapterHint: 'transactional'`. `sendEmail` (`packages/email/src/sendEmail.ts:resolveSender`) walks:

1. `input.adapter` — not set by login.
2. `input.adapterHint = 'transactional'` -> `getEmailSenderByName('transactional')`. If you registered a transactional slot via `registerEmailSenders({ transactional: ... })`, this wins.
3. `getEmailSenderByName('default')` — set when you registered any sender via `registerEmailSenders({ default: ... })` OR via the legacy single `registerEmailSender(...)`.
4. Legacy `getEmailSender()` — same legacy slot.
5. None of the above -> `no-sender` failure (throw or soft-fail depending on `emailConfig.required`).

This means a project can register a single sender and password-reset works. A project with two senders (marketing + transactional) automatically routes resets through the transactional one.

### Template resolution

The current `sendPasswordResetEmail` dispatches via the template registry: it calls `sendEmail({ template: 'password-reset', data: { resetUrl, userName, brand, ttlMinutes }, ... })` (no inline `subject`/`html`). `sendEmail` resolves the `'password-reset'` name through the registry — a consumer override registered via `registerEmailTemplate('password-reset', …)` wins (last-write-wins), otherwise the framework built-in in `builtInTemplates.ts` renders the default copy with `renderEmailLayout`.

To get a fully-overrideable password-reset email:

1. Register your own `'password-reset'` template via `registerEmailTemplate('password-reset', { subject, render })` — `sendPasswordResetEmail` picks it up automatically, no API override needed.
2. Or, for full control of recipient/adapter routing, override the framework's reset API at the project level (a custom `_api/sendReset_v1.ts`) and call `sendEmail({ template: 'password-reset', data: { ... }, to, adapterHint: 'transactional' })` directly, bypassing `sendPasswordResetEmail`.

Or, keep login's default behavior and customize the brand/wording through `auth.passwordResetBrand` + the `brand` argument — see "Overriding the built-in template" below.

---

## Built-in email content fields

The built-in `'password-reset'` template (`packages/email/src/builtInTemplates.ts`) populates `renderEmailLayout` with:

| Field | Value |
| --- | --- |
| `brand` | `args.brand` ?? `config.auth.passwordResetBrand` ?? `'LuckyStack'` |
| `title` | `'Reset your password'` |
| `intro` | `Hi <userName ?? 'there'>, we received a request to reset the password on your <brand> account. Click the button below to choose a new one. The link expires in <ttlMinutes> minutes.` |
| `ctaLabel` | `'Reset password'` |
| `ctaUrl` | `${config.app.publicUrl}/reset-password?token=<encodedToken>` |
| `outro` | `If you didn't request this, you can safely ignore this email — your password will stay the same. The link: <ctaUrl>` |
| `footer` | `Sent by <brand>. If you have questions, reply to this email.` |

Subject: `Reset your <brand> password`.

These are defined in the built-in template (`packages/email/src/builtInTemplates.ts`); `sendPasswordResetEmail` (`packages/login/src/forgotPassword.ts`) supplies `brand`, `userName`, `resetUrl`, and `ttlMinutes` as the template `data`. Customization knobs are limited to `brand` and (indirectly) `userName`. For deeper customization, register your own `'password-reset'` template (see above) or fork the API.

---

## Overriding the built-in template (today's options)

### Option 1 — change the brand label only

Cheapest. Either:

```ts
// global, every reset email uses 'Acme'
registerProjectConfig({
  auth: { passwordResetBrand: 'Acme' },
});
```

or per-call, when you invoke `sendPasswordResetEmail` yourself instead of going through the default `/reset-password/api/sendReset/v1`:

```ts
import { sendPasswordResetEmail } from '@luckystack/login';

await sendPasswordResetEmail({ email: 'user@example.com', brand: 'Acme' });
```

### Option 2 — register a `'password-reset'` template

This is the recommended pattern for full control. Boot wiring:

```ts
import { registerEmailTemplate, renderEmailLayout } from '@luckystack/email';

interface PasswordResetData {
  brand: string;
  userName?: string;
  resetUrl: string;
  ttlMinutes: number;
  language?: string;
}

registerEmailTemplate<PasswordResetData>('password-reset', {
  subject: (d) => `Reset your ${d.brand} password`,
  render: (d) =>
    renderEmailLayout({
      brand: d.brand,
      title: 'Reset your password',
      intro: `Hi ${d.userName ?? 'there'}, ...`,
      ctaLabel: 'Choose new password',
      ctaUrl: d.resetUrl,
      outro: `Did not request this? Ignore this email — your password stays the same.`,
      footer: `Sent by ${d.brand}.`,
      accent: '#7C3AED',
    }),
});
```

Then, in your project's `src/reset-password/_api/sendReset_v1.ts`, call your own orchestrator:

```ts
import { createPasswordResetToken, getUserAdapter } from '@luckystack/login';
import { sendEmail } from '@luckystack/email';
import { getProjectConfig } from '@luckystack/core';

export const main = async ({ data, functions }) => {
  const config = getProjectConfig();
  const user = await getUserAdapter().findByEmail({ email: data.email, provider: 'credentials' });
  if (!user) return { status: 'success' }; // anti-enumeration

  const token = await createPasswordResetToken(user.id);
  const session = user.id ? await functions.session.getSessionByUserId(user.id) : null;
  await sendEmail({
    to: user.email,
    template: 'password-reset',
    adapterHint: 'transactional',
    data: {
      brand: config.auth.passwordResetBrand ?? 'Acme',
      userName: user.name ?? undefined,
      resetUrl: `${config.app.publicUrl}/reset-password?token=${encodeURIComponent(token)}`,
      ttlMinutes: Math.round(config.auth.passwordResetTtlSeconds / 60),
      language: session?.language ?? 'en',
    },
  });

  return { status: 'success' };
};
```

This bypasses `sendPasswordResetEmail` and gives you full control of subject, body, language, and adapter routing.

### Option 3 — wrap `sendEmail` via `preEmailSend`

If you only want to inject a header or rewrite the recipient (e.g. dev-time redirection to `dev-inbox@team.com`), `preEmailSend` is the lightest touch:

```ts
import { registerHook } from '@luckystack/core';

if (process.env.NODE_ENV !== 'production') {
  registerHook('preEmailSend', async ({ message }) => {
    if (message.subject.startsWith('Reset your')) {
      message.to = 'dev-inbox@team.com'; // mutate in place
    }
  });
}
```

---

## Registering a `'transactional'`-slot adapter

If you want password-reset (and other auth emails) to go through a different provider than your marketing mail, register a `'transactional'` slot. Login automatically routes there via `adapterHint`:

```ts
import { registerEmailSenders, ResendSender, SmtpSender } from '@luckystack/email';

registerEmailSenders({
  default: SmtpSender({ host: 'marketing-relay.example.com', port: 587, /* ... */ }),
  transactional: ResendSender({
    apiKey: process.env.RESEND_TX_KEY!,
    from: 'auth@app.example.com',
  }),
});
```

Without a `transactional` slot, login falls through to `default` (then to the legacy single sender). With one, every framework-mode auth email is automatically routed through it — no application changes required.

---

## i18n: passing the recipient's language

`sendPasswordResetEmail` does *not* currently read the user's language — the inline `renderEmailLayout` call is hard-coded English. If you need multi-language reset emails:

1. Register `'password-reset'` in the template registry with language switching (see Option 2 above + `docs/templates.md` for a `team-invite` example).
2. In your project's reset API, resolve the user's language before calling `sendEmail`:
   ```ts
   const session = await functions.session.getSessionByUserId(user.id);
   await sendEmail({
     to: user.email,
     template: 'password-reset',
     adapterHint: 'transactional',
     data: { ..., language: session?.language ?? config.defaultLanguage ?? 'en' },
   });
   ```

The session's `language` field is populated by the `SessionAdapter` (the default Prisma adapter reads `user.language`).

---

## Boot wiring requirements

To enable framework-mode password reset, at minimum:

1. **Install both packages:**
   ```bash
   npm install @luckystack/email @luckystack/core
   # Plus an adapter peer (one of):
   npm install resend           # ResendSender
   npm install nodemailer @types/nodemailer  # SmtpSender
   ```

2. **Register a sender** *before* `createLuckyStackServer` runs:
   ```ts
   import { autoSelectEmailSender, registerEmailSender } from '@luckystack/email';
   registerEmailSender(autoSelectEmailSender());
   ```

3. **Set `auth.forgotPassword` to `'framework'`** in `config.ts`:
   ```ts
   registerProjectConfig({
     auth: {
       forgotPassword: 'framework',
       passwordResetTtlSeconds: 60 * 30, // 30 min
       passwordResetBrand: 'Acme',
     },
   });
   ```

4. **Set `app.publicUrl`** — used to build the reset URL inside the email. Wrong here = broken reset links:
   ```ts
   registerProjectConfig({
     app: { publicUrl: 'https://app.example.com' },
   });
   ```

5. **(Optional)** make missing senders hard-fail at boot instead of silently dropping resets:
   ```ts
   import { registerEmailConfig } from '@luckystack/email';
   registerEmailConfig({ required: true });
   ```
   In production this is strongly recommended — a misconfigured prod box that silently drops password resets is a worse failure than crashing at boot.

`@luckystack/login` will throw at boot when `auth.forgotPassword === 'framework'` and no email sender is registered — see the boot guard in `docs/ARCHITECTURE_EMAIL.md`.

---

## Failure surfaces

| Failure point | Surface |
| --- | --- |
| No email sender registered & `emailConfig.required: false` | `sendEmail` returns `{ ok: false, reason: 'no-sender' }`. Login's `sendPasswordResetEmail` returns `{ ok: false, reason: 'no-sender' }`. API responds `{ status: 'success' }` to the client anyway (anti-enumeration), but you see the failure in logs + Sentry. |
| No email sender registered & `emailConfig.required: true` | `sendEmail` throws. Login bubbles. The API errors. **Strongly recommended for prod**. |
| Adapter throws (network, auth, etc.) | `sendEmail` returns `{ ok: false, reason: error.message, cause: error }`. Sentry capture fires with `{ fn: 'sendEmail', senderName, to, subject, reason }`. |
| Recipient on bounce / suppression list | If you registered a `preEmailSend` handler that returns a stop signal, the abort path applies (see `docs/hooks.md`). |
| User not found | `sendPasswordResetEmail` returns `{ ok: true }` (anti-enumeration). Hook `passwordResetRequested` fires with `matched: false`. No email is sent. |
| Token expired | Not an email problem — the user clicks the link, `consumePasswordResetToken` returns `null`, the reset-password page shows an "expired" error. |
| Multiple reset requests in quick succession | Each request mints a fresh token. Old tokens stay valid until TTL expires or one is consumed. Rate-limit via a `preEmailSend` hook (see `docs/hooks.md` example B). |

---

## Worked examples

### A. Minimal Resend wiring (smallest production setup)

```ts
// server/server.ts (boot)
import { registerProjectConfig } from '@luckystack/core';
import { registerEmailConfig, autoSelectEmailSender, registerEmailSender } from '@luckystack/email';

registerProjectConfig({
  auth: {
    forgotPassword: 'framework',
    passwordResetBrand: 'Acme',
    passwordResetTtlSeconds: 60 * 30,
  },
  app: { publicUrl: 'https://app.example.com' },
});

registerEmailConfig({ required: true });
registerEmailSender(autoSelectEmailSender()); // picks ResendSender from RESEND_API_KEY
```

Set `RESEND_API_KEY` and `EMAIL_FROM` in your env. Done. Password-reset link generation, email send, and Sentry capture all wire automatically.

### B. Brand-customized template + per-language subject

See Option 2 above plus the i18n section. The crucial pieces:

1. `registerEmailTemplate('password-reset', { subject: (d) => COPY[d.language ?? 'en'].subject, render: (d) => /* ... */ })`.
2. Custom `_api/sendReset_v1.ts` that resolves language from the user's session and calls `sendEmail({ template: 'password-reset', data: { ..., language }, to, adapterHint: 'transactional' })`.

### C. Separate transactional adapter from marketing sender

```ts
import { registerEmailSenders, ResendSender, SmtpSender } from '@luckystack/email';

registerEmailSenders({
  default: SmtpSender({
    host: 'marketing-relay.example.com',
    port: 587,
    auth: { user: process.env.MARKETING_SMTP_USER!, pass: process.env.MARKETING_SMTP_PASS! },
    from: 'newsletter@app.com',
  }),
  transactional: ResendSender({
    apiKey: process.env.RESEND_TX_KEY!,
    from: 'auth@app.com',
  }),
});
```

Password-reset goes through Resend (`'transactional'` slot, via `adapterHint`). Your `sendEmail({ adapter: 'default', ... })` newsletter sends go through the SMTP relay. Neither path needs application-level code changes.

---

## Related source

- `packages/login/src/forgotPassword.ts` — the orchestrator described above.
- `packages/login/src/passwordReset.ts` — `createPasswordResetToken`, `consumePasswordResetToken`, `updatePasswordHash`.
- `packages/email/src/sendEmail.ts` — adapter + template resolution.
- `packages/email/src/renderEmailLayout.ts` — the layout helper the inline render uses.
- `packages/login/CLAUDE.md` — login package contract (modes, config keys).
