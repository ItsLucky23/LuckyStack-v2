import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  registerActivityEvent,
  unregisterActivityEvent,
  listActivityEvents,
  dispatchActivitySample,
  type ActivitySample,
} from './activityEvents';

//? The registry is module-level mutable state shared across tests. Each test
//? clears every registered event in beforeEach so registration order and
//? counts are deterministic. We use unique event names per test anyway to
//? avoid last-write-wins collisions.

const clearRegistry = (): void => {
  for (const event of listActivityEvents()) {
    unregisterActivityEvent(event.name);
  }
};

const sampleFor = (overrides: Partial<ActivitySample> = {}): ActivitySample => ({
  socketId: 'socket-1',
  token: 'token-1',
  lastActivity: 0,
  now: 0,
  ...overrides,
});

describe('activityEvents registry', () => {
  beforeEach(() => {
    clearRegistry();
  });

  describe('registerActivityEvent / listActivityEvents', () => {
    it('registers an event and lists it with the name folded in', () => {
      const onTrigger = vi.fn();
      registerActivityEvent('a', { trigger: () => true, onTrigger });
      const events = listActivityEvents();
      expect(events).toHaveLength(1);
      expect(events[0]!.name).toBe('a');
      expect(events[0]!.onTrigger).toBe(onTrigger);
    });

    it('lists events in registration order', () => {
      registerActivityEvent('first', { trigger: () => true, onTrigger: vi.fn() });
      registerActivityEvent('second', { trigger: () => true, onTrigger: vi.fn() });
      registerActivityEvent('third', { trigger: () => true, onTrigger: vi.fn() });
      expect(listActivityEvents().map((e) => e.name)).toEqual(['first', 'second', 'third']);
    });

    it('returns undefined when registering a brand-new name', () => {
      const previous = registerActivityEvent('fresh', { trigger: () => true, onTrigger: vi.fn() });
      expect(previous).toBeUndefined();
    });

    it('replaces an existing event (last-write-wins) and returns the previous entry', () => {
      const firstTrigger = vi.fn(() => true);
      const secondTrigger = vi.fn(() => true);
      registerActivityEvent('dup', { trigger: firstTrigger, onTrigger: vi.fn() });
      const previous = registerActivityEvent('dup', { trigger: secondTrigger, onTrigger: vi.fn() });

      expect(previous).toBeDefined();
      expect(previous?.trigger).toBe(firstTrigger);
      expect(listActivityEvents()).toHaveLength(1);
      expect(listActivityEvents()[0]!.trigger).toBe(secondTrigger);
    });
  });

  describe('unregisterActivityEvent', () => {
    it('removes a registered event', () => {
      registerActivityEvent('gone', { trigger: () => true, onTrigger: vi.fn() });
      unregisterActivityEvent('gone');
      expect(listActivityEvents()).toHaveLength(0);
    });

    it('is a no-op for an unknown name', () => {
      registerActivityEvent('keep', { trigger: () => true, onTrigger: vi.fn() });
      expect(() => unregisterActivityEvent('never-registered')).not.toThrow();
      expect(listActivityEvents()).toHaveLength(1);
    });
  });

  describe('dispatchActivitySample', () => {
    it('fires onTrigger when the predicate returns true', async () => {
      const onTrigger = vi.fn();
      registerActivityEvent('fires', { trigger: () => true, onTrigger });
      const sample = sampleFor();
      await dispatchActivitySample(sample);
      expect(onTrigger).toHaveBeenCalledOnce();
      expect(onTrigger).toHaveBeenCalledWith(sample);
    });

    it('does not fire onTrigger when the predicate returns false', async () => {
      const onTrigger = vi.fn();
      registerActivityEvent('quiet', { trigger: () => false, onTrigger });
      await dispatchActivitySample(sampleFor());
      expect(onTrigger).not.toHaveBeenCalled();
    });

    it('evaluates the predicate with the supplied sample', async () => {
      const trigger = vi.fn(() => false);
      registerActivityEvent('inspect', { trigger, onTrigger: vi.fn() });
      const sample = sampleFor({ socketId: 'abc', now: 42 });
      await dispatchActivitySample(sample);
      expect(trigger).toHaveBeenCalledWith(sample);
    });

    it('fires every matching event in the registry', async () => {
      const a = vi.fn();
      const b = vi.fn();
      registerActivityEvent('a', { trigger: () => true, onTrigger: a });
      registerActivityEvent('b', { trigger: () => true, onTrigger: b });
      await dispatchActivitySample(sampleFor());
      expect(a).toHaveBeenCalledOnce();
      expect(b).toHaveBeenCalledOnce();
    });

    it('continues to later events when one onTrigger throws', async () => {
      const boom = vi.fn(() => {
        throw new Error('explode');
      });
      const after = vi.fn();
      registerActivityEvent('boom', { trigger: () => true, onTrigger: boom });
      registerActivityEvent('after', { trigger: () => true, onTrigger: after });
      await expect(dispatchActivitySample(sampleFor())).resolves.toBeUndefined();
      expect(boom).toHaveBeenCalledOnce();
      expect(after).toHaveBeenCalledOnce();
    });

    it('awaits an async onTrigger that rejects without breaking the chain', async () => {
      const rejecting = vi.fn(() => Promise.reject(new Error('async-fail')));
      const after = vi.fn();
      registerActivityEvent('reject', { trigger: () => true, onTrigger: rejecting });
      registerActivityEvent('after', { trigger: () => true, onTrigger: after });
      await expect(dispatchActivitySample(sampleFor())).resolves.toBeUndefined();
      expect(after).toHaveBeenCalledOnce();
    });
  });

  describe('refractory throttle', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
    });

    //? The refractory window is driven by `sample.now`, not the system clock,
    //? so we advance `now` explicitly. Fake timers are enabled per the task
    //? brief; they also guard against any time-based code inside dispatch.
    //?
    //? Edge case in the source: the lastFired map defaults to 0, and the guard
    //? is `now - last < refractoryMs`. So a FIRST sample at now=0 computes
    //? `0 - 0 = 0 < refractoryMs` -> suppressed. To exercise an actual first
    //? firing we start `now` past the refractory window (here: well above any
    //? refractoryMs used below).

    it('does not throttle when refractoryMs is omitted (fires every tick)', async () => {
      const onTrigger = vi.fn();
      registerActivityEvent('no-throttle', { trigger: () => true, onTrigger });
      await dispatchActivitySample(sampleFor({ now: 0 }));
      await dispatchActivitySample(sampleFor({ now: 1 }));
      await dispatchActivitySample(sampleFor({ now: 2 }));
      expect(onTrigger).toHaveBeenCalledTimes(3);
    });

    it('does not throttle when refractoryMs is 0', async () => {
      const onTrigger = vi.fn();
      registerActivityEvent('zero', { trigger: () => true, onTrigger, refractoryMs: 0 });
      await dispatchActivitySample(sampleFor({ now: 0 }));
      await dispatchActivitySample(sampleFor({ now: 1 }));
      expect(onTrigger).toHaveBeenCalledTimes(2);
    });

    it('suppresses re-firing within the refractory window for the same socketId', async () => {
      const onTrigger = vi.fn();
      registerActivityEvent('throttled', { trigger: () => true, onTrigger, refractoryMs: 1000 });
      await dispatchActivitySample(sampleFor({ now: 10_000 }));
      await dispatchActivitySample(sampleFor({ now: 10_500 }));
      await dispatchActivitySample(sampleFor({ now: 10_999 }));
      expect(onTrigger).toHaveBeenCalledOnce();
    });

    it('fires again once the refractory window has elapsed', async () => {
      const onTrigger = vi.fn();
      registerActivityEvent('elapse', { trigger: () => true, onTrigger, refractoryMs: 1000 });
      await dispatchActivitySample(sampleFor({ now: 10_000 }));
      await dispatchActivitySample(sampleFor({ now: 11_000 }));
      expect(onTrigger).toHaveBeenCalledTimes(2);
    });

    it('throttles per socketId independently', async () => {
      const onTrigger = vi.fn();
      registerActivityEvent('per-socket', { trigger: () => true, onTrigger, refractoryMs: 1000 });
      await dispatchActivitySample(sampleFor({ socketId: 'one', now: 10_000 }));
      await dispatchActivitySample(sampleFor({ socketId: 'two', now: 10_000 }));
      //? Two distinct sockets both fire on the first sample despite sharing now.
      expect(onTrigger).toHaveBeenCalledTimes(2);
      await dispatchActivitySample(sampleFor({ socketId: 'one', now: 10_500 }));
      //? Socket "one" is still inside its window, so no third fire.
      expect(onTrigger).toHaveBeenCalledTimes(2);
    });

    it('does not record a refractory timestamp when the predicate is false', async () => {
      const trigger = vi.fn();
      const onTrigger = vi.fn();
      trigger.mockReturnValueOnce(false).mockReturnValue(true);
      registerActivityEvent('late', { trigger, onTrigger, refractoryMs: 1000 });
      //? First sample: predicate false -> no fire, no timestamp recorded.
      await dispatchActivitySample(sampleFor({ now: 10_000 }));
      //? Second sample 10ms later: predicate true -> fires immediately because
      //? no prior firing seeded the refractory window.
      await dispatchActivitySample(sampleFor({ now: 10_010 }));
      expect(onTrigger).toHaveBeenCalledOnce();
    });
  });
});
