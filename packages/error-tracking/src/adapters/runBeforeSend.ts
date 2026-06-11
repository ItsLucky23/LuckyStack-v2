//? Shared `beforeSend` runner for the built-in adapters. Each adapter accepts
//? an optional `beforeSend(event)` hook that can drop an event (return `null`)
//? or pass it through. The three built-in adapters (Sentry / Datadog / PostHog)
//? all applied the identical "no hook → pass through, else delegate" logic;
//? this is the single implementation so the contract stays in lockstep.

import type { ErrorTrackerEvent } from '@luckystack/core';

export type BeforeSendHook = (event: ErrorTrackerEvent) => ErrorTrackerEvent | null;

/**
 * Apply an optional `beforeSend` hook to an event. Returns the (possibly
 * transformed) event, `null` to drop it, or the event untouched when no hook
 * is configured.
 */
export const runBeforeSend = (
  beforeSend: BeforeSendHook | undefined,
  event: ErrorTrackerEvent,
): ErrorTrackerEvent | null => {
  if (!beforeSend) return event;
  return beforeSend(event);
};
