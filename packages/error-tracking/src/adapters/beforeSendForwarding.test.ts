import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { ErrorTrackerEvent } from '@luckystack/core';

//? End-to-end proof that the PostHog adapter honours a `beforeSend` hook:
//? forwarded:false / null DROPS the event, and a transforming hook's payload
//? actually reaches the client. PostHog is the cleanest adapter to test
//? because the client handle is injected (no live SDK to stub) — we only need
//? the peer-dep RESOLVE check to pass, so we mock `node:module` createRequire
//? to return a require whose `.resolve` succeeds.

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  const fakeRequire = ((_id: string): unknown => ({})) as unknown as NodeRequire;
  fakeRequire.resolve = ((id: string): string => id) as NodeRequire['resolve'];
  return { ...actual, createRequire: () => fakeRequire };
});

interface CaptureCall {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}

const makeClient = () => {
  const captures: CaptureCall[] = [];
  const exceptions: { error: unknown; distinctId?: string; properties?: Record<string, unknown> }[] = [];
  return {
    captures,
    exceptions,
    capture: (call: CaptureCall) => captures.push(call),
    captureException: (error: unknown, distinctId?: string, properties?: Record<string, unknown>) =>
      exceptions.push({ error, distinctId, properties }),
  };
};

describe('PostHog adapter beforeSend forwarding', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('drops the exception when beforeSend returns forwarded: false', async () => {
    const { createPostHogAdapter } = await import('./posthog');
    const client = makeClient();
    const adapter = createPostHogAdapter({
      client,
      beforeSend: (event: ErrorTrackerEvent) => ({ ...event, forwarded: false }),
    });

    adapter.captureException(new Error('boom'), { email: 'real@example.com' });

    expect(client.exceptions).toHaveLength(0);
    expect(client.captures).toHaveLength(0);
  });

  it('drops the exception when beforeSend returns null', async () => {
    const { createPostHogAdapter } = await import('./posthog');
    const client = makeClient();
    const adapter = createPostHogAdapter({ client, beforeSend: () => null });

    adapter.captureException(new Error('boom'));

    expect(client.exceptions).toHaveLength(0);
  });

  it('forwards the redacted context from a transforming beforeSend, not the original', async () => {
    const { createPostHogAdapter } = await import('./posthog');
    const client = makeClient();
    const adapter = createPostHogAdapter({
      client,
      beforeSend: (event: ErrorTrackerEvent) => ({
        ...event,
        payload: { ...event.payload, context: { route: 'api/x', email: '[redacted]' } },
      }),
    });

    adapter.captureException(new Error('boom'), { route: 'api/x', email: 'real@example.com' });

    expect(client.exceptions).toHaveLength(1);
    expect(client.exceptions[0]?.properties?.email).toBe('[redacted]');
  });

  it('forwards the original context untouched when no beforeSend is set', async () => {
    const { createPostHogAdapter } = await import('./posthog');
    const client = makeClient();
    const adapter = createPostHogAdapter({ client });

    adapter.captureException(new Error('boom'), { route: 'api/x' });

    expect(client.exceptions[0]?.properties?.route).toBe('api/x');
  });
});
