//? The configurable sub-option surface for `manage` reconfiguration, mirrored
//? from create-luckystack-app's `PROVIDER_OPTIONS`. Kept here as the CLI's own
//? source of truth (ADR 0014 D3) with a parity test against the scaffolder so the
//? two can't drift. Only the options that are RECONFIGURABLE post-scaffold live
//? here — `dbProvider` (a Prisma migration) is intentionally excluded.

export const AUTH_MODES = ['none', 'credentials', 'credentials+oauth'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export const OAUTH_PROVIDERS = ['google', 'github', 'discord', 'facebook', 'microsoft'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const EMAIL_PROVIDERS = ['none', 'console', 'resend', 'smtp'] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

export const MONITORING_PROVIDERS = ['none', 'sentry', 'datadog', 'posthog'] as const;
export type MonitoringProvider = (typeof MONITORING_PROVIDERS)[number];

//? The env key that signals an OAuth provider is wired. The scaffold emits an
//? uncommented `DEV_<P>_CLIENT_ID=` for a selected provider (and the unprefixed
//? `<P>_CLIENT_ID=` for production), so the presence of EITHER id key (in
//? `.env.local` or `.env`) means "this provider is configured". We check the id
//? key only — never the secret, never any value (ADR 0014 D1).
export const oauthIdKeys = (provider: OAuthProvider): readonly string[] => {
  const upper = provider.toUpperCase();
  return [`DEV_${upper}_CLIENT_ID`, `${upper}_CLIENT_ID`];
};

//? The env key whose PRESENCE marks an email adapter as configured. `console` has
//? no key (it's the default when @luckystack/email is installed but no adapter key
//? is set), so it maps to an empty list and is inferred separately.
export const emailKeys: Readonly<Record<EmailProvider, readonly string[]>> = {
  none: [],
  console: [],
  resend: ['RESEND_API_KEY'],
  smtp: ['SMTP_HOST'],
};

//? The env key whose PRESENCE marks a monitoring backend as configured.
export const monitoringKeys: Readonly<Record<MonitoringProvider, readonly string[]>> = {
  none: [],
  sentry: ['SENTRY_DSN'],
  datadog: ['DD_API_KEY'],
  posthog: ['POSTHOG_KEY'],
};
