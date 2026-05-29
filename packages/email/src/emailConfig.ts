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
};

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object | undefined ? DeepPartial<NonNullable<T[K]>> : T[K];
};

export type EmailConfigInput = DeepPartial<EmailConfig>;

let activeConfig: EmailConfig = DEFAULT_EMAIL_CONFIG;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
};

const deepMerge = <T>(base: T, override: DeepPartial<T> | undefined): T => {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override as T) ?? base;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    if (value === undefined) continue;
    const baseValue = (base as Record<string, unknown>)[key];
    out[key] = isPlainObject(baseValue) && isPlainObject(value) ? deepMerge(baseValue, value as DeepPartial<unknown>) : value;
  }
  return out as T;
};

export const registerEmailConfig = (config: EmailConfigInput): void => {
  activeConfig = deepMerge(DEFAULT_EMAIL_CONFIG, config);
};

export const getEmailConfig = (): EmailConfig => activeConfig;
