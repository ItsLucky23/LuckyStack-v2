/**
 * Shared Sentry wrapper for isomorphic usage (Node & Browser)
 */

interface SentryInstance {
  captureException: (exception: any, context?: any) => string;
  captureMessage: (message: string, level?: any) => string;
  setUser: (user: any) => void;
  setContext: (key: string, context: any) => void;
  startInactiveSpan?: (context: any) => any;
}

let sentry: SentryInstance | undefined;

export const initSharedSentry = (instance: any) => {
  sentry = instance;
};

export const captureException = (
  error: unknown,
  context?: Record<string, unknown>
) => {
  if (context && sentry) {
    sentry.setContext('additional', context);
  }
  sentry?.captureException(error);
};

export const captureMessage = (
  message: string,
  level: 'info' | 'warning' | 'error' | 'fatal' = 'info',
  context?: Record<string, unknown>
) => {
  if (context && sentry) {
    sentry.setContext('additional', context);
  }
  sentry?.captureMessage(message, level);
};

export const setSentryUser = (user: {
  id?: string;
  email?: string;
  username?: string;
} | null) => {
  sentry?.setUser(user);
};

export const startSpan = (name: string, op: string) => {
  return sentry?.startInactiveSpan?.({ name, op });
};
