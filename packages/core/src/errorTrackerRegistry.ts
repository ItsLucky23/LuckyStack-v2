//? Backend-agnostic error-tracker registry. Lives in @luckystack/core
//? (not @luckystack/error-tracking) because framework code in core /
//? api / sync needs to call it without taking a hard dep on a specific
//? observability backend. The error-tracking package provides adapter
//? IMPLEMENTATIONS (Sentry, Datadog, PostHog); the slot lives here.
//?
//? Multiple adapters can be registered at once via `registerErrorTrackers([...])` —
//? every event fans out to all of them. Per-adapter errors are swallowed
//? so one buggy tracker can't break the chain.

import * as nodeAsyncHooks from 'node:async_hooks';
import { getRedactedLogKeys, REDACTED_PLACEHOLDER, sanitizeForLog } from './redactedLogKeys';
import { getLogger } from './loggerRegistry';

export type ErrorTrackerContext = Record<string, unknown>;

//? SYNC-17 defense-in-depth: scrub registered redacted keys (tokens, passwords,
//? auth/cookie headers) from the context object before it fans out to any
//? adapter, so a raw token nested in a capture context never reaches Sentry /
//? Datadog / PostHog breadcrumbs. Returns the original reference when there is
//? nothing to sanitize (no context) to avoid needless allocation on the hot path.
const sanitizeContext = (context?: ErrorTrackerContext): ErrorTrackerContext | undefined => {
  if (!context) return context;
  return sanitizeForLog(context) as ErrorTrackerContext;
};

//? ET-O2 value-level scrub: error.message and error.stack can contain
//? interpolated secrets ("token=abc123") that bypass the key-based context
//? scrub. Replace `key=value` and `key: value` patterns for every registered
//? redacted key so the string never reaches an adapter verbatim.
//? Runs at capture time (not on every Error construction) to stay off the
//? hot path; the result is cached on the sanitized context so each adapter
//? fan-out step reads the same pre-scrubbed string.
const REDACTED_VALUE_RE_CACHE = new Map<string, RegExp>();
const buildScrubPattern = (key: string): RegExp => {
  const cached = REDACTED_VALUE_RE_CACHE.get(key);
  if (cached) return cached;
  // Match <key>=<value> (URL-param style) and <key>: <value> (log-label style).
  // Capture up to the next whitespace / comma / quote / end-of-string.
  const escaped = key.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const re = new RegExp(String.raw`(?:${escaped}=[^\s,;"'&]*)|(${escaped}:\s*[^\s,;"']*)`, 'gi');
  REDACTED_VALUE_RE_CACHE.set(key, re);
  return re;
};

export const sanitizeErrorString = (value: string): string => {
  let result = value;
  // Scrub matching `key=value` / `key: value` patterns for every registered
  // redacted key so interpolated secrets (e.g. "token=abc") never reach an adapter.
  for (const key of getRedactedLogKeys()) {
    result = result.replace(buildScrubPattern(key), REDACTED_PLACEHOLDER);
  }
  return result;
};

//? Produce a sanitized version of an Error's message and stack so adapters
//? can emit pre-scrubbed strings without touching the original Error object.
export const sanitizeErrorStrings = (
  error: unknown,
): { message: string; stack: string | undefined } | null => {
  if (!(error instanceof Error)) return null;
  return {
    message: sanitizeErrorString(error.message),
    stack: error.stack === undefined ? undefined : sanitizeErrorString(error.stack),
  };
};

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
  /**
   * Optional flush lifecycle hook (error-tracking ET batch). Called by
   * {@link flushErrorTrackers} on graceful shutdown so a buffered adapter
   * (PostHog batch, Sentry transport) can drain in-flight events before exit.
   * Returns a promise that resolves when the adapter has flushed.
   */
  flush?: () => Promise<void>;
}

//? ET-02 fix seam: per-event identity carried in AsyncLocalStorage instead of a
//? process-global mutable `currentDistinctId`. The framework's API + sync request
//? handlers open an identity SCOPE at request entry (`runWithErrorTrackerIdentityScope`)
//? — BEFORE the first await that could interleave with another concurrent request —
//? then write the resolved session into it via `setCurrentErrorTrackerIdentity(user)`
//? once `readSession` resolves. Adapters read `getCurrentErrorTrackerIdentity()` at
//? capture time, so two concurrent requests with different users can't cross-attribute
//? events. Lives in core so the registry (and any adapter) can read it without a
//? back-dependency on error-tracking.
//?
//? The store holds a MUTABLE box (not the user directly) so the identity can be set
//? AFTER the scope is entered: AsyncLocalStorage propagates the same box reference to
//? every async child of the scope, and each request gets its own box — so mutating
//? `box.user` post-`await` is visible to that request's captures only, never another's.
interface IdentityBox {
  user: ErrorTrackerUser | null;
}

//? BROWSER-SAFE LAZY ALS: this registry is reachable from the client bundle, but
//? `node:async_hooks` only exists on the server — vite externalizes it and THROWS
//? on any property access in the browser. So we never construct/touch
//? AsyncLocalStorage at module-eval; we resolve it lazily behind a server guard
//? (`typeof window === 'undefined'`). In the browser the store is null and every
//? identity helper degrades to a no-op / null (the client never needs per-request
//? identity). On the server, behaviour is identical to a top-level store (ET-02).
type IdentityStore = nodeAsyncHooks.AsyncLocalStorage<IdentityBox>;
let resolvedIdentityStore: IdentityStore | null | undefined;
const getIdentityStore = (): IdentityStore | null => {
  if (resolvedIdentityStore !== undefined) return resolvedIdentityStore;
  //? Server detection via property presence — `'window' in globalThis` is false
  //? in Node and avoids the DOM-lib typing that makes `globalThis.window === undefined`
  //? a "no-overlap" lint error (and avoids a ReferenceError on a bare `window`).
  resolvedIdentityStore =
    'window' in globalThis ? null : new nodeAsyncHooks.AsyncLocalStorage<IdentityBox>();
  return resolvedIdentityStore;
};

/**
 * Open a per-request error-tracker identity scope and run `fn` inside it. Call at
 * request ENTRY (before any await that could interleave with another request); the
 * identity starts null and is filled in later via {@link setCurrentErrorTrackerIdentity}
 * once the session is known. Each invocation gets an isolated box (ET-02).
 */
export const runWithErrorTrackerIdentityScope = <T>(fn: () => T): T => {
  const store = getIdentityStore();
  return store ? store.run({ user: null }, fn) : fn();
};

/**
 * Run `fn` with `user` bound as the ambient error-tracker identity (ET-02). Convenience
 * wrapper that opens a scope and immediately sets the identity — used where the user is
 * already known up front (and by the adapter regression tests).
 */
export const runWithErrorTrackerIdentity = <T>(user: ErrorTrackerUser | null, fn: () => T): T => {
  const store = getIdentityStore();
  return store ? store.run({ user }, fn) : fn();
};

/**
 * Write `user` into the active identity box opened by {@link runWithErrorTrackerIdentityScope}
 * / {@link runWithErrorTrackerIdentity}. No-op when called outside any scope (a background /
 * non-request capture has no per-request box; adapters fall back to their own global).
 */
export const setCurrentErrorTrackerIdentity = (user: ErrorTrackerUser | null): void => {
  const box = getIdentityStore()?.getStore();
  if (box) box.user = user;
};

/** Read the ambient per-event identity for the active request scope, if any. */
export const getCurrentErrorTrackerIdentity = (): ErrorTrackerUser | null =>
  getIdentityStore()?.getStore()?.user ?? null;

//? Pre-capture filter (error-tracking ET batch). A registered filter runs on
//? EVERY event just before fan-out; returning `false` DROPS the event entirely
//? (e.g. suppress known-noisy errors, sample, or honour a per-event opt-out).
//? Distinct from a per-adapter `beforeSend` (which transforms a single adapter's
//? payload) — this gates the whole fan-out. Last-write-wins; `null` clears it.
export type PreCaptureFilter = (event: ErrorTrackerEvent) => boolean;
let preCaptureFilter: PreCaptureFilter | null = null;

export const registerPreCaptureFilter = (filter: PreCaptureFilter | null): void => {
  preCaptureFilter = filter;
};

const passesPreCaptureFilter = (kind: 'exception' | 'message', payload: Record<string, unknown>): boolean => {
  if (!preCaptureFilter) return true;
  try {
    return preCaptureFilter({ forwarded: true, kind, payload });
  } catch {
    //? A throwing filter must not swallow telemetry — fail OPEN (forward).
    return true;
  }
};

//? ET-O6: the pre-capture filter payload now includes the error / message
//? so filters can drop noisy errors by type/message (the documented use case).
//? Separate helpers per kind so the call site stays type-safe.
const exceptionFilterPayload = (
  error: unknown,
  context: ErrorTrackerContext | undefined,
): Record<string, unknown> => ({ error, context: context ?? null });

const messageFilterPayload = (
  message: string,
  level: string,
  context: ErrorTrackerContext | undefined,
): Record<string, unknown> => ({ message, level, context: context ?? null });

let activeTrackers: ErrorTracker[] = [];

//? REPLACE semantics — last-write-wins (ET-24 confirmed standard). Use
//? `appendErrorTracker` when you need accumulate-not-replace (ET-05).
export const registerErrorTracker = (tracker: ErrorTracker): void => {
  activeTrackers = [tracker];
};

export const registerErrorTrackers = (trackers: ErrorTracker[]): void => {
  activeTrackers = [...trackers];
};

/**
 * APPEND primitive (ET-05): add a tracker WITHOUT clobbering already-registered
 * ones. Fixes the async-PostHog-vs-consumer-overlay race where the loser of
 * `registerErrorTracker`'s replace silently vanished. De-duplicates by `name`
 * (re-appending the same adapter name replaces that one entry in place) so a
 * lazy adapter that registers a proxy then the real client doesn't double-fire.
 */
export const appendErrorTracker = (tracker: ErrorTracker): void => {
  const withoutSameName = activeTrackers.filter((t) => t.name !== tracker.name);
  activeTrackers = [...withoutSameName, tracker];
};

export const getActiveErrorTrackers = (): ErrorTracker[] => activeTrackers;

/**
 * Flush lifecycle (error-tracking ET batch): drain every adapter that exposes a
 * `flush()` before shutdown. Per-adapter failures are swallowed + logged so one
 * stuck adapter can't block graceful shutdown. Safe to call when no adapter has
 * `flush`.
 */
export const flushErrorTrackers = async (): Promise<void> => {
  await Promise.all(
    activeTrackers.map(async (tracker) => {
      if (!tracker.flush) return;
      try {
        await tracker.flush();
      } catch (error) {
        //? ET-O7: route to the shared failure logger (but never re-throw — a
        //? failing flush must not block graceful shutdown).
        logTrackerFailure(tracker.name, 'flush', error);
      }
    }),
  );
};

export const captureExceptionAcrossTrackers = (
  error: unknown,
  context?: ErrorTrackerContext,
): void => {
  const safeContext = sanitizeContext(context);
  if (!passesPreCaptureFilter('exception', exceptionFilterPayload(error, safeContext))) return;
  for (const tracker of activeTrackers) {
    try {
      tracker.captureException(error, safeContext);
    } catch (trackerError) {
      //? Fan-out error logging (error-tracking ET batch): a buggy tracker must
      //? not break the chain, but its failure was previously invisible. Log it
      //? (best-effort) so a misbehaving adapter is diagnosable.
      logTrackerFailure(tracker.name, 'captureException', trackerError);
    }
  }
};

export const captureMessageAcrossTrackers = (
  message: string,
  level: 'info' | 'warning' | 'error' | 'fatal',
  context?: ErrorTrackerContext,
): void => {
  const safeContext = sanitizeContext(context);
  if (!passesPreCaptureFilter('message', messageFilterPayload(message, level, safeContext))) return;
  for (const tracker of activeTrackers) {
    try {
      tracker.captureMessage(message, level, safeContext);
    } catch (trackerError) {
      logTrackerFailure(tracker.name, 'captureMessage', trackerError);
    }
  }
};

//? Best-effort fan-out failure logger. Wrapped in its own try/catch because the
//? logger itself could throw on a broken sink, and a capture path must never
//? throw.
const logTrackerFailure = (trackerName: string, op: string, error: unknown): void => {
  try {
    getLogger().warn(`errorTracker: "${trackerName}" threw in ${op}`, { error });
  } catch {
    // Last-resort swallow.
  }
};

export const setErrorTrackerUser = (user: ErrorTrackerUser | null): void => {
  for (const tracker of activeTrackers) {
    try {
      tracker.setUser(user);
    } catch (error) {
      //? ET-O7: route to the shared failure logger so a misbehaving tracker is diagnosable.
      logTrackerFailure(tracker.name, 'setUser', error);
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
      } catch (error) {
        //? ET-O7: route to the shared failure logger so a misbehaving tracker is diagnosable.
        logTrackerFailure(tracker.name, 'recordMetric', error);
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

/**
 * Handle-style span (error-tracking ET batch): for callers that can't wrap the
 * measured work in a single synchronous `fn` (streaming, cross-await spans).
 * Returns a handle whose `finish()` resolves the span's duration. The default
 * implementation is a lightweight wall-clock timer (works with any backend);
 * an adapter can supply a richer span via the existing `startSpan` callback
 * form when it needs native instrumentation. `finish()` is idempotent.
 */
export interface SpanHandle {
  /** Stop the span; safe to call more than once (subsequent calls are no-ops). */
  finish: () => void;
  /** Milliseconds elapsed at the moment `finish()` first ran (0 before). */
  readonly durationMs: number;
}

//? `_name`/`_op` are retained in the public signature for call-site documentation
//? (and forward-compat) even though ET-O9 removed the per-call metric that read them.
export const startSpanHandle = (_name: string, _op: string): SpanHandle => {
  const startedAt = Date.now();
  let finishedAt: number | null = null;
  //? ET-O9: removed the per-call `recordMetricAcrossTrackers` that fired on every
  //? startSpanHandle invocation. With zero prod callers this was pure overhead and
  //? produced noisy `span.start.*` metrics nobody reads. The finish wall-clock time
  //? is available via `durationMs` for callers that emit their own metric.
  return {
    finish: () => {
      finishedAt ??= Date.now();
    },
    get durationMs() {
      return finishedAt === null ? 0 : finishedAt - startedAt;
    },
  };
};
