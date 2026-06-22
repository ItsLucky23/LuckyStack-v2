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

//? OAuth provider → canonical authorization-endpoint origin (added to
//? EXTERNAL_ORIGINS so the framework's origin gate passes the callback). Mirrors
//? the scaffolder's OAUTH_PROVIDER_ORIGINS.
export const OAUTH_ORIGINS: Readonly<Record<OAuthProvider, string>> = {
  google: 'https://accounts.google.com',
  github: 'https://github.com',
  facebook: 'https://www.facebook.com',
  discord: 'https://discord.com',
  microsoft: 'https://login.microsoftonline.com',
};

//? Empty placeholder lines appended to `.env.local` when a provider is added — the
//? developer fills the values. DEV_* are read outside production; the unprefixed
//? pair is read in production. A provider stays disabled until BOTH id + secret
//? are set, so empty placeholders are inert until filled.
export const oauthEnvLines = (provider: OAuthProvider): string[] => {
  const upper = provider.toUpperCase();
  const lines = [
    `# ${provider} OAuth — fill BOTH to enable; register http://localhost:80/auth/callback/${provider} in the provider console.`,
    `DEV_${upper}_CLIENT_ID=`,
    `DEV_${upper}_CLIENT_SECRET=`,
    `${upper}_CLIENT_ID=`,
    `${upper}_CLIENT_SECRET=`,
  ];
  //? MICROSOFT_TENANT_ID: 'common' allows any Microsoft account; replace with a
  //? specific tenant UUID to restrict to one organization. This is a REAL default
  //? (not a placeholder) — it makes microsoft OAuth work for multi-tenant apps
  //? without requiring the developer to fill in a value. It is registered as a
  //? shipped default in `blockPlaceholderDefaults`, so `dropEnvBlock` treats an
  //? UNTOUCHED `=common` as inert (the block auto-removes); only a developer who
  //? pinned a specific tenant UUID keeps the block + gets the "clear by hand" warn.
  if (provider === 'microsoft') lines.push('MICROSOFT_TENANT_ID=common');
  return lines;
};

//? Placeholder env lines for an email adapter (resend / smtp). `none` / `console`
//? have no keys (console is the default sender once @luckystack/email is installed).
export const emailEnvLines = (provider: EmailProvider): string[] => {
  if (provider === 'resend') return ['# Resend — set your API key.', 'RESEND_API_KEY=', 'EMAIL_FROM=noreply@example.com'];
  if (provider === 'smtp') {
    return ['# SMTP — set host + credentials.', 'SMTP_HOST=', 'SMTP_PORT=587', 'SMTP_SECURE=false', 'SMTP_USER=', 'SMTP_PASS=', 'EMAIL_FROM=noreply@example.com'];
  }
  return [];
};

//? Placeholder env lines for a monitoring backend.
export const monitoringEnvLines = (provider: MonitoringProvider): string[] => {
  if (provider === 'sentry') return ['# Sentry — set the DSN (captures in all envs once set; SENTRY_ENABLED=false opts out).', 'SENTRY_DSN=', '# SENTRY_ENABLED=false'];
  if (provider === 'posthog') return ['# PostHog — set the key.', 'POSTHOG_KEY=', 'POSTHOG_HOST=https://us.i.posthog.com'];
  if (provider === 'datadog') return ['# Datadog — set the key AND uncomment the dd-trace block atop server/server.ts.', 'DD_API_KEY=', 'DD_SITE=datadoghq.com'];
  return [];
};

//? The KEY → shipped-default-VALUE map for a block, including ONLY keys whose
//? generated placeholder line carries a NON-EMPTY default (e.g.
//? `EMAIL_FROM=noreply@example.com`, `SMTP_PORT=587`, `MICROSOFT_TENANT_ID=common`).
//? `dropEnvBlock` uses this to tell an UNTOUCHED shipped default apart from a real
//? developer-typed secret: a value equal to its shipped default is inert and the
//? block can be auto-removed; a changed/added value is a real secret and the block
//? is kept (ADR 0014 D1). Empty-default keys are absent from the map, so any
//? non-empty value there still counts as developer-filled. Unknown id → empty map.
export const blockPlaceholderDefaults = (id: string): Map<string, string> => {
  const [kind, provider = ''] = id.split(':');
  let lines: readonly string[] = [];
  if (kind === 'oauth' && (OAUTH_PROVIDERS as readonly string[]).includes(provider)) {
    lines = oauthEnvLines(provider as OAuthProvider);
  } else if (kind === 'email' && (EMAIL_PROVIDERS as readonly string[]).includes(provider)) {
    lines = emailEnvLines(provider as EmailProvider);
  } else if (kind === 'monitoring' && (MONITORING_PROVIDERS as readonly string[]).includes(provider)) {
    lines = monitoringEnvLines(provider as MonitoringProvider);
  }
  const map = new Map<string, string>();
  for (const line of lines) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    const value = (match?.[2] ?? '').trim();
    if (match && value.length > 0) map.set(match[1] ?? '', value);
  }
  return map;
};

//? Extra npm deps a monitoring backend needs (beyond @luckystack/error-tracking).
//? Mirrors the scaffolder's MONITORING_PROVIDERS deps.
export const monitoringDeps: Readonly<Record<MonitoringProvider, Readonly<Record<string, string>>>> = {
  none: {},
  sentry: { '@sentry/node': '^10.48.0' },
  posthog: { 'posthog-node': '^4.0.0' },
  datadog: { 'dd-trace': '^5.0.0', 'hot-shots': '^10.0.0' },
};
