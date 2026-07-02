import { type EmailSender, getLogger, resolveEnvKey } from '@luckystack/core';

import { ConsoleSender } from './adapters/console';
import { ResendSender } from './adapters/resend';
import { SmtpSender } from './adapters/smtp';
import { getEmailConfig } from './emailConfig';

export interface AutoSelectEmailSenderOptions {
  /**
   * Default `from` address for whichever adapter ends up selected. Override
   * per-message by passing `from` to `sendEmail`. Falls back to the env var
   * named by `emailConfig.envVars.emailFrom` (default `EMAIL_FROM`).
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
 *   1. Resend API key env var set  → ResendSender
 *   2. SMTP host env var set       → SmtpSender (port/secure/auth from env)
 *   3. otherwise                   → ConsoleSender (dev-safe; logs to terminal)
 *
 * Env var names default to `RESEND_API_KEY` / `SMTP_HOST` / `SMTP_PORT` /
 * `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` but can be renamed
 * via `emailConfig.envVars` (e.g. when an installer keeps secrets
 * under a `MY_APP_*` prefix).
 *
 * Every project used to repeat this logic in their own `server.ts`. Centralizing
 * it here is the difference between a one-line install and copy-paste boilerplate.
 */
export const autoSelectEmailSender = (options: AutoSelectEmailSenderOptions = {}): EmailSender => {
  const emailConfig = getEmailConfig();
  const envVars = emailConfig.envVars;
  const defaults = emailConfig.defaults;

  const resendKey = process.env[envVars.resendApiKey];
  const smtpHost = process.env[envVars.smtpHost];
  const smtpPortRaw = process.env[envVars.smtpPort];
  const smtpSecure = process.env[envVars.smtpSecure] === 'true';
  const smtpUser = process.env[envVars.smtpUser];
  const smtpPass = process.env[envVars.smtpPass];
  const fromEnv = process.env[envVars.emailFrom];

  const from = options.from ?? fromEnv;
  const force = options.force;

  //? Guard against a non-numeric SMTP_PORT env var producing NaN (EMAIL-N1).
  //? Fall back to the configured default (587) so a typo doesn't silently
  //? create an invalid transporter instead of throwing at send time.
  const parsedPort = smtpPortRaw ? Number(smtpPortRaw) : Number.NaN;
  const resolvedSmtpPort = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : defaults.smtpPort;
  const buildSmtp = (host: string) => SmtpSender({
    host,
    port: resolvedSmtpPort,
    secure: smtpSecure,
    auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
    from,
  });

  if (force === 'console') return ConsoleSender({ from });
  if (force === 'resend') {
    if (!resendKey) {
      throw new Error(`autoSelectEmailSender: force=resend requires the ${envVars.resendApiKey} env var.`);
    }
    return ResendSender({ apiKey: resendKey, from });
  }
  if (force === 'smtp') {
    if (!smtpHost) {
      throw new Error(`autoSelectEmailSender: force=smtp requires the ${envVars.smtpHost} env var.`);
    }
    return buildSmtp(smtpHost);
  }

  if (resendKey) {
    return ResendSender({ apiKey: resendKey, from });
  }
  if (smtpHost) {
    return buildSmtp(smtpHost);
  }
  //? L2: ConsoleSender is a DEV fallback — it `console.log`s the full rendered
  //? body instead of sending. In production that silently means (a) users never
  //? receive mail and (b) any body containing a secret (a password-reset URL
  //? carries a live reset token) lands in the log sink until TTL expiry. Warn
  //? loudly so this common prod-misconfig (no RESEND_API_KEY / SMTP_HOST) is
  //? visible; a real prod deploy MUST configure a real adapter.
  if (resolveEnvKey() === 'production') {
    getLogger().warn(
      '[LuckyStack] EMAIL: no email adapter configured (neither RESEND_API_KEY nor SMTP_HOST set) — '
      + 'falling back to ConsoleSender in PRODUCTION. Outbound mail is NOT sent, and any email body '
      + '(incl. password-reset URLs with live tokens) is written to the server log. Configure a real '
      + 'adapter for production.',
    );
  }
  return ConsoleSender({ from });
};
