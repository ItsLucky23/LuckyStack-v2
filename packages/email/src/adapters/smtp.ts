import { createRequire } from 'node:module';

import { loadPeer, tryCatch, type EmailSender } from '@luckystack/core';

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

//? `localRequire` (built from THIS module's `import.meta.url`) is passed to
//? `loadPeer` so resolution + load happen from the adapter's perspective, not
//? core's node_modules.
const localRequire = createRequire(import.meta.url);

//? Wraps Nodemailer. Lazy-loaded so consumers who only use Resend (or only
//? Console) don't need nodemailer installed.
//?
//? Boot-time guard: synchronously loads the `nodemailer` package at factory
//? call time. If the consumer set SMTP_HOST without installing the package,
//? the server crashes during bootstrap instead of silently failing on the
//? first email send.
export const SmtpSender = (options: SmtpSenderOptions): EmailSender => {
  const { from: defaultFrom, ...smtpConfig } = options;

  const mod = loadPeer<{
    default?: { createTransport: (config: unknown) => unknown };
    createTransport?: (config: unknown) => unknown;
  }>(
    'nodemailer',
    'Run `npm install nodemailer @types/nodemailer`, or remove the SMTP_HOST env var and pick a different EmailSender adapter.',
    localRequire,
  );
  const factory = mod.default?.createTransport ?? mod.createTransport;
  if (!factory) {
    throw new Error('[email:smtp] nodemailer module has no createTransport export.');
  }
  const transporter = factory(smtpConfig) as {
    sendMail: (input: Record<string, unknown>) => Promise<{ messageId?: string | number }>;
  };

  return {
    name: 'smtp',
    send: async (message) => {
      const fromAddress = message.from ?? defaultFrom;
      if (!fromAddress) {
        return { ok: false, reason: 'missing-from' };
      }

      const [error, info] = await tryCatch(() => transporter.sendMail({
        from: fromAddress,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        replyTo: message.replyTo,
        cc: message.cc,
        bcc: message.bcc,
      }));
      if (error) {
        return {
          ok: false,
          reason: error.message || 'smtp-error',
          cause: error,
        };
      }
      return { ok: true, id: String(info?.messageId ?? `smtp-${String(Date.now())}`) };
    },
  };
};
