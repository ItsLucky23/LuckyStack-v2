import type { EmailSender } from '@luckystack/core';

import { ConsoleSender } from './adapters/console';
import { ResendSender } from './adapters/resend';
import { SmtpSender } from './adapters/smtp';

export interface AutoSelectEmailSenderOptions {
  /**
   * Default `from` address for whichever adapter ends up selected. Override
   * per-message by passing `from` to `sendEmail`. Falls back to
   * `process.env.EMAIL_FROM` when omitted, matching the convention every
   * adapter assumes.
   */
  from?: string;
  /**
   * When set, force a specific adapter regardless of env. Useful for tests
   * that want to assert behavior of one adapter, or for installers who want
   * deterministic dev-vs-prod selection without env mutation.
   */
  force?: 'resend' | 'smtp' | 'console';
}

/**
 * Pick a sensible email adapter from environment variables and return it
 * unregistered. The caller passes the result to `registerEmailSender(...)`.
 *
 * Selection order:
 *   1. `RESEND_API_KEY` set      → ResendSender
 *   2. `SMTP_HOST` set            → SmtpSender (port/secure/auth from env)
 *   3. otherwise                  → ConsoleSender (dev-safe; logs to terminal)
 *
 * Recognized env vars:
 *   - `RESEND_API_KEY`
 *   - `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_SECURE` ('true' for TLS),
 *     `SMTP_USER`, `SMTP_PASS`
 *   - `EMAIL_FROM` (used when `options.from` is omitted)
 *
 * Every project used to repeat this logic in their own `server.ts`. Centralizing
 * it here is the difference between a one-line install and copy-paste boilerplate.
 */
export const autoSelectEmailSender = (options: AutoSelectEmailSenderOptions = {}): EmailSender => {
  const from = options.from ?? process.env.EMAIL_FROM;
  const force = options.force;

  if (force === 'console') return ConsoleSender({ from });
  if (force === 'resend') {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('autoSelectEmailSender: force=resend requires RESEND_API_KEY env var.');
    }
    return ResendSender({ apiKey: process.env.RESEND_API_KEY, from });
  }
  if (force === 'smtp') {
    if (!process.env.SMTP_HOST) {
      throw new Error('autoSelectEmailSender: force=smtp requires SMTP_HOST env var.');
    }
    return SmtpSender({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
      from,
    });
  }

  if (process.env.RESEND_API_KEY) {
    return ResendSender({ apiKey: process.env.RESEND_API_KEY, from });
  }
  if (process.env.SMTP_HOST) {
    return SmtpSender({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
      from,
    });
  }
  return ConsoleSender({ from });
};
