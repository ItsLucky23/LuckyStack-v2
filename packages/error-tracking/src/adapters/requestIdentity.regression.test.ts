import { describe, it, expect, vi, beforeEach } from 'vitest';

//? Regression coverage for the per-request identity boundary and the data the
//? adapters forward:
//?   - an anonymous request inside its own scope must never inherit the user a
//?     concurrent request wrote to the process-global fallback (all adapters);
//?   - the per-request hooks must not write that global (no `$identify` per
//?     request, no cross-request leak);
//?   - Sentry/PostHog keep the scrubbed `cause` chain;
//?   - Datadog metric tags carry only low-cardinality context keys.
//? Modules are re-imported per test after `vi.resetModules()` so the adapter and
//? the test share one `@luckystack/core` instance (and one AsyncLocalStorage).

const sentryCalls: { kind: 'exception' | 'message'; payload: unknown; hint: unknown }[] = [];
const sentryGlobalUsers: unknown[] = [];
const fakeSentry = {
  captureException: (payload: unknown, hint?: unknown) => {
    sentryCalls.push({ kind: 'exception', payload, hint });
    return 'id';
  },
  captureMessage: (payload: unknown, hint?: unknown) => {
    sentryCalls.push({ kind: 'message', payload, hint });
    return 'id';
  },
  setUser: (user: unknown) => {
    sentryGlobalUsers.push(user);
  },
  setContext: () => undefined,
  startSpan: <T>(_ctx: unknown, fn: () => T): T => fn(),
  startInactiveSpan: () => ({ end: () => undefined }),
  close: async () => true,
};

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  const fakeRequire = ((id: string): unknown => (id === '@sentry/node' ? fakeSentry : {})) as unknown as NodeRequire;
  fakeRequire.resolve = ((id: string): string => id) as NodeRequire['resolve'];
  return { ...actual, createRequire: () => fakeRequire };
});

const noop = (): void => undefined;

//? Two overlapping requests: B (anonymous) opens its scope and waits; A (user X)
//? runs meanwhile and its identity is written to the global fallback the old
//? hooks used to write; then B throws.
const interleave = async (
  core: typeof import('@luckystack/core'),
  writeGlobal: () => void,
  captureInB: () => void,
): Promise<void> => {
  let releaseB = noop;
  const bMayThrow = new Promise<void>((resolve) => { releaseB = resolve; });
  const requestB = core.runWithErrorTrackerIdentityScope(async () => {
    core.setCurrentErrorTrackerIdentity(null);
    await bMayThrow;
    captureInB();
  });
  core.runWithErrorTrackerIdentityScope(() => {
    core.setCurrentErrorTrackerIdentity({ id: 'user-X', email: 'x@example.com' });
    writeGlobal();
    releaseB();
  });
  await requestB;
};

describe('request identity isolation', () => {
  beforeEach(() => {
    vi.resetModules();
    sentryCalls.length = 0;
    sentryGlobalUsers.length = 0;
  });

  it('Datadog: an anonymous request is not tagged with a concurrent user', async () => {
    const core = await import('@luckystack/core');
    const { createDatadogAdapter } = await import('./datadog');
    const spans: Record<string, unknown>[] = [];
    const adapter = createDatadogAdapter({
      tracer: {
        startSpan: (_op, options) => {
          spans.push({ ...options?.tags });
          return { setTag: noop, finish: noop };
        },
      },
    });

    await interleave(
      core,
      () => { adapter.setUser({ id: 'user-X', email: 'x@example.com' }); },
      () => { adapter.captureException(new Error('B failed')); },
    );

    expect(spans[0]?.['usr.id']).toBeUndefined();
    expect(spans[0]?.['usr.email']).toBeUndefined();
  });

  it('PostHog: an anonymous request gets the anonymous distinctId', async () => {
    const core = await import('@luckystack/core');
    const { createPostHogAdapter } = await import('./posthog');
    const events: { distinctId: string }[] = [];
    const adapter = createPostHogAdapter({ client: { capture: (event) => events.push(event), identify: noop } });

    await interleave(
      core,
      () => { adapter.setUser({ id: 'user-X', email: 'x@example.com' }); },
      () => { adapter.captureException(new Error('B failed')); },
    );

    expect(events[0]?.distinctId).toBe('anonymous');
  });

  it('PostHog: background captures outside any scope still use the setUser fallback', async () => {
    const { createPostHogAdapter } = await import('./posthog');
    const events: { distinctId: string }[] = [];
    const adapter = createPostHogAdapter({ client: { capture: (event) => events.push(event) } });
    adapter.setUser({ id: 'cron-user' });
    adapter.captureMessage('job done', 'info');
    expect(events[0]?.distinctId).toBe('cron-user');
  });

  it('Sentry: an anonymous request clears every user field on the event', async () => {
    const core = await import('@luckystack/core');
    const { createSentryAdapter } = await import('./sentry');
    const adapter = createSentryAdapter();

    await interleave(
      core,
      () => { adapter.setUser({ id: 'user-X', email: 'x@example.com' }); },
      () => { adapter.captureException(new Error('B failed')); },
    );

    const hint = sentryCalls[0]?.hint as { user?: Record<string, unknown> } | undefined;
    expect(hint?.user).toBeDefined();
    expect(hint?.user?.id).toBeUndefined();
    expect(hint?.user?.email).toBeUndefined();
    expect(Object.keys(hint?.user ?? {})).toEqual(expect.arrayContaining(['id', 'email', 'username', 'ip_address']));
  });

  it('per-request hooks write only the request scope, never the global user', async () => {
    const core = await import('@luckystack/core');
    const { enableErrorTrackingAutoInstrumentation } = await import('../autoInstrumentation');
    const setUser = vi.fn();
    core.registerErrorTracker({ name: 'spy', captureException: noop, captureMessage: noop, setUser });
    enableErrorTrackingAutoInstrumentation();

    let seen: unknown = 'unset';
    await core.runWithErrorTrackerIdentityScope(async () => {
      await core.dispatchHook('preApiValidate', {
        routeName: 'api/x/v1',
        data: {},
        user: { id: 'user-X', email: 'x@example.com', name: 'X' },
      });
      seen = core.getCurrentErrorTrackerIdentity();
    });

    expect(seen).toEqual({ id: 'user-X', email: 'x@example.com', username: 'X' });
    expect(setUser).not.toHaveBeenCalled();
    core.registerErrorTrackers([]);
  });
});

describe('PostHog identify', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('identifies a user once, and again only when the identity changes', async () => {
    const { createPostHogAdapter } = await import('./posthog');
    const identify = vi.fn();
    const adapter = createPostHogAdapter({ client: { capture: noop, identify } });

    for (let i = 0; i < 5; i += 1) adapter.setUser({ id: 'u1', email: 'u1@example.com' });
    expect(identify).toHaveBeenCalledTimes(1);

    adapter.setUser({ id: 'u1', email: 'new@example.com' });
    adapter.setUser({ id: 'u2' });
    expect(identify).toHaveBeenCalledTimes(3);
  });
});

describe('error cause forwarding', () => {
  beforeEach(() => {
    vi.resetModules();
    sentryCalls.length = 0;
  });

  const makeBatchError = (): Error => {
    const smtp = new Error('SMTP 550 mailbox unavailable password=hunter2');
    Reflect.set(smtp, 'responseCode', 550);
    Reflect.set(smtp, 'response', 'raw provider echo with an address');
    return new Error('[email] batch: rejected (3x)', { cause: smtp });
  };

  it('Sentry keeps the scrubbed cause and its safe code fields', async () => {
    const { createSentryAdapter } = await import('./sentry');
    createSentryAdapter().captureException(makeBatchError());

    const payload = sentryCalls[0]?.payload;
    if (!(payload instanceof Error)) throw new Error('expected an Error payload');
    const cause = payload.cause;
    if (!(cause instanceof Error)) throw new Error('expected the cause to survive');
    expect(cause.message).toContain('SMTP 550 mailbox unavailable');
    expect(cause.message).not.toContain('hunter2');
    expect(Reflect.get(cause, 'responseCode')).toBe(550);
    expect(Reflect.get(cause, 'response')).toBeUndefined();
  });

  it('PostHog keeps the scrubbed cause', async () => {
    const { createPostHogAdapter } = await import('./posthog');
    const sent: unknown[] = [];
    createPostHogAdapter({
      client: { capture: noop, captureException: (error) => { sent.push(error); } },
    }).captureException(makeBatchError());

    const payload = sent[0];
    if (!(payload instanceof Error)) throw new Error('expected an Error payload');
    expect(payload.cause).toBeInstanceOf(Error);
    expect(String((payload.cause as Error).message)).not.toContain('hunter2');
  });

  it('stops at a cyclic cause chain', async () => {
    const { createSentryAdapter } = await import('./sentry');
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    Reflect.set(a, 'cause', b);
    expect(() => { createSentryAdapter().captureException(a); }).not.toThrow();
  });
});

describe('Datadog metric tags', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const makeStatsd = () => {
    const increments: { stat: string; tags?: string[] }[] = [];
    return {
      increments,
      increment: (stat: string, _value?: number, tags?: string[]) => { increments.push({ stat, tags }); },
      gauge: noop,
      histogram: noop,
    };
  };
  const tracer = { startSpan: () => ({ setTag: noop, finish: noop }) };

  it('tags the counter with low-cardinality keys only; the span keeps the full context', async () => {
    const { createDatadogAdapter } = await import('./datadog');
    const statsd = makeStatsd();
    const adapter = createDatadogAdapter({ tracer, statsd });

    adapter.captureException(new TypeError('boom'), {
      source: 'httpHandler.api',
      method: 'POST',
      requestId: '0b8f5a8e-1f7c-4a65-9d1e-3c2f0e9a1b11',
      routePath: '/api/user/42/v1',
    });
    adapter.captureMessage('slow', 'warning', { fn: 'sendEmail', subject: 'Welcome, Sam' });

    expect(statsd.increments[0]?.tags).toEqual(['source:httpHandler.api', 'method:POST', 'error.type:TypeError']);
    expect(statsd.increments[1]?.tags).toEqual(['level:warning', 'fn:sendEmail']);
  });

  it('honours a custom metricTagKeys list', async () => {
    const { createDatadogAdapter } = await import('./datadog');
    const statsd = makeStatsd();
    createDatadogAdapter({ tracer, statsd, metricTagKeys: ['tenant'] })
      .captureMessage('x', 'info', { tenant: 'acme', source: 'job' });
    expect(statsd.increments[0]?.tags).toEqual(['level:info', 'tenant:acme']);
  });
});
