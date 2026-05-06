import type { EmailSender } from '@luckystack/core';

interface SmtpSenderOptions {
  host: string;
  port: number;
  /** True for TLS on connect (port 465), false for STARTTLS upgrade (port 587). */
  secure?: boolean;
  auth?: {
    user: string;
    pass: string;
  };
  from?: string;
}

//? Wraps Nodemailer. Lazy-imported so consumers who only use Resend (or only
//? Console) don't need nodemailer installed.
export const SmtpSender = (options: SmtpSenderOptions): EmailSender => {
  const { from: defaultFrom, ...smtpConfig } = options;

  // One transporter per SmtpSender instance — created lazily on first send.
  // `nodemailer` is an optional peer dep; the dynamic import has no type for
  // it from the framework's standpoint (consumers install it themselves), so
  // suppress the dts-time check.
  const transporterPromise = (
    // @ts-expect-error optional peer dep — types resolved at consumer install time
    import('nodemailer') as Promise<{
      default?: { createTransport: (config: unknown) => unknown };
      createTransport?: (config: unknown) => unknown;
    }>
  )
    .then((mod) => {
      const factory = mod.default?.createTransport ?? mod.createTransport;
      if (!factory) {
        throw new Error('[email:smtp] nodemailer module has no createTransport export.');
      }
      return factory(smtpConfig) as {
        sendMail: (input: Record<string, unknown>) => Promise<{ messageId?: string | number }>;
      };
    })
    .catch((cause: unknown) => {
      throw new Error(
        '[email:smtp] Failed to load `nodemailer` package. Install it with `npm install nodemailer @types/nodemailer`. ' +
        (cause instanceof Error ? cause.message : String(cause)),
      );
    });

  return {
    name: 'smtp',
    send: async (message) => {
      const transporter = await transporterPromise;
      const fromAddress = message.from ?? defaultFrom;
      if (!fromAddress) {
        return { ok: false, reason: 'missing-from' };
      }

      try {
        const info = await transporter.sendMail({
          from: fromAddress,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          replyTo: message.replyTo,
          cc: message.cc,
          bcc: message.bcc,
        });
        return { ok: true, id: String(info.messageId ?? `smtp-${String(Date.now())}`) };
      } catch (cause) {
        return {
          ok: false,
          reason: cause instanceof Error ? cause.message : 'smtp-error',
          cause,
        };
      }
    },
  };
};
