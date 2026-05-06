//? Email-sender registry. Same pattern as the notifier and sentry adapter:
//? framework code calls `getEmailSender()`; if no consumer registered one,
//? it returns null and callers decide whether that's an error.
//?
//? Types live here (not in `@luckystack/email`) so framework packages can
//? type-check against them without depending on the email package — keeping
//? the email package optional.

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
}

export type EmailResult =
  | { ok: true; id: string }
  | { ok: false; reason: string; cause?: unknown };

export interface EmailSender {
  /** Adapter identifier for logs + diagnostics ("console", "resend", "smtp", etc.). */
  name: string;
  send: (message: EmailMessage) => Promise<EmailResult>;
}

let activeSender: EmailSender | null = null;

export const registerEmailSender = (sender: EmailSender): void => {
  activeSender = sender;
};

export const getEmailSender = (): EmailSender | null => activeSender;

export const isEmailSenderRegistered = (): boolean => activeSender !== null;
