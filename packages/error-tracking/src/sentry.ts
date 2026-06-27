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
  appendErrorTracker,
  getLogger,
  getProjectName,
  isRedactedLogKey,
  initSharedSentry,
  loadPeer,
  REDACTED_PLACEHOLDER,
  sanitizeErrorString,
  sanitizeForLog,
  captureException as sharedCaptureException,
  captureMessage as sharedCaptureMessage,
  setSentryUser as sharedSetSentryUser,
  startSpan as sharedStartSpan,
} from '@luckystack/core';

import { createSentryAdapter } from './adapters/sentry';

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

//? One-time guard for the dev "installed but inactive" info line emitted when no
//? DSN is set (see `resolveSentryInitConfig`). `initializeSentry()` is idempotent
//? boot wiring that may run more than once, so without this the notice would log
//? on every call.
let noDsnNoticeShown = false;

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
//? no-DSN notice side-effect (production warning + a one-time dev info line) is
//? emitted here so call-time behavior is centralised.
const resolveSentryInitConfig = (): ResolvedSentryInitConfig | null => {
  const dsn = process.env.SENTRY_DSN ?? process.env.VITE_SENTRY_DSN;
  const isProduction = process.env.NODE_ENV === 'production';
  const enabledOverride = process.env.SENTRY_ENABLED ?? process.env.VITE_SENTRY_ENABLED;

  if (!dsn) {
    if (isProduction) {
      getLogger().warn('SENTRY_DSN not configured. Error monitoring disabled.');
    } else if (!noDsnNoticeShown) {
      //? Dev-friendly nudge so a developer who installed the package but hasn't
      //? set a DSN isn't met with silence. One-time so it doesn't spam repeated
      //? `initializeSentry()` calls (idempotent boot wiring).
      noDsnNoticeShown = true;
      getLogger().info('@luckystack/error-tracking installed but inactive — set SENTRY_DSN to capture.');
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

//? ET-O5: redact sensitive headers, cookies, request.data, query_string,
//? and extra in Sentry events using the same denylist as `sanitizeForLog`.
//? Previously only `request.cookies` was removed. `sanitizeForLog` deep-scrubs
//? objects by key; raw header maps and extra dicts are passed through it so all
//? registered redacted keys are masked.
//? NOTE: this hook does NOT scrub `event.breadcrumbs`. Framework-emitted
//? breadcrumbs (API/sync context logging) are redacted at SOURCE via
//? `isRedactedLogKey` / `sanitizeForLog` before they ever become a breadcrumb
//? (see docs/auto-instrumentation.md). Sentry's own auto-instrumented HTTP /
//? fetch / console breadcrumbs are out of scope here — register sensitive keys
//? with `registerRedactedLogKeys(...)` and/or a project `beforeBreadcrumb` if
//? those auto-captured payloads need masking.
type SentryBeforeSend = NonNullable<Parameters<SentryModule['init']>[0]>['beforeSend'];

const redactSentryHeaders = (
  headers: Record<string, string | string[] | undefined> | undefined,
): Record<string, string | string[] | undefined> | undefined => {
  if (!headers) return headers;
  const out: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    //? ET-O5: use core's suffix-aware `isRedactedLogKey` (the same policy
    //? `sanitizeForLog` applies to request.data / query_string) rather than an
    //? exact-match denylist — so a compound sensitive header (`x-api-token`,
    //? `x-session-secret`) is masked, not just the exact registered names.
    out[key] = isRedactedLogKey(key) ? REDACTED_PLACEHOLDER : value;
  }
  return out;
};

const builtinBeforeSend: SentryBeforeSend = (event) => {
  if (event.request) {
    //? Wipe the entire cookies object (session tokens live here).
    if (event.request.cookies) {
      delete event.request.cookies;
    }
    //? Scrub sensitive authorization / cookie header values.
    if (event.request.headers) {
      event.request.headers = redactSentryHeaders(
        event.request.headers,
      ) as typeof event.request.headers;
    }
    //? request.data may carry POST body or JSON-encoded form fields.
    if (event.request.data !== undefined && event.request.data !== null && typeof event.request.data === 'object') {
      event.request.data = sanitizeForLog(event.request.data);
    }
    //? query_string may be a string ("token=abc") or a parsed object.
    //? ET-O5: scrub both forms. String form is redacted wholesale to avoid
    //? the complexity of re-serialising after partial key-by-key scrubbing
    //? (URLSearchParams-based scrub would leave the "?" separator and key
    //? order inconsistent with what Sentry captured). The object form goes
    //? through sanitizeForLog so individual key redaction is preserved.
    if (event.request.query_string !== undefined) {
      if (typeof event.request.query_string === 'string') {
        event.request.query_string = '[redacted:query_string]';
      } else if (typeof event.request.query_string === 'object') {
        event.request.query_string = sanitizeForLog(event.request.query_string) as typeof event.request.query_string;
      }
    }
  }
  //? extra dict is the framework's per-capture context map (CORE-O4 fix extended).
  if (event.extra) {
    event.extra = sanitizeForLog(event.extra) as typeof event.extra;
  }
  //? ET-O5: scrub the free-text `event.message` (set by manual `captureMessage`
  //? and some integrations) and each exception `values[].value` through the same
  //? `key=value` / `key: value` scrubber the adapters use, so an interpolated
  //? secret in a message/exception string can't bypass redaction on this legacy
  //? SDK path. Null-safe: only touches string fields that exist.
  if (typeof event.message === 'string') {
    event.message = sanitizeErrorString(event.message);
  }
  if (event.exception?.values) {
    for (const exceptionValue of event.exception.values) {
      if (typeof exceptionValue.value === 'string') {
        exceptionValue.value = sanitizeErrorString(exceptionValue.value);
      }
    }
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

  // DSN is set ⇒ capture is ON in every environment (dev + prod) so installing
  // the package + setting SENTRY_DSN "just works". Explicit opt-out only:
  // SENTRY_ENABLED=false disables capture without unsetting the DSN.
  enabled: config.enabledOverride !== 'false',

  // Ignore certain errors
  ignoreErrors: config.ignoreErrors,

  // Attach additional context
  beforeSend: builtinBeforeSend,
});

//? Integration-wiring step: bridge the live `@sentry/node` SDK onto the shared
//? DI surface exposed from `@luckystack/core` so framework code can report
//? errors without a direct dep on `@sentry/node`.
//? ET-O3: captureException / captureMessage are now no-ops in the legacy DI
//? slot because `createSentryAdapter()` (registered below in `initializeSentry`)
//? handles them via `captureExceptionAcrossTrackers` with per-event ALS identity
//? (`withIdentity`). Keeping direct calls here would double-fire every Sentry
//? event. setUser / setContext / startInactiveSpan are kept for legacy callers
//? that bypass the adapter path.
//? ET-N5 (mixed-mode double-capture): calling both `initializeSentry()` AND
//? `appendErrorTracker(createSentryAdapter())` is safe — `appendErrorTracker`
//? de-dupes by name and replaces the existing 'sentry' entry. Calling
//? `registerErrorTracker(createSentryAdapter())` after `initializeSentry()`
//? replaces ALL adapters (not append), so the original adapter is removed.
//? Do NOT add a second `Sentry.init()` call — only one SDK init is supported.
const wireSharedSentryDI = (Sentry: SentryModule): void => {
  //? ET-O12: the `SentryInstance` contract in `@luckystack/core/sentrySetup` uses
  //? `unknown` params so core stays dep-free of `@sentry/node`. The casts below
  //? are therefore required at the boundary: the values are always valid Sentry
  //? types (they're passed straight through from framework call sites) but TS
  //? cannot infer that through the `unknown` slot. Document rather than eliminate.
  //? `initSharedSentry` is deprecated for EXTERNAL callers (use registerErrorTracker);
  //? this is the one legitimate internal legacy-Sentry DI bridge, so the warning is suppressed.
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- internal legacy-Sentry DI bridge
  initSharedSentry({
    captureException: () => '',
    captureMessage: () => '',
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

  //? ET-O3: register the adapter so per-event identity comes from ALS
  //? (`withIdentity` in `createSentryAdapter`) rather than the process-global
  //? `Sentry.setUser()` scope that `wireSharedSentryDI` sets. The adapter uses
  //? `getCurrentErrorTrackerIdentity()` per-capture so concurrent requests can't
  //? bleed their user identity across events. `appendErrorTracker` de-dupes by
  //? name (`'sentry'`) so repeated `initializeSentry()` calls stay idempotent.
  appendErrorTracker(createSentryAdapter());

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
