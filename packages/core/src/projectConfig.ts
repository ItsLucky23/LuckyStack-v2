//? Project-level runtime configuration, consumed by framework packages via
//? `getProjectConfig()`. The project's entrypoint calls
//? `registerProjectConfig({...})` once at boot — before any framework code
//? issues API/sync requests — mirroring the pattern we use for the localized
//? normalizer.
//?
//? Everything here is runtime-settable. Type-level project shapes
//? (`SessionLayout`, etc.) stay in the project's `config.ts` so TypeScript
//? inference keeps working at call sites.
//?
//? Framework code reads values through `getProjectConfig()` (call-time) or
//? the pre-destructured helpers below. Never read at module load — that
//? captures whatever was registered at import time, which is fragile.

export interface LoggingConfig {
  devLogs: boolean;
  devNotifications: boolean;
  socketStatus: boolean;
  socketStartup: boolean;
  stream: boolean;
}

export interface RateLimitingConfig {
  store: 'memory' | 'redis';
  redisKeyPrefix: string;
  defaultApiLimit: number | false;
  defaultIpLimit: number | false;
  windowMs: number;
}

export interface SessionConfig {
  basedToken: boolean;
  expiryDays: number;
  allowMultiple: boolean;
}

export interface SentrySampleRates {
  development: number;
  production: number;
}

export interface SentryConfig {
  client?: {
    tracesSampleRate?: SentrySampleRates;
    replaysSessionSampleRate?: SentrySampleRates;
    replaysOnErrorSampleRate?: SentrySampleRates;
  };
  server?: {
    tracesSampleRate?: SentrySampleRates;
  };
}

export interface ProjectConfig {
  logging: LoggingConfig;
  rateLimiting: RateLimitingConfig;
  session: SessionConfig;
  defaultLanguage: string;
  sentry?: SentryConfig;
}

const DEFAULT_CONFIG: ProjectConfig = {
  logging: {
    devLogs: false,
    devNotifications: false,
    socketStatus: false,
    socketStartup: false,
    stream: false,
  },
  rateLimiting: {
    store: 'memory',
    redisKeyPrefix: 'rate-limit',
    defaultApiLimit: 60,
    defaultIpLimit: 100,
    windowMs: 60_000,
  },
  session: {
    basedToken: false,
    expiryDays: 7,
    allowMultiple: false,
  },
  defaultLanguage: 'en',
};

let activeConfig: ProjectConfig = DEFAULT_CONFIG;
let isRegistered = false;

export const registerProjectConfig = (config: ProjectConfig): void => {
  activeConfig = config;
  isRegistered = true;
};

export const getProjectConfig = (): ProjectConfig => activeConfig;

//? Guard for code paths that MUST run after registration (e.g. the server's
//? startup sequence). Log once, never throw — framework packages should
//? still do something reasonable when called in a test or CLI context that
//? never registered.
export const isProjectConfigRegistered = (): boolean => isRegistered;
