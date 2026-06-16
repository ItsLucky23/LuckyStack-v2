//? Email-package-owned runtime configuration. Mirrors the same lazy
//? registration pattern as `@luckystack/presence`'s `registerPresenceConfig`
//? so consumers can `registerEmailConfig({...})` after the package is
//? imported.
//?
//? Lives in `@luckystack/email` (not `@luckystack/core`) so projects that
//? don't install the email package never have to look at email-specific
//? knobs in their `ProjectConfig`. `publicUrl` (used for both transactional
//? email links AND OAuth callback redirects) stays in core's `app.publicUrl`
//? because it isn't email-specific.

import { deepMerge, type DeepPartial } from '@luckystack/core';

export interface EmailLoggingConfig {
  /** Log a warning to terminal when an email fails to send. */
  errors: boolean;
  /** Log a concise success line for each sent email (recipient + subject). */
  sends: boolean;
}

export interface EmailEnvVarsConfig {
  /** Env var name that holds the Resend API key (default `RESEND_API_KEY`). */
  resendApiKey: string;
  /** Env var name that holds the SMTP host (default `SMTP_HOST`). */
  smtpHost: string;
  /** Env var name that holds the SMTP port (default `SMTP_PORT`). */
  smtpPort: string;
  /** Env var name that holds the SMTP secure flag (default `SMTP_SECURE`). */
  smtpSecure: string;
  /** Env var name that holds the SMTP auth user (default `SMTP_USER`). */
  smtpUser: string;
  /** Env var name that holds the SMTP auth password (default `SMTP_PASS`). */
  smtpPass: string;
  /** Env var name that holds the default `from` address (default `EMAIL_FROM`). */
  emailFrom: string;
}

export interface EmailDefaultsConfig {
  /** SMTP port fallback when the env var resolves to nothing (default 587). */
  smtpPort: number;
}

export interface EmailConfig {
  /** Default `from` address used when a message doesn't override it. */
  from: string;
  /**
   * When true, `sendEmail()` throws if no email sender is registered.
   * Default false: it returns `{ ok: false, reason: 'no-sender' }` instead.
   */
  required: boolean;
  /** Terminal logging flags (independent of any error-tracking adapter). */
  logging: EmailLoggingConfig;
  /**
   * Env-var name overrides for `autoSelectEmailSender(...)`. Lets installers
   * rename the variables (`RESEND_API_KEY` -> `MY_APP_RESEND_KEY`) without
   * forking the framework.
   */
  envVars: EmailEnvVarsConfig;
  /** Numeric defaults used when the env var resolves to nothing. */
  defaults: EmailDefaultsConfig;
  /**
   * Maximum milliseconds to wait for a single `sender.send()` call before
   * treating it as a failure (reason `'send-timeout'`). Set to `false` to
   * disable the timeout entirely. Default: 30 000 ms (30 s).
   *
   * EMAIL-O8: an SMTP/Resend call that never resolves would otherwise hang
   * the request indefinitely.
   */
  sendTimeoutMs: number | false;
  /**
   * HMAC-SHA-256 key used to hash recipient addresses in error-tracking and
   * log contexts. A keyed hash means the same address always correlates across
   * reports (useful for deduplication) but cannot be reversed without the key.
   *
   * EMAIL-O5: an un-keyed SHA-256 hash is an enumeration oracle — an attacker
   * with the hash can brute-force common email addresses offline. Setting this
   * key makes the hash non-invertible without it.
   *
   * Leave `undefined` (the default) to fall back to an un-keyed SHA-256 with
   * a dev-mode console warning. Set to an empty string to silence the warning
   * and keep un-keyed hashing (opt-in; document the tradeoff in your ADR).
   */
  recipientHmacKey: string | undefined;
}

export const DEFAULT_EMAIL_CONFIG: EmailConfig = {
  from: 'noreply@example.com',
  required: false,
  logging: {
    errors: true,
    sends: false,
  },
  envVars: {
    resendApiKey: 'RESEND_API_KEY',
    smtpHost: 'SMTP_HOST',
    smtpPort: 'SMTP_PORT',
    smtpSecure: 'SMTP_SECURE',
    smtpUser: 'SMTP_USER',
    smtpPass: 'SMTP_PASS',
    emailFrom: 'EMAIL_FROM',
  },
  defaults: {
    smtpPort: 587,
  },
  sendTimeoutMs: 30_000,
  recipientHmacKey: undefined,
};

export type EmailConfigInput = DeepPartial<EmailConfig>;

let activeConfig: EmailConfig = DEFAULT_EMAIL_CONFIG;

export const registerEmailConfig = (config: EmailConfigInput): void => {
  activeConfig = deepMerge(DEFAULT_EMAIL_CONFIG, config);
};

export const getEmailConfig = (): EmailConfig => activeConfig;
