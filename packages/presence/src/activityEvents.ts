//? Activity-event registry. Replaces the previously-hardcoded AFK
//? detection with a pluggable system: each event has a `trigger` predicate
//? evaluated against an activity sample, and an `onTrigger` callback that
//? broadcasts presence changes.
//?
//? The default `'afk'` event ships out of the box and reads its idle
//? threshold from `projectConfig.presence.afkTimeoutMs`. Consumers can
//? register additional events for location changes, menu interactions,
//? typing detection, etc., or replace `'afk'` entirely.
//?
//? Registry is keyed by event name. Re-registering the same name replaces
//? the previous entry (last-write-wins).

import { getLogger, tryCatch } from '@luckystack/core';

export interface ActivitySample {
  /** Socket id reporting the activity. */
  socketId: string;
  /** Session token (when the socket is authenticated). */
  token: string | null;
  /** Last user-interaction timestamp the broadcaster received. */
  lastActivity: number;
  /** Current wall-clock time. */
  now: number;
  /** Free-form data attached by the broadcaster (location path, etc.). */
  data?: Record<string, unknown>;
}

export interface ActivityEvent {
  /** Identifier; passed to onTrigger for fan-out routing. */
  name: string;
  /** Predicate evaluated per sample. Return true to fire `onTrigger`. */
  trigger: (sample: ActivitySample) => boolean;
  /** Side effect — broadcast presence change, write metric, etc. */
  onTrigger: (sample: ActivitySample) => void | Promise<void>;
  /**
   * Optional minimum interval (ms) between firings for the same socketId.
   * Prevents `trigger` from re-firing every tick once the predicate stays
   * true. Defaults to 0 (no throttle — caller's predicate must handle).
   */
  refractoryMs?: number;
}

const registry = new Map<string, ActivityEvent>();
const lastFired = new Map<string, number>();
const lastFiredKey = (eventName: string, socketId: string): string => `${eventName}|${socketId}`;

/**
 * Register or replace an activity event. Returns the previously registered
 * event (or undefined) so callers can chain — e.g. wrap the default AFK
 * detector to add custom logging without losing the framework behavior.
 */
export const registerActivityEvent = (name: string, event: Omit<ActivityEvent, 'name'>): ActivityEvent | undefined => {
  const previous = registry.get(name);
  registry.set(name, { name, ...event });
  return previous;
};

/** Unregister an event by name. No-op if not registered. */
export const unregisterActivityEvent = (name: string): void => {
  registry.delete(name);
};

/**
 * Drop every refractory-throttle timestamp for a socket id. Called on
 * disconnect (via `clearActivity`) so the `lastFired` map doesn't accumulate
 * one entry per refractory-throttled event per socket forever — socket ids are
 * per-connection, so without this every connection that ever fired a throttled
 * event (e.g. the built-in `'afk'`) leaks an entry on a long-running deploy.
 */
export const clearActivityThrottle = (socketId: string): void => {
  const suffix = `|${socketId}`;
  for (const key of lastFired.keys()) {
    if (key.endsWith(suffix)) lastFired.delete(key);
  }
};

/** List every registered event in registration order. */
export const listActivityEvents = (): ActivityEvent[] => [...registry.values()];

/**
 * Evaluate every registered event against the sample. Each event's
 * `trigger` predicate runs; matching events fire their `onTrigger`.
 * Refractory throttling is enforced here so individual events don't have
 * to track their own state.
 */
export const dispatchActivitySample = async (sample: ActivitySample): Promise<void> => {
  for (const event of registry.values()) {
    if (!event.trigger(sample)) continue;
    if (event.refractoryMs && event.refractoryMs > 0) {
      const key = lastFiredKey(event.name, sample.socketId);
      const last = lastFired.get(key) ?? 0;
      if (sample.now - last < event.refractoryMs) continue;
      lastFired.set(key, sample.now);
    }
    //? Isolate each event so one buggy `onTrigger` (incl. the built-in AFK
    //? fan-out) can't break the chain — but LOG/capture instead of swallowing
    //? silently, otherwise a silently-broken AFK looks identical to "no one is
    //? AFK" (it fails every tick with no trace). Routes through the framework
    //? `tryCatch` (auto-captures to the error tracker) + an explicit log line.
    const [error] = await tryCatch(() => event.onTrigger(sample), undefined, {
      scope: 'presence.dispatchActivitySample',
      event: event.name,
    });
    if (error) {
      getLogger().error('presence: activity event onTrigger failed', { name: event.name, socketId: sample.socketId, error });
    }
  }
};
