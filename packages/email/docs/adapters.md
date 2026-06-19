# Email Adapters (Console, Resend, SMTP, custom)

> Deep-doc for `@luckystack/email`'s adapter surface. See also:
> - Package README: `packages/email/README.md`
> - Architecture: `docs/ARCHITECTURE_EMAIL.md`
> - Hook payloads: `packages/email/docs/hooks.md`
> - Error handling: `packages/email/docs/error-handling.md`

`@luckystack/email` ships three built-in adapters and one auto-selector. Every adapter implements the same `EmailSender` contract from `@luckystack/core`, so application code only ever calls `sendEmail({...})` — the registered adapter handles the rest.

---

## The `EmailSender` contract

The adapter contract lives in `@luckystack/core` and is re-exported from `@luckystack/email` for convenience:

```ts
import type { EmailSender, EmailMessage, EmailResult } from '@luckystack/email';

interface EmailSender {
  /** Short label used in log lines and the `preEmailSend` / `postEmailSend` payloads. */
  name: string;
  /** Send a single message. Must NOT throw — return a typed result instead. */
  send: (message: EmailMessage) => Promise<EmailResult>;
}

interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
}

type EmailResult =
  | { ok: true; id: string }
  | { ok: false; reason: string; cause?: unknown };
```

`sendEmail` wraps `sender.send(message)` in `tryCatch`, so a thrown error is normalized into `{ ok: false, reason: error.message || 'send-threw', cause: error }`. Returning `undefined` is normalized into `{ ok: false, reason: 'send-no-result' }`. Adapters that *want* to be resilient should still prefer returning a typed result over throwing.

---

## Built-in adapters

### `ConsoleSender(options?: { from?: string })`

The dev-mode adapter. Never sends a real email — instead it pretty-prints the rendered email to the terminal (recipient list, subject, plain text body, or the first 400 chars of stripped HTML when no `text` fallback exists). Returns `{ ok: true, id: 'console-<timestamp>' }`.

```ts
import { ConsoleSender, registerEmailSender } from '@luckystack/email';

registerEmailSender(ConsoleSender({ from: 'noreply@dev.local' }));
```

- **Peer deps:** none.
- **When to use:** local development, CI smoke tests, demo environments. Default selection when neither `RESEND_API_KEY` nor `SMTP_HOST` is set.
- **`name`:** `'console'`.
- **Notes:** even in dev, the rest of the pipeline (`preEmailSend` / `postEmailSend` / Sentry capture / logger) still runs. Wiring suppression-list and audit hooks against `ConsoleSender` is a deliberate way to verify hook behavior without burning real provider quota.

### `ResendSender({ apiKey, from? })`

Wraps the official `resend` npm package. Lazy-imports the SDK on first instantiation so projects that don't use this adapter never pay for the import. Also resolves `resend` synchronously at factory call time so a missing peer-dep crashes at boot (not silently on first send).

```ts
import { ResendSender, registerEmailSender } from '@luckystack/email';

registerEmailSender(
  ResendSender({
    apiKey: process.env.RESEND_API_KEY!,
    from: process.env.EMAIL_FROM ?? 'noreply@yourdomain.com',
  }),
);
```

- **Peer deps:** `resend` (install with `npm install resend`).
- **When to use:** production default. Free tier 3,000/mo, trivial setup, no SMTP knowledge required.
- **`name`:** `'resend'`.
- **Required options:**
  - `apiKey: string` — throws at construction time if missing.
- **Optional options:**
  - `from?: string` — default `from` address used when a message omits its own `from`. Recommended in production so the registered sender doubles as a brand contract.
- **Result mapping:**
  - Resend `{ data: { id }, error: null }` -> `{ ok: true, id }`.
  - Resend `{ data: null, error }` -> `{ ok: false, reason: error.message || 'resend-error', cause: error }`.
  - No `data` and no `error` -> `{ ok: false, reason: 'no-response-data' }`.
  - Message has neither `message.from` nor a configured `from` -> `{ ok: false, reason: 'missing-from' }`.
- **Setup checklist:**
  1. Sign up at https://resend.com and verify your domain. For early testing the `onboarding@resend.dev` sender works without verification.
  2. Generate an API key and place it in `RESEND_API_KEY` (or whatever you configured via `email.envVars.resendApiKey`).
  3. Set the default `from` to a verified-domain address in production.

### `SmtpSender({ host, port, secure?, auth?, from? })`

Wraps `nodemailer`. Lazy-imports the SDK on first instantiation. Synchronously resolves the package at factory call time so a missing peer-dep crashes at boot.

```ts
import { SmtpSender, registerEmailSender } from '@luckystack/email';

registerEmailSender(
  SmtpSender({
    host: process.env.SMTP_HOST!,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
    },
    from: process.env.EMAIL_FROM,
  }),
);
```

- **Peer deps:** `nodemailer` + `@types/nodemailer` (install with `npm install nodemailer @types/nodemailer`).
- **When to use:** self-hosters, Mailtrap sandbox testing, AWS SES via SMTP, on-prem relay servers, anywhere Resend isn't an option.
- **`name`:** `'smtp'`.
- **Options:**
  - `host: string` (required) — SMTP host name.
  - `port: number` (required) — SMTP port. Common values: 587 (STARTTLS), 465 (TLS-on-connect), 25 (legacy plaintext).
  - `secure?: boolean` — `true` for TLS-on-connect (port 465). `false` (or unset) for STARTTLS upgrade (port 587).
  - `auth?: { user: string; pass: string }` — credentials. Optional because some test relays accept anonymous SMTP.
  - `from?: string` — default `from` address, mirrors `ResendSender`.
- **Result mapping:**
  - `transporter.sendMail(...)` resolves -> `{ ok: true, id: String(info.messageId ?? 'smtp-<timestamp>') }`.
  - `transporter.sendMail(...)` rejects -> `{ ok: false, reason: error.message || 'smtp-error', cause: error }`.
  - Missing `from` -> `{ ok: false, reason: 'missing-from' }`.
- **Setup checklist (Mailtrap sandbox):**
  1. https://mailtrap.io -> Sandbox -> create / open Inbox -> SMTP Settings tab.
  2. Copy host/port/username/password into the env vars.
  3. `secure` stays `false` on Mailtrap's default port 2525.

### `autoSelectEmailSender(options?: { from?: string; force? })`

Chooses one of the three built-in adapters based on environment variables. The intent is that every project's `server.ts` becomes a single line:

```ts
import { autoSelectEmailSender, registerEmailSender } from '@luckystack/email';

registerEmailSender(autoSelectEmailSender());
```

Selection order (top-down):

1. `process.env[envVars.resendApiKey]` set -> `ResendSender({ apiKey, from })`.
2. `process.env[envVars.smtpHost]` set -> `SmtpSender({ host, port, secure, auth, from })` with the matching `SMTP_*` env vars.
3. Otherwise -> `ConsoleSender({ from })`.

The env-var *names* come from `getEmailConfig().envVars` (defaults: `RESEND_API_KEY`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`). Installers can rename them via `registerEmailConfig({ envVars: { resendApiKey: 'MY_APP_RESEND_KEY', ... } })` without forking the framework.

Numeric fallbacks come from `getEmailConfig().defaults` (currently only `smtpPort`, default `587`). Used when the SMTP-port env var resolves to an empty string.

`options.from` overrides the env-var-derived default `from`. `options.force` pins the adapter regardless of env:

```ts
// Always use SMTP (e.g. staging instance that proxies through Mailtrap):
registerEmailSender(autoSelectEmailSender({ force: 'smtp' }));

// Always use ConsoleSender (e.g. local integration tests):
registerEmailSender(autoSelectEmailSender({ force: 'console' }));

// Always use Resend (throws if `RESEND_API_KEY` is unset):
registerEmailSender(autoSelectEmailSender({ force: 'resend' }));
```

Forcing an adapter without the matching env var throws a clear error at boot — e.g. `autoSelectEmailSender: force=resend requires the RESEND_API_KEY env var.` — so misconfiguration never silently falls through to `ConsoleSender` in production.

---

## Registry mechanics

The adapter registry lives in `@luckystack/core` and is re-exported from `@luckystack/email`. There are two registration paths:

### 1. Legacy single sender — `registerEmailSender(sender)`

```ts
import { registerEmailSender, ResendSender } from '@luckystack/email';

registerEmailSender(ResendSender({ apiKey: process.env.RESEND_API_KEY!, from: 'noreply@app.com' }));
```

- Mirrors into the `'default'` slot so the multi-adapter resolver sees it too.
- Read via `getEmailSender(): EmailSender | null`.
- Re-registering replaces the previous sender (no list).

### 2. Multi-adapter — `registerEmailSenders({...})`

```ts
import {
  registerEmailSenders,
  ResendSender,
  SmtpSender,
  ConsoleSender,
} from '@luckystack/email';

registerEmailSenders({
  default: ResendSender({ apiKey: process.env.RESEND_API_KEY!, from: 'noreply@app.com' }),
  transactional: ResendSender({ apiKey: process.env.RESEND_TX_KEY!, from: 'auth@app.com' }),
  marketing: SmtpSender({ host: '...', port: 587, auth: { user: '...', pass: '...' } }),
  diagnostics: ConsoleSender(),
});
```

Standard slot names recognized by the framework:

- `'default'` — used when no `adapter` / `adapterHint` is passed to `sendEmail`. Mirrors the legacy `getEmailSender()` slot.
- `'transactional'` — preferred slot for password-reset, account-confirm, and any auth flow. `@luckystack/login`'s `sendPasswordResetEmail` passes `adapterHint: 'transactional'`.
- `'marketing'` — preferred slot for invites, drip campaigns, weekly summaries.
- `'diagnostics'` — reserved for internal framework probes (boot smoke tests, health checks).

Beyond the standards, any string key is allowed — register `regional: PostmarkSenderEU(...)` and call `sendEmail({ adapter: 'regional', ... })`.

Read helpers:

| Function | Returns |
| --- | --- |
| `getEmailSender()` | The legacy / `'default'` sender or `null`. |
| `getEmailSenderByName(name)` | The named sender, or `null` if the slot is empty. |
| `listEmailSenderNames()` | Every registered slot name (diagnostic only). |
| `isEmailSenderRegistered()` | `true` when any sender is registered. |

### Resolution order inside `sendEmail`

`sendEmail({ adapter?, adapterHint?, ... })` resolves the sender like this:

1. If `input.adapter` is set, return `getEmailSenderByName(input.adapter)`. If that slot is empty, return `null` → the no-sender path fires and `sendEmail` returns `{ ok: false, reason: 'no-sender' }` (EMAIL-O4: explicit routing is a security contract — security-critical or compliance mail must go through the named sender or fail, never silently reroute to a fallback).
2. If `input.adapterHint` is set (internal hint used by framework callers), try `getEmailSenderByName(input.adapterHint)`.
3. Try `getEmailSenderByName('default')`.
4. Fall back to the legacy `getEmailSender()`.
5. If all four miss, behavior depends on `emailConfig.required` — throw if `true`, return `{ ok: false, reason: 'no-sender' }` if `false`.

This means a project can register a single `'default'` sender and password-reset emails will still work — they fall through to the default. Once the project grows enough to want separate marketing + transactional routing, registering a `'transactional'` slot opts in without touching login package code.

---

## Lazy peer-dep loading & boot guards

`ResendSender` and `SmtpSender` both:

1. Call `localRequire.resolve(<peer>)` synchronously at factory time. If the peer is not installed, throws a clear error like:

   ```
   [email:resend] The `resend` package is not installed but ResendSender was called.
   Run `npm install resend`, or remove the RESEND_API_KEY env var and pick a different EmailSender adapter.
   ```

2. Use a top-level `import('<peer>')` promise that resolves the actual SDK. Cached at module init so each subsequent send awaits the same promise (no repeated dynamic imports).

This pattern means:

- A project that uses `ResendSender` only never has to install `nodemailer`.
- A project that misconfigures envs — sets `RESEND_API_KEY` but forgets `npm install resend` — crashes at boot rather than silently dropping reset emails.
- `ConsoleSender` has no peer requirement and is always safe to register.

---

## Writing a custom adapter

A custom adapter is just an object that satisfies `EmailSender`. No registration is needed beyond the same `registerEmailSender` / `registerEmailSenders` calls.

```ts
import type { EmailSender } from '@luckystack/email';

export const PostmarkSender = (opts: { token: string; from: string }): EmailSender => ({
  name: 'postmark',
  send: async (message) => {
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': opts.token,
      },
      body: JSON.stringify({
        From: message.from ?? opts.from,
        To: Array.isArray(message.to) ? message.to.join(',') : message.to,
        Subject: message.subject,
        HtmlBody: message.html,
        TextBody: message.text,
        ReplyTo: message.replyTo,
        Cc: Array.isArray(message.cc) ? message.cc.join(',') : message.cc,
        Bcc: Array.isArray(message.bcc) ? message.bcc.join(',') : message.bcc,
      }),
    });

    if (!res.ok) {
      return {
        ok: false,
        reason: `postmark-${String(res.status)}`,
        cause: await res.text(),
      };
    }

    const data = (await res.json()) as { MessageID: string };
    return { ok: true, id: data.MessageID };
  },
});
```

Register it like any built-in:

```ts
registerEmailSenders({
  default: PostmarkSender({ token: process.env.POSTMARK_TOKEN!, from: 'noreply@app.com' }),
  marketing: SmtpSender({ host: 'mailgun-relay.example.com', port: 587, /* ... */ }),
});
```

### Custom-adapter checklist

- **`name`:** use a short lowercase string. Log lines and hook payloads expose this verbatim.
- **`send`:** never throw. Always return `EmailResult`. If your provider SDK throws, wrap with `tryCatch` (re-exported from `@luckystack/core`).
- **`id`:** stringify whatever your provider returns. Many DLQ tools key on this — pick a stable identifier (provider's message id beats a timestamp).
- **Defaults:** prefer reading `from` from the message; fall back to a constructor-provided default; return `'missing-from'` if both are absent.
- **Lazy imports:** if your adapter wraps a heavy SDK, follow the `ResendSender` / `SmtpSender` pattern — synchronously `localRequire.resolve(...)` at factory time so missing-peer failures crash at boot.
- **Bulk vs transactional:** keep this package scoped to transactional mail. If you build a "marketing-only" adapter that batches sends, document the trade-offs and register it under the `'marketing'` slot.

---

## Worked examples

### A. Prod Resend + dev Console (most common)

```ts
import {
  ConsoleSender,
  ResendSender,
  registerEmailSender,
} from '@luckystack/email';

if (process.env.NODE_ENV === 'production' && process.env.RESEND_API_KEY) {
  registerEmailSender(
    ResendSender({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.EMAIL_FROM ?? 'noreply@yourdomain.com',
    }),
  );
} else {
  registerEmailSender(ConsoleSender());
}
```

This is the same logic `autoSelectEmailSender()` performs — usually you just call that helper instead.

### B. Two named adapters (transactional + marketing)

```ts
import { registerEmailSenders, ResendSender, SmtpSender } from '@luckystack/email';

registerEmailSenders({
  default: ResendSender({ apiKey: process.env.RESEND_API_KEY!, from: 'noreply@app.com' }),
  transactional: ResendSender({ apiKey: process.env.RESEND_TX_KEY!, from: 'auth@app.com' }),
  marketing: SmtpSender({
    host: process.env.MARKETING_SMTP_HOST!,
    port: Number(process.env.MARKETING_SMTP_PORT ?? 587),
    auth: { user: process.env.MARKETING_SMTP_USER!, pass: process.env.MARKETING_SMTP_PASS! },
    from: 'newsletter@app.com',
  }),
});

// `@luckystack/login` automatically routes password-reset through 'transactional'.
// Your invite code routes explicitly:
await sendEmail({
  to: invitee.email,
  subject: 'You have been invited',
  html: inviteHtml,
  text: inviteText,
  adapter: 'marketing',
});
```

### C. Custom adapter for a regional ESP

```ts
import { registerEmailSender, type EmailSender } from '@luckystack/email';

const RegionalSender = (opts: { endpoint: string; token: string; from: string }): EmailSender => ({
  name: 'regional-esp',
  send: async (message) => {
    const res = await fetch(opts.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth': opts.token },
      body: JSON.stringify({ from: message.from ?? opts.from, /* provider-specific fields */ }),
    });
    if (!res.ok) {
      return { ok: false, reason: `regional-${String(res.status)}` };
    }
    const data = (await res.json()) as { id: string };
    return { ok: true, id: data.id };
  },
});

registerEmailSender(RegionalSender({
  endpoint: 'https://eu-esp.example.com/v1/send',
  token: process.env.REGIONAL_TOKEN!,
  from: 'noreply@app.eu',
}));
```

---

## Edge cases

| Situation | Behaviour |
| --- | --- |
| `sendEmail({ adapter: 'xyz' })` and slot `'xyz'` is empty | Returns `{ ok: false, reason: 'no-sender' }` — explicit adapter routing is a security contract (EMAIL-O4). No silent fallthrough to `adapterHint` or `'default'`. When `emailConfig.required === true` this path throws instead. |
| All slots empty AND `emailConfig.required === true` | `sendEmail` throws with the boot-helpful "register a sender, or set `required: false`" message. |
| All slots empty AND `emailConfig.required === false` | Returns `{ ok: false, reason: 'no-sender' }` and (if `logging.errors`) warns in the terminal. |
| Adapter returns `undefined` | Normalized to `{ ok: false, reason: 'send-no-result' }`. |
| Adapter `send` throws | Normalized to `{ ok: false, reason: error.message || 'send-threw', cause: error }`. The error is also captured to Sentry. |
| `RESEND_API_KEY` set but `resend` package not installed | `ResendSender(...)` throws at construction with installer-friendly message — server bootstrap fails fast. |
| `SMTP_HOST` set but `nodemailer` not installed | Same pattern: `SmtpSender(...)` throws at construction. |
| `force: 'resend'` but `RESEND_API_KEY` is unset | `autoSelectEmailSender` throws with `autoSelectEmailSender: force=resend requires the RESEND_API_KEY env var.`. |
