interface SentryInstance {
  captureException: (exception: unknown, ...args: unknown[]) => string;
  captureMessage: (message: string, ...args: unknown[]) => string;
  setUser: (user: unknown) => void;
  setContext: (key: string, context: unknown) => void;
  startInactiveSpan?: (context: unknown) => unknown;
}

let sentry: SentryInstance | undefined;

export const initSharedSentry = (instance: SentryInstance) => {
  sentry = instance;
};

//? Pass `extra` inline via Sentry's hint-shaped second argument so contexts
//? don't leak across concurrent captures. Previously we called
//? `sentry.setContext('additional', context)` which is process-global until
//? cleared — under concurrent captures the first context could leak into the
//? second's report.
export const captureException = (
  error: unknown,
  context?: Record<string, unknown>
) => {
  if (context && sentry) {
    sentry.captureException(error, { extra: context });
  } else {
    sentry?.captureException(error);
  }
};

export const captureMessage = (
  message: string,
  level: 'info' | 'warning' | 'error' | 'fatal' = 'info',
  context?: Record<string, unknown>
) => {
  if (context && sentry) {
    sentry.captureMessage(message, { level, extra: context });
  } else {
    sentry?.captureMessage(message, level);
  }
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
