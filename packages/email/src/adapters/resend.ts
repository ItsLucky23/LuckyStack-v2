import type { EmailSender } from '@luckystack/core';

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

//? Wraps the official `resend` npm package. Imported dynamically so projects
//? that don't use this adapter don't need `resend` installed. Returns
//? Resend's email id on success.
export const ResendSender = (options: ResendSenderOptions): EmailSender => {
  const { apiKey, from: defaultFrom } = options;

  if (!apiKey) {
    throw new Error('[email:resend] ResendSender requires `apiKey`.');
  }

  // Lazy import — the `resend` package is an optional peer dep so its types
  // may not be resolvable at the framework's compile time.
  const clientPromise = (
    // @ts-expect-error optional peer dep — types resolved at consumer install time
    import('resend') as Promise<{ Resend: new (apiKey: string) => ResendClient }>
  )
    .then(({ Resend }) => new Resend(apiKey))
    .catch((cause: unknown) => {
      throw new Error(
        '[email:resend] Failed to load `resend` package. Install it with `npm install resend`. ' +
        (cause instanceof Error ? cause.message : String(cause)),
      );
    });

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
        return { ok: false, reason: error.message || 'resend-error', cause: error };
      }
      if (!data) {
        return { ok: false, reason: 'no-response-data' };
      }
      return { ok: true, id: data.id };
    },
  };
};
