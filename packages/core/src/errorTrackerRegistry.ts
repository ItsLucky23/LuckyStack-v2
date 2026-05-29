//? Backend-agnostic error-tracker registry. Lives in @luckystack/core
//? (not @luckystack/error-tracking) because framework code in core /
//? api / sync needs to call it without taking a hard dep on a specific
//? observability backend. The error-tracking package provides adapter
//? IMPLEMENTATIONS (Sentry, Datadog, PostHog); the slot lives here.
//?
//? Multiple adapters can be registered at once via `registerErrorTrackers([...])` —
//? every event fans out to all of them. Per-adapter errors are swallowed
//? so one buggy tracker can't break the chain.

export type ErrorTrackerContext = Record<string, unknown>;

export interface ErrorTrackerUser {
  id?: string;
  email?: string;
  username?: string;
  [key: string]: unknown;
}

export interface ErrorTrackerEvent {
  /** When false, the adapter must not forward this event (beforeSend opt-out). */
  forwarded: boolean;
  kind: 'exception' | 'message';
  payload: Record<string, unknown>;
}

//? `SpanResult<T>` was a conditional unwrap of Promise. It's now an alias
//? for `T` directly because the conditional collapsed to T in both branches
//? and tsup's dts emit choked on the conditional widening. Kept as an
//? exported alias so adapter authors can still annotate with `SpanResult<T>`
//? for documentation intent.
export type SpanResult<T> = T;

export interface ErrorTracker {
  /** Human-readable identifier (logs, diagnostics). */
  name: string;
  captureException: (error: unknown, context?: ErrorTrackerContext) => void;
  captureMessage: (
    message: string,
    level: 'info' | 'warning' | 'error' | 'fatal',
    context?: ErrorTrackerContext,
  ) => void;
  setUser: (user: ErrorTrackerUser | null) => void;
  setContext?: (key: string, context: ErrorTrackerContext | null) => void;
  startSpan?: <T>(name: string, op: string, fn: () => T) => T;
  recordMetric?: (name: string, value: number, tags?: Record<string, string>) => void;
  beforeSend?: (event: ErrorTrackerEvent) => ErrorTrackerEvent | null;
}

let activeTrackers: ErrorTracker[] = [];

export const registerErrorTracker = (tracker: ErrorTracker): void => {
  activeTrackers = [tracker];
};

export const registerErrorTrackers = (trackers: ErrorTracker[]): void => {
  activeTrackers = [...trackers];
};

export const getActiveErrorTrackers = (): ErrorTracker[] => activeTrackers;

export const captureExceptionAcrossTrackers = (
  error: unknown,
  context?: ErrorTrackerContext,
): void => {
  for (const tracker of activeTrackers) {
    try {
      tracker.captureException(error, context);
    } catch {
      // Swallow — one buggy tracker must not break the chain.
    }
  }
};

export const captureMessageAcrossTrackers = (
  message: string,
  level: 'info' | 'warning' | 'error' | 'fatal',
  context?: ErrorTrackerContext,
): void => {
  for (const tracker of activeTrackers) {
    try {
      tracker.captureMessage(message, level, context);
    } catch {
      // Swallow.
    }
  }
};

export const setErrorTrackerUser = (user: ErrorTrackerUser | null): void => {
  for (const tracker of activeTrackers) {
    try {
      tracker.setUser(user);
    } catch {
      // Swallow.
    }
  }
};

export const recordMetricAcrossTrackers = (
  name: string,
  value: number,
  tags?: Record<string, string>,
): void => {
  for (const tracker of activeTrackers) {
    if (tracker.recordMetric) {
      try {
        tracker.recordMetric(name, value, tags);
      } catch {
        // Swallow.
      }
    }
  }
};

export const startSpanAcrossTrackers = <T>(name: string, op: string, fn: () => T): T => {
  //? Spans don't fan out cleanly to multiple backends — they're nested
  //? execution scopes. We only invoke the FIRST registered tracker's
  //? startSpan (others get notified via captureException paths if they
  //? want to instrument). When no tracker supports spans, run the fn directly.
  const first = activeTrackers.find((t) => t.startSpan);
  if (!first?.startSpan) return fn();
  return first.startSpan(name, op, fn);
};
