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
