import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { ErrorTrackerUser } from '@luckystack/core';

//? Regression coverage for ET-21 (formatTags must coerce non-string context
//? values instead of rendering `[object Object]`) and ET-22 (setUser must NOT
//? open a throwaway span per call — user identity is tagged on the spans the
//? adapter already opens). Mock `node:module` so the peer-dep RESOLVE guard
//? passes without a real `dd-trace` install.

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  const fakeRequire = ((_id: string): unknown => ({})) as unknown as NodeRequire;
  fakeRequire.resolve = ((id: string): string => id) as NodeRequire['resolve'];
  return { ...actual, createRequire: () => fakeRequire };
});

interface StartedSpan {
  operation: string;
  tags: Record<string, unknown>;
  finished: boolean;
}

const makeTracer = () => {
  const spans: StartedSpan[] = [];
  return {
    spans,
    startSpan: (operation: string, options?: { tags?: Record<string, unknown> }) => {
      const span: StartedSpan = { operation, tags: { ...options?.tags }, finished: false };
      spans.push(span);
      return {
        setTag: (key: string, value: unknown) => { span.tags[key] = value; },
        finish: () => { span.finished = true; },
      };
    },
  };
};

const makeStatsd = () => {
  const increments: { stat: string; value?: number; tags?: string[] }[] = [];
  return {
    increments,
    increment: (stat: string, value?: number, tags?: string[]) => increments.push({ stat, value, tags }),
    gauge: () => {},
    histogram: () => {},
  };
};

describe('datadog adapter regression', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('coerces object context values to JSON in statsd tags (ET-21 — no [object Object])', async () => {
    const { createDatadogAdapter } = await import('./datadog');
    const tracer = makeTracer();
    const statsd = makeStatsd();
    const adapter = createDatadogAdapter({ tracer, statsd });

    adapter.captureException(new Error('boom'), { meta: { a: 1 }, route: 'api/x' });

    const tags = statsd.increments[0]?.tags ?? [];
    expect(tags).toContain('meta:{"a":1}');
    expect(tags).toContain('route:api/x');
    expect(tags.some((t) => t.includes('[object Object]'))).toBe(false);
  });

  it('does NOT open a dedicated span on setUser; tags the next capture span instead (ET-22)', async () => {
    const { createDatadogAdapter } = await import('./datadog');
    const tracer = makeTracer();
    const adapter = createDatadogAdapter({ tracer });

    const user: ErrorTrackerUser = { id: 'u1', email: 'real@example.com', username: 'lucky' };
    adapter.setUser(user);

    //? setUser opened no span — the only span should appear at capture time.
    expect(tracer.spans).toHaveLength(0);

    adapter.captureException(new Error('boom'));

    expect(tracer.spans).toHaveLength(1);
    const span = tracer.spans[0];
    expect(span?.operation).toBe('luckystack.error');
    expect(span?.tags['usr.id']).toBe('u1');
    expect(span?.tags['usr.email']).toBe('real@example.com');
    expect(span?.tags['usr.name']).toBe('lucky');
    expect(span?.finished).toBe(true);
  });

  it('clears user tags when setUser(null) is called', async () => {
    const { createDatadogAdapter } = await import('./datadog');
    const tracer = makeTracer();
    const adapter = createDatadogAdapter({ tracer });

    adapter.setUser({ id: 'u1' });
    adapter.setUser(null);
    adapter.captureException(new Error('boom'));

    const span = tracer.spans[0];
    expect(span?.tags['usr.id']).toBeUndefined();
  });

  it('attributes usr.* tags to the ALS-bound identity, not the closure (ET-02)', async () => {
    const { createDatadogAdapter } = await import('./datadog');
    const { runWithErrorTrackerIdentity } = await import('@luckystack/core');
    const tracer = makeTracer();
    const adapter = createDatadogAdapter({ tracer });

    //? Closure fallback points at userA, but the capture runs inside userB's
    //? identity scope — the span must be attributed to userB.
    adapter.setUser({ id: 'userA', email: 'a@example.com', username: 'a' });
    runWithErrorTrackerIdentity({ id: 'userB', email: 'b@example.com', username: 'b' }, () => {
      adapter.captureException(new Error('boom'));
    });

    const span = tracer.spans[0];
    expect(span?.tags['usr.id']).toBe('userB');
    expect(span?.tags['usr.email']).toBe('b@example.com');
    expect(span?.tags['usr.name']).toBe('b');
  });

  it('falls back to the setUser closure identity when no ALS scope is bound', async () => {
    const { createDatadogAdapter } = await import('./datadog');
    const tracer = makeTracer();
    const adapter = createDatadogAdapter({ tracer });

    adapter.setUser({ id: 'closureUser' });
    adapter.captureException(new Error('boom'));

    expect(tracer.spans[0]?.tags['usr.id']).toBe('closureUser');
  });

  it('keeps canonical scrubbed message + ALS identity tags authoritative over context', async () => {
    const { createDatadogAdapter } = await import('./datadog');
    const tracer = makeTracer();
    const adapter = createDatadogAdapter({ tracer });
    adapter.setUser({ id: 'real-user' });

    adapter.captureMessage('password=canonical-secret', 'fatal', {
      'message.text': 'password=context-secret',
      'message.level': 'info',
      'usr.id': 'spoofed-user',
    });

    const tags = tracer.spans[0]?.tags ?? {};
    expect(String(tags['message.text'])).not.toContain('canonical-secret');
    expect(String(tags['message.text'])).not.toContain('context-secret');
    expect(tags['message.level']).toBe('fatal');
    expect(tags['usr.id']).toBe('real-user');
  });

  it('does not throw when a context value is a symbol (ET-15 formatTags guard)', async () => {
    const { createDatadogAdapter } = await import('./datadog');
    const tracer = makeTracer();
    const statsd = makeStatsd();
    const adapter = createDatadogAdapter({ tracer, statsd });

    //? A symbol context value would make `String(value)` throw a TypeError and
    //? take the whole capture path down — formatTags must coerce it safely.
    const sym = Symbol('secretish');
    expect(() => adapter.captureException(new Error('boom'), { marker: sym })).not.toThrow();

    const tags = statsd.increments[0]?.tags ?? [];
    expect(tags.some((t) => t.startsWith('marker:'))).toBe(true);
  });
});
