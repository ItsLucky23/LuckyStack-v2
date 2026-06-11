//? Shared `beforeSend` resolution for the built-in adapters. Each adapter
//? accepts an optional `beforeSend(event)` hook that can either:
//?   - DROP the event — return `null`, OR return an event with `forwarded: false`;
//?   - TRANSFORM the event — return an event whose `payload` was mutated or
//?     replaced (the canonical PII-redaction use case, mirroring Sentry's own
//?     `beforeSend`).
//? Both behaviours are honoured here so all three built-in adapters (Sentry /
//? Datadog / PostHog) stay in lockstep. Crucially, the adapters forward the
//? RESOLVED payload returned below, never the original arguments — so a
//? redacting `beforeSend` actually redacts what reaches the backend.

import type { ErrorTrackerContext, ErrorTrackerEvent } from '@luckystack/core';

export type BeforeSendHook = (event: ErrorTrackerEvent) => ErrorTrackerEvent | null;

export interface ResolvedExceptionEvent {
  error: unknown;
  context: ErrorTrackerContext | undefined;
}

export interface ResolvedMessageEvent {
  message: string;
  level: 'info' | 'warning' | 'error' | 'fatal';
  context: ErrorTrackerContext | undefined;
}

const isMessageLevel = (value: unknown): value is ResolvedMessageEvent['level'] =>
  value === 'info' || value === 'warning' || value === 'error' || value === 'fatal';

//? Narrow a payload field back to a context object. A `beforeSend` may replace
//? `context` with anything; only a plain object survives, everything else
//? (null, string, number) collapses to `undefined` so adapters don't spread
//? garbage into their tags/extras.
const asContext = (value: unknown): ErrorTrackerContext | undefined =>
  value !== null && typeof value === 'object' ? (value as ErrorTrackerContext) : undefined;

//? Run the hook (when present) and decide whether the event survives. Returns
//? the possibly-transformed event, or `null` when it must be dropped — either
//? because the hook returned `null` or because it set `forwarded: false`.
const resolveEvent = (
  beforeSend: BeforeSendHook | undefined,
  event: ErrorTrackerEvent,
): ErrorTrackerEvent | null => {
  const result = beforeSend ? beforeSend(event) : event;
  if (!result?.forwarded) return null;
  return result;
};

/**
 * Resolve an exception event through the adapter's `beforeSend`. Returns the
 * `{ error, context }` the adapter should actually forward, or `null` to drop.
 */
export const resolveExceptionEvent = (
  beforeSend: BeforeSendHook | undefined,
  error: unknown,
  context: ErrorTrackerContext | undefined,
): ResolvedExceptionEvent | null => {
  const resolved = resolveEvent(beforeSend, {
    forwarded: true,
    kind: 'exception',
    payload: { error, context: context ?? null },
  });
  if (!resolved) return null;
  return {
    error: 'error' in resolved.payload ? resolved.payload.error : error,
    context: asContext(resolved.payload.context),
  };
};

/**
 * Resolve a message event through the adapter's `beforeSend`. Returns the
 * `{ message, level, context }` the adapter should actually forward, or `null`
 * to drop. A hook that returns a malformed `message`/`level` falls back to the
 * original value rather than forwarding garbage.
 */
export const resolveMessageEvent = (
  beforeSend: BeforeSendHook | undefined,
  message: string,
  level: ResolvedMessageEvent['level'],
  context: ErrorTrackerContext | undefined,
): ResolvedMessageEvent | null => {
  const resolved = resolveEvent(beforeSend, {
    forwarded: true,
    kind: 'message',
    payload: { message, level, context: context ?? null },
  });
  if (!resolved) return null;
  const nextMessage = resolved.payload.message;
  const nextLevel = resolved.payload.level;
  return {
    message: typeof nextMessage === 'string' ? nextMessage : message,
    level: isMessageLevel(nextLevel) ? nextLevel : level,
    context: asContext(resolved.payload.context),
  };
};
