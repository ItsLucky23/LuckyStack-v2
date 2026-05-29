//? error-tracking package-owned runtime configuration. Mirrors the same
//? lazy registration pattern as `@luckystack/presence`'s
//? `registerPresenceConfig` so consumers can `registerSentryConfig({...})`
//? after the package is imported.
//?
//? Lives in `@luckystack/error-tracking` (not `@luckystack/core`) so projects
//? that don't install the error-tracking package never see Sentry-specific
//? knobs in their `ProjectConfig`.

export interface SentrySampleRates {
  development: number;
  production: number;
}

export interface SentryClientConfig {
  tracesSampleRate?: SentrySampleRates;
  replaysSessionSampleRate?: SentrySampleRates;
  replaysOnErrorSampleRate?: SentrySampleRates;
}

export interface SentryServerConfig {
  tracesSampleRate?: SentrySampleRates;
  /**
   * Errors matching any of these strings are not sent to Sentry. Default
   * `['Socket connection timeout', 'ECONNREFUSED']`. Set to an empty array
   * to disable filtering, or extend with installer-specific noise.
   */
  ignoreErrors?: string[];
}

export interface SentryConfig {
  client?: SentryClientConfig;
  server?: SentryServerConfig;
}

export const DEFAULT_SENTRY_CONFIG: SentryConfig = {
  server: {
    ignoreErrors: ['Socket connection timeout', 'ECONNREFUSED'],
  },
};

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object | undefined ? DeepPartial<NonNullable<T[K]>> : T[K];
};

export type SentryConfigInput = DeepPartial<SentryConfig>;

let activeConfig: SentryConfig = DEFAULT_SENTRY_CONFIG;

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

export const registerSentryConfig = (config: SentryConfigInput): void => {
  activeConfig = deepMerge(DEFAULT_SENTRY_CONFIG, config);
};

export const getSentryConfig = (): SentryConfig => activeConfig;
