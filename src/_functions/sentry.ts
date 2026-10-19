/**
 * Sentry error monitoring initialization for the client.
 * 
 * This module initializes Sentry for capturing errors, performance data,
 * and session replays on the frontend.
 * 
 * @see https://docs.sentry.io/platforms/javascript/guides/react/
 */

import * as Sentry from '@sentry/react';
import { initSharedSentry } from '../../shared/sentrySetup';
import { sentry } from '../../config';

const env = import.meta.env;

//? URL parameters that carry a live credential: reset / email-change links
//? (`?token=`), the token-mode OAuth handoff (`#token=`) and the OAuth `code`.
const SENSITIVE_URL_PARAMS = ['token', 'code'];
const URL_PARSE_BASE = 'http://placeholder.invalid';

const deleteSensitiveParams = (params: URLSearchParams): boolean => {
  let changed = false;
  for (const key of SENSITIVE_URL_PARAMS) {
    if (params.has(key)) {
      params.delete(key);
      changed = true;
    }
  }
  return changed;
};

/** Remove credential parameters from a URL's query AND fragment; relative URLs stay relative. */
export const scrubSensitiveUrl = (raw: string): string => {
  if (!URL.canParse(raw, URL_PARSE_BASE)) return raw;
  const url = new URL(raw, URL_PARSE_BASE);
  const queryChanged = deleteSensitiveParams(url.searchParams);
  const hashParams = new URLSearchParams(url.hash.slice(1));
  const hashChanged = url.hash.includes('=') && deleteSensitiveParams(hashParams);
  if (!queryChanged && !hashChanged) return raw;
  if (hashChanged) url.hash = hashParams.toString();
  return URL.canParse(raw) ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
};

const URL_SPAN_ATTRIBUTES = ['url.full', 'http.url'];

//? Errors AND transactions carry the page URL (`request.url`, set from
//? location.href) and span URL attributes; scrubbing only errors let pageload
//? transactions ship live reset tokens.
const scrubEventUrls = <T extends Sentry.Event>(event: T): T => {
  if (event.request?.url) event.request.url = scrubSensitiveUrl(event.request.url);
  const spanDataList = [event.contexts?.trace?.data, ...(event.spans ?? []).map((span) => span.data)];
  for (const data of spanDataList) {
    if (!data) continue;
    for (const key of URL_SPAN_ATTRIBUTES) {
      const value: unknown = data[key];
      if (typeof value === 'string') data[key] = scrubSensitiveUrl(value);
    }
  }
  return event;
};

//? Navigation breadcrumbs use `from`/`to`; fetch/xhr breadcrumbs use `url`.
const BREADCRUMB_URL_KEYS = ['url', 'from', 'to'];

/**
 * Initialize Sentry error monitoring for the React application.
 * Should be called as early as possible in the application startup.
 * 
 * @example
 * ```typescript
 * // In main.tsx, before ReactDOM.createRoot
 * import { initializeSentry } from './utils/sentry';
 * initializeSentry();
 * ```
 */
export const initializeSentry = () => {
  const dsn = env.VITE_SENTRY_DSN;
  const isProduction = env.PROD;
  const runtimeEnvironment = isProduction ? 'production' : 'development';
  const enabledInDevelopment = env.VITE_SENTRY_ENABLED === 'true';

  if (!dsn) {
    if (isProduction || enabledInDevelopment) {
      console.warn('VITE_SENTRY_DSN not configured. Error monitoring disabled.');
    }
    return;
  }

  Sentry.init({
    dsn,
    environment: runtimeEnvironment,

    // Performance Monitoring
    tracesSampleRate: isProduction
      ? sentry.client.tracesSampleRate.production
      : sentry.client.tracesSampleRate.development,

    // Session Replay
    replaysSessionSampleRate: isProduction
      ? sentry.client.replaysSessionSampleRate.production
      : sentry.client.replaysSessionSampleRate.development,
    replaysOnErrorSampleRate: isProduction
      ? sentry.client.replaysOnErrorSampleRate.production
      : sentry.client.replaysOnErrorSampleRate.development,

    // Integrations
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        // Mask all text and block media for privacy
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

    // Only send errors in production by default
    enabled: isProduction || enabledInDevelopment,

    // Ignore common non-actionable errors
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
      /^Network Error$/,
      /^Socket connection/,
    ],

    // Filter out sensitive URL parameters from errors, transactions and breadcrumbs
    beforeSend: (event) => scrubEventUrls(event),
    beforeSendTransaction: (event) => scrubEventUrls(event),
    beforeBreadcrumb(breadcrumb) {
      const { data } = breadcrumb;
      if (data) {
        for (const key of BREADCRUMB_URL_KEYS) {
          const value: unknown = data[key];
          if (typeof value === 'string') data[key] = scrubSensitiveUrl(value);
        }
      }
      return breadcrumb;
    },
  });

  // Initialize shared Sentry instance (legacy DI bridge — the deprecation targets external callers)
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- legacy-Sentry DI bridge
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

  console.log('Sentry initialized for error monitoring');
};

// Re-export shared capture functions
export * from '../../shared/sentrySetup';

/**
 * Error Boundary component for React.
 * Wrap your app or components to catch and report errors.
 */
export const SentryErrorBoundary = Sentry.ErrorBoundary;

/**
 * HOC to wrap components with Sentry profiling.
 */
export const withSentryProfiler = Sentry.withProfiler;

export default Sentry;
