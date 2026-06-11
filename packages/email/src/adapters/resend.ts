import { createRequire } from 'node:module';

import { ensurePeerDepInstalled, type EmailSender } from '@luckystack/core';

interface ResendSenderOptions {
  apiKey: string;
  /** Default sender address. Overridden per-message if the message specifies `from`. */
  from?: string;
}

interface ResendClient {
  emails: {
    send: (input: Record<string, unknown>) => Promise<{
      data: { id: string } | null;
      error: { message?: string } | null;
    }>;
  };
}

const localRequire = createRequire(import.meta.url);

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

  return {
    name: 'resend',
    send: async (message) => {
      const client = await clientPromise;
      const fromAddress = message.from ?? defaultFrom;
      if (!fromAddress) {
        return { ok: false, reason: 'missing-from' };
      }

      const { data, error } = await client.emails.send({
        from: fromAddress,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        replyTo: message.replyTo,
        cc: message.cc,
        bcc: message.bcc,
      });

      if (error) {
        return { ok: false, reason: error.message || 'resend-error', cause: error }; // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- empty `message` should fall back too
      }
      if (!data) {
        return { ok: false, reason: 'no-response-data' };
      }
      return { ok: true, id: data.id };
    },
  };
};
