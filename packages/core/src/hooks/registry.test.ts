import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerErrorTracker, registerErrorTrackers } from '../errorTrackerRegistry';
import { registerLogger, resetLoggerForTests } from '../loggerRegistry';
import { clearAllHooks, dispatchHook, dispatchSyncHook, registerHook, registerSyncHook } from './registry';

const payload = { origin: 'https://evil.test', normalizedOrigin: 'https://evil.test', allowedOrigins: [], allowLocalhost: false };

describe('dispatchHook error reporting', () => {
  const captured: unknown[] = [];
  const logged: string[] = [];

  beforeEach(() => {
    clearAllHooks();
    captured.length = 0;
    logged.length = 0;
    registerErrorTrackers([]);
    registerErrorTracker({
      name: 'recording',
      captureException: (error) => { captured.push(error); },
      captureMessage: () => { /* not used here */ },
      setUser: () => { /* not used here */ },
    });
    registerLogger({ debug: () => undefined, info: () => undefined, warn: () => undefined, error: (message) => { logged.push(message); } });
  });

  afterEach(() => {
    resetLoggerForTests();
    registerErrorTrackers([]);
  });

  it('logs and captures a throwing handler by default, and keeps dispatching', async () => {
    const boom = new Error('boom');
    registerHook('corsRejected', () => { throw boom; });
    registerHook('corsRejected', () => ({ stop: true, errorCode: 'second' }));

    const result = await dispatchHook('corsRejected', payload);

    expect(result).toEqual({ stopped: true, signal: { stop: true, errorCode: 'second' } });
    expect(captured).toEqual([boom]);
    expect(logged).toEqual(['hook: handler for "corsRejected" threw']);
  });

  it('hands the error to onError instead, which may throw without breaking the dispatch', async () => {
    const boom = new Error('boom');
    const received: unknown[] = [];
    registerHook('corsRejected', () => { throw boom; });
    registerHook('corsRejected', () => { throw boom; });

    const result = await dispatchHook('corsRejected', payload, {
      onError: (error) => {
        received.push(error);
        throw new Error('reporter failed');
      },
    });

    expect(result).toEqual({ stopped: false });
    expect(received).toEqual([boom, boom]);
    expect(captured).toEqual([]);
    expect(logged).toEqual([]);
  });
});

describe('unsubscribing during a dispatch', () => {
  beforeEach(() => {
    clearAllHooks();
  });

  it('still runs the next handler when an already-visited handler is removed mid-dispatch', async () => {
    const ran: string[] = [];
    let releaseA: () => void = () => undefined;
    const aGate = new Promise<void>((resolve) => { releaseA = resolve; });
    const offA = registerHook('corsRejected', async () => { ran.push('A'); await aGate; });
    registerHook('corsRejected', () => { ran.push('B'); return { stop: true, errorCode: 'auth.forbidden' }; });
    registerHook('corsRejected', () => { ran.push('C'); });

    const pending = dispatchHook('corsRejected', payload);
    offA();
    releaseA();
    const result = await pending;

    expect(result).toEqual({ stopped: true, signal: { stop: true, errorCode: 'auth.forbidden' } });
    expect(ran).toEqual(['A', 'B']);
  });

  it('runs the next handler when a handler unsubscribes itself', async () => {
    const ran: string[] = [];
    const off = registerHook('corsRejected', () => { ran.push('once'); off(); });
    registerHook('corsRejected', () => { ran.push('audit'); });

    await dispatchHook('corsRejected', payload);
    await dispatchHook('corsRejected', payload);

    expect(ran).toEqual(['once', 'audit', 'audit']);
  });

  it('runs the next sync handler when a sync handler unsubscribes itself', () => {
    const ran: string[] = [];
    const off = registerSyncHook('preErrorNormalize', () => { ran.push('once'); off(); });
    registerSyncHook('preErrorNormalize', () => { ran.push('audit'); });

    dispatchSyncHook('preErrorNormalize', { response: { status: 'error' } });

    expect(ran).toEqual(['once', 'audit']);
  });
});
