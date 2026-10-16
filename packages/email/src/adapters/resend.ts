import { createRequire } from 'node:module';

import { ensurePeerDepInstalled, type EmailSender } from '@luckystack/core';

import { toProviderPayload } from './providerPayload';

interface ResendSenderOptions {
  apiKey: string;
  /** Default sender address. Overridden per-message if the message specifies `from`. */
  from?: string;
}

interface ResendClient {
  emails: {
    send: (input: Record<string, unknown>, options?: { idempotencyKey?: string }) => Promise<{
      data: { id: string } | null;
      error: { message?: string; statusCode?: number | null; name?: string } | null;
    }>;
  };
}

const localRequire = createRequire(import.meta.url);

//? Resend error names after which no mail can go out until an operator acts.
//? `rate_limit_exceeded` is absent on purpose: it clears within a second.
const SENDER_BLOCKING_CODES = new Set([
  'daily_quota_exceeded',
  'monthly_quota_exceeded',
  'invalid_api_key',
  'missing_api_key',
  'restricted_api_key',
]);

//? Wraps the official `resend` npm package. Imported dynamically so projects
//? that don't use this adapter don't need `resend` installed. Returns
//? Resend's email id on success.
//?
//? Boot-time guard: synchronously resolves the `resend` package at factory
//? call time. If the consumer set RESEND_API_KEY without installing the
//? package, the server crashes during bootstrap instead of silently failing
//? on the first email send.
export const ResendSender = (options: ResendSenderOptions): EmailSender => {
  const { apiKey, from: defaultFrom } = options;

  if (!apiKey) {
    throw new Error('[email:resend] ResendSender requires `apiKey`.');
  }

  //? Boot-time guard (CC-3): resolve `resend` from the ADAPTER's node_modules.
  //? The actual load stays a dynamic ESM `import('resend')` below — `resend` is
  //? ESM-only, so a CJS `require` would fail; ensurePeerDepInstalled only does
  //? the `require.resolve` existence check, not the load.
  ensurePeerDepInstalled(
    'resend',
    'Run `npm install resend`, or remove the RESEND_API_KEY env var and pick a different EmailSender adapter.',
    localRequire,
  );

  const clientPromise = (
    // @ts-expect-error optional peer dep — types resolved at consumer install time
    import('resend') as Promise<{ Resend: new (apiKey: string) => ResendClient }>
  )
    .then(({ Resend }) => new Resend(apiKey));

  //? Defensive: attach a no-op rejection handler to a SEPARATE promise so an
  //? import failure before the first `send()` doesn't surface as an
  //? `unhandledRejection` and crash the process. `send` still awaits the
  //? original `clientPromise`, which still rejects identically — this only
  //? marks the floating branch handled, it changes no failure semantics.
  void clientPromise.catch(() => { /* intentional no-op: prevents unhandledRejection before first send() */ });

  return {
    name: 'resend',
    send: async (message, context) => {
      if (context?.signal.aborted) {
        return { ok: false, reason: 'send-aborted', deliveryOutcome: 'not-sent' };
      }
      const client = await clientPromise;
      if (context?.signal.aborted) {
        return { ok: false, reason: 'send-aborted', deliveryOutcome: 'not-sent' };
      }
      const fromAddress = message.from ?? defaultFrom;
      if (!fromAddress) {
        return { ok: false, reason: 'missing-from', deliveryOutcome: 'not-sent' };
      }

      const { data, error } = await client.emails.send(
        toProviderPayload(message, fromAddress),
        context?.idempotencyKey ? { idempotencyKey: context.idempotencyKey } : undefined,
      );

      if (error) {
        const status = typeof error.statusCode === 'number' ? error.statusCode : undefined;
        //? A used-up quota or a rejected key refuses every following mail too.
        const blocksSender = error.name !== undefined && SENDER_BLOCKING_CODES.has(error.name);
        //? 429 (rate limit or quota) and a rejected key are refusals before
        //? Resend accepted the mail, so they are definitively not-sent. Other
        //? errors keep no outcome: a 5xx or dropped connection may still have
        //? been accepted.
        const refused = status === 429 || blocksSender;
        return {
          ok: false,
          reason: error.message || 'resend-error', // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- empty `message` should fall back too
          cause: error,
          ...(error.name === undefined ? {} : { code: error.name }),
          ...(status === undefined ? {} : { status }),
          ...(refused ? { deliveryOutcome: 'not-sent' as const } : {}),
          ...(blocksSender ? { blocksSender: true } : {}),
        };
      }
      if (!data) {
        return { ok: false, reason: 'no-response-data' };
      }
      return { ok: true, id: data.id };
    },
  };
};
