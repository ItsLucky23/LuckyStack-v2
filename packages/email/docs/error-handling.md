# Email Error Handling & Observability

> Deep-doc for failure surfaces, logging, and observability in `@luckystack/email`. See also:
> - Adapters: `packages/email/docs/adapters.md`
> - Hooks: `packages/email/docs/hooks.md`
> - Templates: `packages/email/docs/templates.md`
> - Password-reset integration: `packages/email/docs/password-reset-integration.md`
> - Source: `packages/email/src/sendEmail.ts`

`@luckystack/email` never throws on a normal send failure — it returns a typed `EmailResult` so callers can branch with `if (!result.ok)` instead of wrapping every call in `try/catch`. This doc enumerates every reason `sendEmail` can return, how those reasons are logged + captured to error trackers, and how to wire DLQ / alerting patterns on top.

---

## `EmailResult` — the discriminated union

```ts
type EmailResult =
  | { ok: true; id: string }
  | { ok: false; reason: string; cause?: unknown };
```

- **Success:** `id` is the provider-assigned message id. Stable across redeliveries (Resend returns its own UUID; SMTP uses `info.messageId` or a `smtp-<timestamp>` fallback when the relay omits one; `ConsoleSender` returns `console-<timestamp>`).
- **Failure:** `reason` is a short stable string. `cause` is the underlying error (`Error`, response body, or whatever the adapter chose to surface). Inspect `cause` for stack traces or provider response bodies, but key your branching on `reason`.

Always branch on `result.ok` first — TypeScript narrows the union so you can access `id` or `reason` without further casts.

---

## Every `reason` value `sendEmail` can return

The `reason` field is populated in three places: by `sendEmail` itself, by the adapter's `send` function, or by a `preEmailSend` stop signal. Here's the full catalog:

### From `sendEmail` (pipeline-level)

| `reason` | When | Notes |
| --- | --- | --- |
| `'no-sender'` | `resolveSender` returned `null` (no `'default'` slot, no legacy single sender, no slot matching `adapter` / `adapterHint`). | When `emailConfig.required === true` this branch *throws* instead of returning. When `false` (default) it returns `{ ok: false, reason: 'no-sender' }`. |
| `'no-template'` | `template` was set in the input but `getEmailTemplate(name)` returned `undefined`. | The message is never built. `from` not applied. |
| `'send-no-result'` | The adapter's `send` returned `undefined` / nothing. | Defensive normalization — well-behaved adapters always return `EmailResult`. Treat this as an adapter bug. |
| `'send-threw'` | The adapter's `send` threw an error with no `.message`. | Rare — usually `tryCatch` captures `error.message` and that becomes the reason instead. The literal string `'send-threw'` only appears when the error has no message at all. |

### From the adapter (provider-level)

These are the most common failures in production. Every adapter is responsible for normalizing its provider's errors into a short stable string.

| `reason` | Adapter | When |
| --- | --- | --- |
| `'missing-from'` | `ResendSender`, `SmtpSender` | Neither `message.from` nor a constructor-provided `from` default. |
| `'resend-error'` | `ResendSender` | Resend SDK returned `{ data: null, error }` and `error.message` was empty. Most of the time you'll see the provider's actual error message instead. |
| `'no-response-data'` | `ResendSender` | Resend SDK returned neither `data` nor `error` — should never happen, treat as an SDK bug. |
| `'smtp-error'` | `SmtpSender` | `transporter.sendMail` threw with no `.message`. Usually you'll see the underlying SMTP server's error message instead. |
| `<provider error message>` | All adapters | Whatever the provider returned. E.g. `'Domain not verified'` from Resend, `'EAUTH: Invalid login'` from Nodemailer, `'postmark-422'` from a custom adapter. |

When the adapter's error has a `.message`, that string becomes `reason` and the original error object is preserved on `cause` for stack traces / debugging.

### From `preEmailSend` stop signals

| `reason` | When |
| --- | --- |
| `<signal.errorCode>` | A `preEmailSend` handler returned `{ stop: true, errorCode: 'email.suppressed' }` (or any other code). Per `docs/ARCHITECTURE_EMAIL.md`, `sendEmail` surfaces this as `{ ok: false, reason: signal.errorCode }`. See the "current implementation" note in `docs/hooks.md` for the actual abort wiring state. |

Common codes to use:

- `'email.suppressed'` — recipient on a suppression list.
- `'email.rateLimited'` — per-recipient or per-route rate limit.
- `'email.bounceListed'` — provider previously hard-bounced this address.
- `'email.dryRun'` — dev/staging dry-run mode rejected the send.

---

## `emailConfig.required` — strict vs soft mode

```ts
import { registerEmailConfig } from '@luckystack/email';

registerEmailConfig({ required: true }); // strict
// registerEmailConfig({ required: false }); // soft (default)
```

| `required` | Behavior when no sender is registered |
| --- | --- |
| `false` (default) | `sendEmail` returns `{ ok: false, reason: 'no-sender' }`. `logging.errors` warns in terminal. No throw, no boot crash. |
| `true` | `sendEmail` throws with a long, installer-helpful message: *"sendEmail() called but no email sender is registered. Install @luckystack/email and call registerEmailSender(...) (or registerEmailSenders({...})) at boot, or set emailConfig.required = false (via registerEmailConfig) to make this a soft failure."* |

**Production recommendation: `required: true`** when you genuinely depend on email (auth flows, billing receipts). A misconfigured prod box that silently drops mail for hours is worse than a hard boot failure. The fail-loud behavior matches the framework's peer-dep guard policy — set the env, install the peer, OR turn it off; never silent fallthrough.

---

## Terminal logging via `getLogger()`

`sendEmail` logs to the registered logger (defaults to console). Two boolean flags on `emailConfig` control the volume:

| Flag | Default | What it logs | Level | When |
| --- | --- | --- | --- | --- |
| `emailConfig.logging.errors` | `true` | `[email] no sender registered — dropping message` (with `{ to }`) | `warn` | Soft `no-sender` path. |
| same | same | `[email] template '<name>' not registered` (with `{ to }`) | `warn` | `no-template` path. |
| same | same | `[email:<adapter>] FAILED` (with `{ to, subject, reason }`) | `warn` | Adapter returned `{ ok: false }` or threw. |
| `emailConfig.logging.sends` | `false` | `[email:<adapter>] sent` (with `{ to, subject, id }`) | `info` | Successful send. |

```ts
import { registerEmailConfig } from '@luckystack/email';

// Production: log every successful send (great for early traffic), warn on failures
registerEmailConfig({
  logging: { errors: true, sends: true },
});

// Quiet (only warn on failures — the default):
registerEmailConfig({
  logging: { errors: true, sends: false },
});

// Fully silent (rare — usually for tests):
registerEmailConfig({
  logging: { errors: false, sends: false },
});
```

Terminal logging is **independent** of any error-tracking adapter. Even when Sentry is wired, the terminal-side warnings still print — they're complementary, not redundant.

The active logger is whatever was registered via `registerLogger` (`@luckystack/core`). In dev that's typically the colored logger from `createDevLogger()`; in production it's Pino / Winston / Datadog / whatever you wired. The console fallback (`console.warn` / `console.info`) applies when no logger is registered.

---

## Sentry / error-tracker capture

On every failure (`result.ok === false`), `sendEmail` calls:

```ts
captureException(
  result.cause ?? new Error(`Email send failed: ${result.reason}`),
  {
    fn: 'sendEmail',
    senderName: sender.name,
    to: message.to,
    subject: message.subject,
    reason: result.reason,
  },
);
```

- `captureException` is imported from `@luckystack/core` and fans out to **every** registered error tracker (Sentry, OpenTelemetry, custom adapter), not just Sentry.
- When `@luckystack/error-tracking` is **not** installed/initialized, the call is a silent no-op. No special detection needed — the underlying registry is empty.
- The captured error is either the adapter's original throw (`cause`) or a synthetic `Error('Email send failed: <reason>')` when the adapter returned a typed failure without a thrown error.
- Context fields are sanitized: `senderName`, `to`, `subject`, `reason`. **The HTML body and any data payload are NOT captured** to avoid leaking PII into the tracker. If you need richer context, wire a `postEmailSend` hook (`docs/hooks.md`).

### Successful sends are not captured

Sentry/error-tracker capture only fires on failure. Successful sends are visible through:

1. Terminal logging (`logging.sends: true`).
2. `postEmailSend` hook (audit log, analytics counter).
3. Provider dashboard (Resend, SMTP relay's own log).

No request-id correlation is automatic — if you need to thread a request id through to email events, pass it via `postEmailSend` and reach for whatever request-id slot your framework uses (`@luckystack/core`'s logger redaction set is the usual seam).

---

## Why `sendEmail` returns instead of throwing

This is intentional and matches the rest of the framework's `[error, value]` / `EmailResult` pattern:

```ts
const result = await sendEmail({ to: '...', subject: '...', html: '...' });
if (!result.ok) {
  // branch on result.reason — no try/catch needed
  return { status: 'error', reason: result.reason };
}
// result.id is the provider message id
```

The only case where `sendEmail` *throws* is the strict `required: true` + no-sender path described above — a configuration error so severe it should crash the boot test, not produce per-request failures.

---

## DLQ / retry patterns

`@luckystack/email` does NOT ship a built-in dead-letter queue. Failed sends are observable (via `postEmailSend` + Sentry) but **not** retried automatically — this is deliberate, because retry semantics depend heavily on provider quirks (Resend's rate limit headers, SMTP soft-bounce codes, regional ESP quotas). A timeout or caller abort after dispatch reports `deliveryOutcome: 'unknown'`; retry only with the same caller-supplied idempotency key, because the first attempt may still arrive.

The recommended pattern is a `postEmailSend` hook + a worker process:

```ts
import { registerHook } from '@luckystack/core';

const PERMANENT_REASONS = new Set([
  'no-sender',
  'no-template',
  'missing-from',
  'email.suppressed',
]);

registerHook('postEmailSend', async ({ message, adapter, ok, reason }) => {
  if (ok) return;
  if (PERMANENT_REASONS.has(reason ?? '')) {
    // Don't retry these — alert and move on.
    await alertOps({ severity: 'high', adapter, reason });
    return;
  }
  // Transient failure (provider 5xx, timeout, etc.): persist for the retry worker.
  await prisma.emailDlq.create({
    data: {
      to: Array.isArray(message.to) ? message.to.join(',') : message.to,
      subject: message.subject,
      html: message.html,
      text: message.text ?? null,
      adapter,
      reason: reason ?? 'unknown',
      retryAt: new Date(Date.now() + 5 * 60 * 1000),
      retryCount: 0,
    },
  });
});
```

Then a separate worker pulls due rows, calls `sendEmail` again, and re-enqueues on failure with exponential backoff. Drop rows after N retries to avoid unbounded growth.

`messageId` correlation: if the provider returned `messageId` on a *previous* attempt and is now reporting a delayed bounce, you can correlate by storing the id alongside the DLQ row.

---

## Edge cases (full list)

| Situation | Behaviour |
| --- | --- |
| Adapter returns `undefined` from `send` | `{ ok: false, reason: 'send-no-result' }`. No throw. Sentry capture fires with a synthetic `Error('Email send failed: send-no-result')`. |
| Adapter throws | Caught by `tryCatch`, normalized to `{ ok: false, reason: error.message || 'send-threw', cause: error }`. Sentry capture uses `cause` (preserves stack). |
| `preEmailSend` returns a stop signal | Per the architecture doc: `sendEmail` returns `{ ok: false, reason: signal.errorCode }`, `sender.send` is never called, `postEmailSend` is *not* dispatched. **Current implementation caveat:** the abort wiring inside `sendEmail.ts` does not explicitly check the dispatcher's `stopped` flag in this revision — see `docs/hooks.md` for the workaround. |
| Requested `adapter` slot missing | Returns `{ ok: false, reason: 'no-sender' }` — explicit adapter routing is a security contract (EMAIL-O4). No silent fallthrough to a different sender. When `emailConfig.required === true` this path throws instead. |
| Hook handler throws | Caught by the dispatcher, logged + captured, dispatch continues with next handler. Never blocks the main send flow. |
| Logger not registered | Falls back to `console.warn` / `console.info`. Same per-line content. |
| Error-tracker not registered | `captureException` is a no-op. No crash, no warning. |
| Template `render` or `subject` throws | `sendEmail` catches it (via `tryCatchSync`) and returns `{ ok: false, reason: 'template-render-failed' }`. No try/catch is needed at the call site. |
| `from` resolves to empty string | `from` is set to `getEmailConfig().from` when omitted (default `'noreply@example.com'`). To trigger `'missing-from'`, the adapter's constructor `from` must also be unset AND the message's `from` empty. |

---

## Worked examples

### A. Hard-fail boot when sender missing in prod

```ts
// server/server.ts
import { registerEmailConfig, autoSelectEmailSender, registerEmailSender } from '@luckystack/email';

registerEmailConfig({
  required: process.env.NODE_ENV === 'production',
  logging: { errors: true, sends: false },
});
registerEmailSender(autoSelectEmailSender());
```

In production a missing sender crashes the boot test (or the first `sendEmail` call). In dev it soft-fails and logs to terminal.

### B. Route DLQ on `postEmailSend`

```ts
import { registerHook } from '@luckystack/core';

registerHook('postEmailSend', async ({ message, adapter, ok, reason }) => {
  if (ok) return;
  if (['no-sender', 'no-template', 'missing-from'].includes(reason ?? '')) {
    await alertOps({ adapter, reason });
    return;
  }
  await prisma.emailDlq.create({
    data: {
      payload: JSON.stringify(message),
      adapter,
      reason: reason ?? 'unknown',
      retryAt: new Date(Date.now() + 5 * 60 * 1000),
    },
  });
});
```

A separate cron / worker reads `emailDlq` rows whose `retryAt <= now()`, re-invokes `sendEmail`, and bumps `retryAt` with exponential backoff on continued failure.

### C. Alert ops on a streak of `'no-template'` failures

```ts
import { registerHook } from '@luckystack/core';

let consecutiveTemplateFailures = 0;

registerHook('postEmailSend', async ({ ok, reason, message, adapter }) => {
  if (ok) {
    consecutiveTemplateFailures = 0;
    return;
  }
  if (reason === 'no-template') {
    consecutiveTemplateFailures += 1;
    if (consecutiveTemplateFailures === 5) {
      await alertOps({
        severity: 'high',
        message: `5 consecutive 'no-template' email failures via ${adapter} — recent template was for "${message.subject}". A deploy may have dropped a registration.`,
      });
    }
  } else {
    consecutiveTemplateFailures = 0;
  }
});
```

This catches the most common "we forgot to register the template at boot" regression — usually visible in tests but easy to miss in canary deploys.

---

## Quick reference

```ts
import { sendEmail } from '@luckystack/email';

const result = await sendEmail({
  to: 'user@example.com',
  subject: 'Welcome',
  html: '<p>Hi</p>',
});

if (!result.ok) {
  switch (result.reason) {
    case 'no-sender':
      // boot-time misconfiguration — set required: true to crash here
      break;
    case 'no-template':
      // template name typo or missing boot registration
      break;
    case 'missing-from':
      // neither message.from nor adapter's default `from` set
      break;
    default:
      // provider error: result.reason is the provider's message,
      // result.cause is the original error object
      break;
  }
}
```

---

## Related source

- `packages/email/src/sendEmail.ts` — the pipeline (resolve sender, build message, dispatch hooks, run adapter, log, capture).
- `packages/email/src/adapters/resend.ts` / `smtp.ts` / `console.ts` — adapter-level reason mapping.
- `packages/core/src/hooks/registry.ts` — `dispatchHook` and the handler-isolation try/catch.
- `packages/core/src/sentrySetup.ts` — `captureException` fan-out into the active error-tracker registry.
