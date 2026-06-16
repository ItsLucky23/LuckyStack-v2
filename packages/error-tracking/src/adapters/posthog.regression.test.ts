import { describe, it, expect, vi, beforeEach } from 'vitest';

//? `runWithErrorTrackerIdentity` is imported dynamically INSIDE each test (after
//? `vi.resetModules()`) so it resolves to the SAME `@luckystack/core` module
//? instance — and thus the same `AsyncLocalStorage` — that the dynamically
//? re-imported `./posthog` adapter reads. A top-level import would bind the
//? pre-reset instance and the ALS scope would never reach the adapter.

//? Regression coverage for ET-02 (per-event identity read from the
//? AsyncLocalStorage scope instead of a process-global mutable distinctId, so
//? concurrent requests can't cross-attribute events) and ET-16 (flush() drains
//? posthog-node's batch on shutdown). Mock `node:module` so the peer-dep RESOLVE
//? guard passes without a real `posthog-node` install.

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  const fakeRequire = ((_id: string): unknown => ({})) as unknown as NodeRequire;
  fakeRequire.resolve = ((id: string): string => id) as NodeRequire['resolve'];
  return { ...actual, createRequire: () => fakeRequire };
});

interface CapturedEvent {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}

const makeClient = () => {
  const events: CapturedEvent[] = [];
  let shutdownCalls = 0;
  return {
    events,
    get shutdownCalls() {
      return shutdownCalls;
    },
    capture: (event: CapturedEvent) => events.push(event),
    shutdown: async () => {
      shutdownCalls += 1;
    },
  };
};

describe('posthog adapter regression', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('attributes captures to the ALS-bound identity, not a process-global (ET-02)', async () => {
    const { createPostHogAdapter } = await import('./posthog');
    const { runWithErrorTrackerIdentity } = await import('@luckystack/core');
    const client = makeClient();
    const adapter = createPostHogAdapter({ client });

    //? Two interleaved "requests" each run in their own identity scope. Even
    //? though the scopes overlap, each capture must file under its own user.
    runWithErrorTrackerIdentity({ id: 'userA' }, () => {
      runWithErrorTrackerIdentity({ id: 'userB' }, () => {
        adapter.captureException(new Error('inner'));
      });
      adapter.captureException(new Error('outer'));
    });

    expect(client.events).toHaveLength(2);
    expect(client.events[0]?.distinctId).toBe('userB');
    expect(client.events[1]?.distinctId).toBe('userA');
  });

  it('falls back to the setUser closure id when no ALS scope is bound (back-compat)', async () => {
    const { createPostHogAdapter } = await import('./posthog');
    const client = makeClient();
    const adapter = createPostHogAdapter({ client });

    adapter.setUser({ id: 'closureUser' });
    adapter.captureException(new Error('boom'));

    expect(client.events[0]?.distinctId).toBe('closureUser');
  });

  it('falls back to anonymousDistinctId with no identity at all', async () => {
    const { createPostHogAdapter } = await import('./posthog');
    const client = makeClient();
    const adapter = createPostHogAdapter({ client, anonymousDistinctId: 'anon-x' });

    adapter.captureException(new Error('boom'));

    expect(client.events[0]?.distinctId).toBe('anon-x');
  });

  it('flush() drains the posthog client batch (ET-16)', async () => {
    const { createPostHogAdapter } = await import('./posthog');
    const client = makeClient();
    const adapter = createPostHogAdapter({ client });

    await adapter.flush?.();

    expect(client.shutdownCalls).toBe(1);
  });
});
