/**
 * Sentry error monitoring initialization for the server.
 *
 * This module initializes Sentry for capturing errors, performance data,
 * and other monitoring information on the backend.
 *
 * @see https://docs.sentry.io/platforms/node/
 */

import { createRequire } from 'node:module';

import {
  getLogger,
  getProjectName,
  initSharedSentry,
  loadPeer,
  captureException as sharedCaptureException,
  captureMessage as sharedCaptureMessage,
  setSentryUser as sharedSetSentryUser,
  startSpan as sharedStartSpan,
} from '@luckystack/core';

import { getSentryConfig } from './sentryConfig';
import { enableErrorTrackingAutoInstrumentation } from './autoInstrumentation';

const localRequire = createRequire(import.meta.url);

//? `@sentry/node` is an OPTIONAL peer. Importing it at module top-level would
//? make `import '@luckystack/error-tracking'` throw ERR_MODULE_NOT_FOUND for
//? consumers on the adapter-only / Datadog / PostHog path who never installed
//? Sentry. Load it lazily (mirroring the Datadog/PostHog/Sentry adapters) so
//? the package stays import-safe and only touches @sentry/node when Sentry is
//? actually initialized or the default export is accessed.
type SentryModule = typeof import('@sentry/node');

let cachedSentry: SentryModule | null = null;

//? `localRequire` (built from THIS module's `import.meta.url`) is passed so
//? resolution + load happen from the package's perspective, not core's
//? node_modules. Result is cached so repeated proxy/property access resolves
//? the optional peer at most once.
const loadSentry = (): SentryModule => {
  if (cachedSentry) return cachedSentry;
  cachedSentry = loadPeer<SentryModule>(
    '@sentry/node',
    'Run `npm install @sentry/node`, or use the adapter API / another tracker instead.',
    localRequire,
  );
  return cachedSentry;
};

//? Resolved, environment-derived inputs for a Sentry init. Returns `null` for
//? the no-DSN no-op branch (so the caller short-circuits identically to before).
interface ResolvedSentryInitConfig {
  dsn: string;
  isProduction: boolean;
  enabledOverride: string | undefined;
  tracesSampleRate: number;
  ignoreErrors: string[];
}

//? Config-build step extracted verbatim from `initializeSentry`. Reads env +
//? the package-owned `getSentryConfig().server` and resolves the same derived
//? values. Returns `null` when no DSN is set (the early-return branch); the
//? production-only warning side-effect is preserved here so call-time behavior
//? is unchanged.
const resolveSentryInitConfig = (): ResolvedSentryInitConfig | null => {
  const dsn = process.env.SENTRY_DSN ?? process.env.VITE_SENTRY_DSN;
  const isProduction = process.env.NODE_ENV === 'production';
  const enabledOverride = process.env.SENTRY_ENABLED ?? process.env.VITE_SENTRY_ENABLED;

  if (!dsn) {
    if (process.env.NODE_ENV === 'production') {
      getLogger().warn('SENTRY_DSN not configured. Error monitoring disabled.');
    }
    return null;
  }

  const sentryConfig = getSentryConfig().server;
  const tracesSampleRate = isProduction
    ? sentryConfig?.tracesSampleRate?.production ?? 0.2
    : sentryConfig?.tracesSampleRate?.development ?? 1;
  const ignoreErrors = sentryConfig?.ignoreErrors ?? ['Socket connection timeout', 'ECONNREFUSED'];

  return { dsn, isProduction, enabledOverride, tracesSampleRate, ignoreErrors };
};

//? beforeSend-assembly step. Strips sensitive cookies before an event is sent —
//? identical body to the inline closure it replaces. Defined at module scope as
//? a plain handler (rather than a factory returning a closure) so it carries no
//? hidden state and is reused as-is for every init.
type SentryBeforeSend = NonNullable<Parameters<SentryModule['init']>[0]>['beforeSend'];
const builtinBeforeSend: SentryBeforeSend = (event) => {
  // Remove sensitive data if needed
  if (event.request?.cookies) {
    delete event.request.cookies;
  }
  return event;
};

//? `Sentry.init` options builder. Maps the resolved config onto the exact same
//? options object that was previously constructed inline.
const buildSentryInitOptions = (
  config: ResolvedSentryInitConfig,
): Parameters<SentryModule['init']>[0] => ({
  dsn: config.dsn,
  environment: process.env.NODE_ENV ?? 'development',

  // Performance monitoring
  tracesSampleRate: config.tracesSampleRate,

  // Additional options — `getProjectName()` resolves at call time and
  // honors projectConfig overrides, not just the raw env var.
  serverName: getProjectName(),

  // Only send errors in production by default
  enabled: config.isProduction || config.enabledOverride === 'true',

  // Ignore certain errors
  ignoreErrors: config.ignoreErrors,

  // Attach additional context
  beforeSend: builtinBeforeSend,
});

//? Integration-wiring step: bridge the live `@sentry/node` SDK onto the shared
//? DI surface exposed from `@luckystack/core` so framework code can report
//? errors without a direct dep on `@sentry/node`. Body is byte-for-byte the
//? same `initSharedSentry({...})` call that was inline.
const wireSharedSentryDI = (Sentry: SentryModule): void => {
  initSharedSentry({
    captureException: (exception, context) => Sentry.captureException(
      exception,
      context as Parameters<typeof Sentry.captureException>[1],
    ),
    captureMessage: (message, level) => Sentry.captureMessage(
      message,
      level as Parameters<typeof Sentry.captureMessage>[1],
    ),
    setUser: (user) => {
      Sentry.setUser(user as Parameters<typeof Sentry.setUser>[0]);
    },
    setContext: (key, context) => {
      Sentry.setContext(key, context as Parameters<typeof Sentry.setContext>[1]);
    },
    startInactiveSpan: (context) => {
      return Sentry.startInactiveSpan(
        context as Parameters<typeof Sentry.startInactiveSpan>[0],
      );
    },
  });
};

/**
 * Initialize Sentry error monitoring.
 * Should be called as early as possible in server startup.
 * Auto-disables when SENTRY_DSN is not set (no-op).
 */
export const initializeSentry = () => {
  const config = resolveSentryInitConfig();
  if (!config) return;

  //? dsn is set ⇒ the consumer opted into Sentry, so the optional peer must be
  //? present. Resolve it lazily here (module top-level stays import-safe).
  const Sentry = loadSentry();

  Sentry.init(buildSentryInitOptions(config));

  // Wire the shared DI surface exposed from @luckystack/core so framework code
  // can report errors without taking a direct dependency on @sentry/node.
  wireSharedSentryDI(Sentry);

  //? Register the hook subscribers that previously lived as direct imports
  //? in `@luckystack/api` and `@luckystack/sync`. Idempotent — calling
  //? `initializeSentry()` twice (or alongside an explicit
  //? `enableErrorTrackingAutoInstrumentation()`) is safe.
  enableErrorTrackingAutoInstrumentation();

  getLogger().info('Sentry initialized for error monitoring');
};

export const captureException = (
  error: unknown,
  context?: Record<string, unknown>
): void => {
  sharedCaptureException(error, context);
};

export const captureMessage = (
  message: string,
  level: 'info' | 'warning' | 'error' | 'fatal' = 'info',
  context?: Record<string, unknown>
): void => {
  sharedCaptureMessage(message, level, context);
};

export const setSentryUser = (user: {
  id?: string;
  email?: string;
  username?: string;
} | null): void => {
  sharedSetSentryUser(user);
};

export const startSpan = (name: string, op: string): unknown => {
  return sharedStartSpan(name, op);
};

//? Lazy default export: forwards property access to the real `@sentry/node`
//? SDK on first use, so `import Sentry from '@luckystack/error-tracking'` stays
//? import-safe when the optional peer is absent and only resolves it when
//? actually touched. Functions are bound to the module so call-site `this` is
//? correct.
//? Well-known keys/symbols that runtimes probe on ANY object incidentally
//? (`await` reads `.then`; `util.inspect`/string coercion read these symbols).
//? Short-circuit them to `undefined` WITHOUT loading the optional peer, so an
//? incidental probe on an adapter-only consumer (no `@sentry/node`) can't
//? trigger a hard `ERR_MODULE_NOT_FOUND` — the opposite of the import-safe
//? intent. A genuine Sentry method access still resolves the peer lazily.
const NON_SENTRY_KEYS = new Set<PropertyKey>([
  'then',
  Symbol.toStringTag,
  Symbol.iterator,
  Symbol.asyncIterator,
  Symbol.toPrimitive,
]);

const sentryProxy = new Proxy({}, {
  get: (_target, prop) => {
    if (NON_SENTRY_KEYS.has(prop)) return;
    const mod = loadSentry();
    const value: unknown = Reflect.get(mod, prop);
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(mod) : value;
  },
}) as SentryModule;

export default sentryProxy;
