import { describe, it, expect, afterEach, vi } from 'vitest';

import {
  registerApiRequestInterceptor,
  registerApiResponseInterceptor,
  dispatchApiRequestInterceptors,
  dispatchApiResponseInterceptors,
  _resetApiInterceptorsForTests,
} from './apiInterceptors';

afterEach(() => {
  _resetApiInterceptorsForTests();
  vi.restoreAllMocks();
});

describe('apiInterceptors (EXT-03)', () => {
  it('lets a request interceptor mutate the outgoing data in place', async () => {
    registerApiRequestInterceptor((ctx) => {
      ctx.data.correlationId = 'abc-123';
    });
    const ctx: { name: string; version: string; data: Record<string, unknown> } = {
      name: 'examples/getUserData',
      version: 'v1',
      data: {},
    };
    await dispatchApiRequestInterceptors(ctx);
    expect(ctx.data.correlationId).toBe('abc-123');
  });

  it('runs request interceptors in registration order and awaits async ones', async () => {
    const order: string[] = [];
    registerApiRequestInterceptor(async (ctx) => {
      await Promise.resolve();
      order.push('first');
      ctx.data.first = true;
    });
    registerApiRequestInterceptor((ctx) => {
      order.push('second');
      ctx.data.second = true;
    });
    const ctx: { name: string; version: string; data: Record<string, unknown> } = {
      name: 'a/b',
      version: 'v1',
      data: {},
    };
    await dispatchApiRequestInterceptors(ctx);
    expect(order).toEqual(['first', 'second']);
    expect(ctx.data).toEqual({ first: true, second: true });
  });

  it('unsubscribe removes a request interceptor', async () => {
    const spy = vi.fn();
    const unsubscribe = registerApiRequestInterceptor(spy);
    unsubscribe();
    await dispatchApiRequestInterceptors({ name: 'a/b', version: 'v1', data: {} });
    expect(spy).not.toHaveBeenCalled();
  });

  it('a throwing request interceptor is isolated and does not block siblings', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {
      /* swallow expected error log */
    });
    const after = vi.fn();
    registerApiRequestInterceptor(() => {
      throw new Error('boom');
    });
    registerApiRequestInterceptor(after);
    await dispatchApiRequestInterceptors({ name: 'a/b', version: 'v1', data: {} });
    expect(after).toHaveBeenCalledOnce();
  });

  it('response interceptors observe the response envelope', () => {
    const seen: unknown[] = [];
    registerApiResponseInterceptor((ctx) => {
      seen.push(ctx.response.status);
    });
    dispatchApiResponseInterceptors({
      name: 'a/b',
      version: 'v1',
      response: { status: 'success', result: 1 },
    });
    expect(seen).toEqual(['success']);
  });

  it('an interceptor that unregisters itself mid-dispatch does not skip a sibling', async () => {
    const visited: string[] = [];
    const unsubscribeSelf = registerApiRequestInterceptor(() => {
      visited.push('self');
      unsubscribeSelf();
    });
    registerApiRequestInterceptor(() => {
      visited.push('sibling');
    });
    await dispatchApiRequestInterceptors({ name: 'a/b', version: 'v1', data: {} });
    expect(visited).toEqual(['self', 'sibling']);
  });
});
