# Email Hooks (`preEmailSend`, `postEmailSend`)

> Deep-doc for the two hooks `@luckystack/email` dispatches around every send. See also:
> - Adapters: `packages/email/docs/adapters.md`
> - Templates: `packages/email/docs/templates.md`
> - Error handling: `packages/email/docs/error-handling.md`
> - Hook bus source: `packages/core/src/hooks/registry.ts`

`sendEmail` dispatches two hooks for every message — `preEmailSend` before the adapter is called, `postEmailSend` after. They fire for both application-driven emails and framework-internal emails (currently `@luckystack/login`'s password-reset orchestrator), so a single audit consumer sees the entire transactional-mail surface without having to wrap `sendEmail` or fork login.

The hooks are owned by `@luckystack/email` (payloads live in `packages/email/src/hookPayloads.ts`) but registered through `@luckystack/core`'s hook bus.

---

## Payload shapes

```ts
import type { EmailMessage } from '@luckystack/core';

interface PreEmailSendPayload {
  message: EmailMessage; // already has `from` resolved from config
  adapter: string;       // adapter's `name` field: 'console' | 'resend' | 'smtp' | custom
}

interface PostEmailSendPayload {
  message: EmailMessage; // same reference passed to the pre hook
  adapter: string;       // adapter's `name`
  ok: boolean;           // mirrors EmailResult.ok
  messageId?: string;    // set when ok === true
  reason?: string;       // set when ok === false
}
```

`EmailMessage` is the resolved message that the adapter actually receives:

```ts
interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;     // populated from `input.from` ?? `getEmailConfig().from`
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
}
```

> The `message` reference is shared between the `pre` and `post` payloads. If your `preEmailSend` handler mutates `message` (e.g. rewrites `to` to a bounce-list filter), the mutation persists into the adapter call AND into the `postEmailSend` payload. Mutating in-place is supported but document it loudly — most consumers expect the payload to be read-only.

### Type augmentation

`packages/email/src/hookPayloads.ts` augments `@luckystack/core`'s `HookPayloads` map via TypeScript module augmentation, so `HookName` automatically includes `'preEmailSend'` and `'postEmailSend'` as soon as `@luckystack/email` is installed and imported anywhere in the build graph.

The augmentation lives at module-load time — the side-effect import in `packages/email/src/index.ts` (`import './hookPayloads';`) guarantees that any project pulling the email barrel gets the type merge. If you only need the types (no runtime), `import type { PreEmailSendPayload, PostEmailSendPayload } from '@luckystack/email';` also re-exports them.

---

## Subscribing — the actual API name is `registerHook`

`@luckystack/core` exports **`registerHook`** (and `dispatchHook` for internal framework code that fires hooks). The email README's "Hooks" section calls it `registerHook`, which is correct — there is no `addHook` or `onHook` alias. Older drafts that referenced `dispatchHook` were describing the internal fire-side primitive, not the consumer-side subscribe API.

Consumer code subscribes like this:

```ts
import { registerHook } from '@luckystack/core';

registerHook('preEmailSend', async ({ message, adapter }) => {
  // ...
});

registerHook('postEmailSend', async ({ message, adapter, ok, messageId, reason }) => {
  // ...
});
```

- `registerHook` is the public consumer-side API. Call it at boot.
- `dispatchHook` is internal — only framework packages call it (in this case `sendEmail`). Application code should never call `dispatchHook('preEmailSend', ...)` directly.
- `clearAllHooks()` is test-only and drops every registered handler, including framework-internal ones. Never call in production paths.

Multiple handlers can register for the same hook. They run in registration order. The first handler that returns a stop signal aborts the dispatch (see below); subsequent handlers do not run.

### Handler signature

```ts
import type { HookHandler, HookStopSignal } from '@luckystack/core';

// HookHandler<TPayload> = (payload) => Promise<HookResult> | HookResult
// HookResult = undefined | HookStopSignal

interface HookStopSignal {
  stop: true;
  errorCode: string;
  httpStatus?: number; // unused by sendEmail; included for parity with other framework hooks
}
```

- Return `undefined` (or just don't return anything) to let the flow continue.
- Return a stop signal `{ stop: true, errorCode: 'email.suppressed' }` to abort. Only `preEmailSend` can usefully abort — see "Stop-signal contract" below.

---

## Execution order inside `sendEmail`

```
sendEmail(input)
  |
  +-- resolveSender(input)                              // input.adapter -> adapterHint -> 'default' -> legacy single
  |
  +-- build EmailMessage                                // raw `{ subject, html }` OR `{ template, data }`
  |     (returns 'no-template' early if template missing)
  |
  +-- await dispatchHook('preEmailSend', { message, adapter: sender.name })
  |     |
  |     +-- handler 1
  |     +-- handler 2  ... in registration order
  |     +-- first handler that returns { stop: true, errorCode } -> dispatch returns stopped result
  |
  +-- if pre stopped: skip the rest and return adapter result built from the stop signal
  |
  +-- await tryCatch(() => sender.send(message))        // adapter call
  |     -> EmailResult on resolve
  |     -> normalized to { ok: false, reason: error.message, cause } on throw
  |     -> normalized to { ok: false, reason: 'send-no-result' } on missing return
  |
  +-- await dispatchHook('postEmailSend', { message, adapter: sender.name, ok, messageId?, reason?, deliveryOutcome? })
  |
  +-- terminal logging (`getLogger().info` / `.warn`) gated by emailConfig.logging.sends / .errors
  |
  +-- Sentry capture on failure (no-op if @luckystack/error-tracking is not initialized)
  |
  +-- return EmailResult
```

> **Current implementation detail:** the `sendEmail` source in `packages/email/src/sendEmail.ts` dispatches `preEmailSend` and then immediately calls `sender.send(...)` without explicitly checking the dispatcher's `stopped` flag. The dispatcher honors the stop contract *internally* (it doesn't run handlers past the first stop), but the abort wiring on the email side is not active in this revision — if you need a true short-circuit today, return `{ ok: false, reason: 'suppressed' }` from a wrapper around `sendEmail`, or mutate `message.to = []` inside `preEmailSend` and let the adapter fail gracefully. Track ARCHITECTURE_EMAIL.md for the documented "honor stop signal" behaviour, which is the target.

---

## Stop-signal contract

The hook bus accepts a stop signal from any pre hook (`preEmailSend`, `preApiValidate`, `preLogin`, ...):

```ts
return { stop: true, errorCode: 'email.suppressed', httpStatus: 451 };
```

- `stop: true` is the discriminator — required.
- `errorCode: string` is the reason the framework returns to the caller. Use a stable, namespaced code (`'email.suppressed'`, `'email.rateLimited'`, `'email.bounceListed'`).
- `httpStatus?: number` is honored by HTTP-bound hooks (API/sync) but unused by `sendEmail` (it returns an `EmailResult`, not an HTTP response).

When you return a signal:

1. The hook dispatcher stops invoking remaining handlers for `preEmailSend`.
2. Per `docs/ARCHITECTURE_EMAIL.md` the intent is: `sendEmail` short-circuits and returns `{ ok: false, reason: signal.errorCode }`. (See current-implementation note above.)
3. `sender.send` is never called.
4. `postEmailSend` is *not* dispatched in the abort path — only the pre hooks were "real". If you need an audit trail of suppressed sends, log it from inside the same `preEmailSend` handler that returned the signal.

Stop signals are not valid from `postEmailSend` — the send has already happened, there is nothing to abort. Returning a signal there is technically allowed by the dispatcher but the framework treats `postEmailSend` results as decorative.

### Handler failures

If a `registerHook` handler **throws** synchronously or rejects its returned promise, the dispatcher:

- Logs the failure (`getLogger().error('hook: handler for "preEmailSend" threw', error, { hook: 'preEmailSend' })`).
- Captures the error to every registered error tracker (`captureException(error, { hook: 'preEmailSend' })`).
- Continues with the *next* handler — a throwing audit log never blocks the main flow.

This isolation is why hooks are safe for third-party packages: a buggy suppression-list query won't accidentally swallow every password-reset email. Errors stay observable but local.

---

## Common patterns

### A. Suppression list

```ts
import { registerHook } from '@luckystack/core';

registerHook('preEmailSend', async ({ message, adapter }) => {
  const recipients = Array.isArray(message.to) ? message.to : [message.to];
  for (const recipient of recipients) {
    if (await isOnSuppressionList(recipient)) {
      return { stop: true, errorCode: 'email.suppressed' };
    }
  }
});
```

### B. Per-recipient rate limit

```ts
import { registerHook, checkRateLimit } from '@luckystack/core';

registerHook('preEmailSend', async ({ message }) => {
  const primary = Array.isArray(message.to) ? message.to[0] : message.to;
  const result = await checkRateLimit({
    key: `email:per-recipient:${primary}`,
    limit: 10,
    windowMs: 60 * 60 * 1000, // 10/hr
  });
  if (!result.allowed) {
    return { stop: true, errorCode: 'email.rateLimited' };
  }
});
```

### C. Audit log

```ts
registerHook('postEmailSend', async ({ message, adapter, ok, messageId, reason }) => {
  await prisma.emailLog.create({
    data: {
      to: Array.isArray(message.to) ? message.to.join(',') : message.to,
      subject: message.subject,
      adapter,
      ok,
      messageId: messageId ?? null,
      reason: reason ?? null,
      sentAt: new Date(),
    },
  });
});
```

### D. Dead-letter queue on repeated failure

```ts
registerHook('postEmailSend', async ({ message, adapter, ok, reason }) => {
  if (ok) return;
  // Hard provider errors that won't fix themselves on retry:
  const permanentReasons = new Set(['no-sender', 'no-template', 'missing-from']);
  if (permanentReasons.has(reason ?? '')) {
    await alertOpsChannel({ severity: 'high', adapter, reason });
    return;
  }
  // Otherwise queue for retry:
  await dlq.enqueue({ message, adapter, reason, retryAt: Date.now() + 5 * 60 * 1000 });
});
```

### E. Analytics on success

```ts
registerHook('postEmailSend', async ({ adapter, ok, message }) => {
  if (!ok) return;
  metrics.increment('email.sent', { adapter, template: detectTemplate(message.subject) });
});
```

---

## Multiple handlers per hook

```ts
registerHook('preEmailSend', auditHandler);
registerHook('preEmailSend', suppressionHandler);
registerHook('preEmailSend', rateLimitHandler);
```

- All three run on every `sendEmail` call, in registration order: `auditHandler` first, then `suppressionHandler`, then `rateLimitHandler`.
- The first handler to return a stop signal aborts the chain. If `suppressionHandler` returns `{ stop: true, errorCode: '...' }`, then `rateLimitHandler` never runs.
- Order matters: put high-value short-circuits (suppression, rate limit) *before* expensive analytics handlers, otherwise you'll do the analytics work for messages you end up dropping.

There is no global "remove handler" or "replace handler" API. Boot order and process isolation are the only knobs.

---

## Edge cases

| Situation | Behaviour |
| --- | --- |
| Handler throws sync | Caught by the dispatcher, logged, captured, dispatch continues with the next handler. |
| Handler rejects async | Same as throwing — caught, logged, captured, dispatch continues. |
| Handler returns `{ stop: true }` without `errorCode` | TypeScript would refuse to compile (`errorCode` is required). At runtime it would still abort, but with `undefined` errorCode — adapt your stop signals to always include a code. |
| Handler mutates `message` | Persists into adapter call AND into `postEmailSend` payload. Use sparingly; document loudly. |
| `preEmailSend` aborts | `postEmailSend` is not dispatched. Track the abort in the same `preEmailSend` handler if you need a trail. |
| Timeout/caller abort after adapter dispatch | `postEmailSend` carries `deliveryOutcome: 'unknown'`; delivery may still happen, so retry only with the same idempotency key. |
| No handlers registered | `dispatchHook` is a cheap no-op — it walks an empty array. |
| Hook handler returns a non-stop, non-undefined value | TypeScript narrows it to `HookStopSignal`. Returning anything else compiles to "do not stop" but you've shadowed the contract — don't. |

---

## Quick reference

```ts
import { registerHook, type HookHandler } from '@luckystack/core';
import type { PreEmailSendPayload, PostEmailSendPayload } from '@luckystack/email';

const preHandler: HookHandler<PreEmailSendPayload> = async ({ message, adapter }) => {
  // return undefined to continue
  // return { stop: true, errorCode: 'email.suppressed' } to abort
};
registerHook('preEmailSend', preHandler);

const postHandler: HookHandler<PostEmailSendPayload> = async ({ message, adapter, ok, messageId, reason }) => {
  // observational only — return value ignored
};
registerHook('postEmailSend', postHandler);
```
