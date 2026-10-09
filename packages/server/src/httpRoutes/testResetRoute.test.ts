import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

//? `/_test/reset` scoping: `?only=` must clear exactly the listed targets.
//? The bug this pins: the runner's between-endpoint reset used the unscoped
//? default, which also deleted the authenticated sweep's own Redis session.
//? Real `@luckystack/core` config + key formatting; only the side-effecting
//? clears (limiter, Redis, hooks) are stubbed and recorded.

const clearAllRateLimits = vi.fn((): Promise<void> => Promise.resolve());
const clearAllHooks = vi.fn();
const scannedPatterns: string[] = [];

vi.mock('@luckystack/core', async () => {
  const actual = await vi.importActual<typeof import('@luckystack/core')>('@luckystack/core');
  return {
    ...actual,
    clearAllRateLimits: () => clearAllRateLimits(),
    clearAllHooks: () => { clearAllHooks(); },
    redis: {
      scan: (_cursor: string, _match: string, pattern: string) => {
        scannedPatterns.push(pattern);
        return Promise.resolve(['0', [`${pattern}-key`]]);
      },
      del: () => Promise.resolve(1),
    },
  };
});

import { registerProjectConfig } from '@luckystack/core';
import { handleTestResetRoute } from './testResetRoute';
import type { HttpRouteContext } from './types';

const TOKEN = 'reset-secret';

const call = async (query = ''): Promise<{ status: number; body: { status: string; cleared?: string[]; errorCode?: string } }> => {
  let body = '';
  const res = {
    statusCode: 0,
    setHeader: () => { /* headers are not under test */ },
    end: (chunk?: string) => { body = chunk ?? ''; },
  };
  const req = { method: 'POST', url: `/_test/reset${query}`, headers: { 'x-test-reset-token': TOKEN } };
  const ctx = { req, res, routePath: '/_test/reset' } as unknown as HttpRouteContext;
  await handleTestResetRoute(ctx);
  return { status: res.statusCode, body: JSON.parse(body) as { status: string; cleared?: string[]; errorCode?: string } };
};

const originalEnv = { nodeEnv: process.env.NODE_ENV, token: process.env.TEST_RESET_TOKEN };

beforeEach(() => {
  registerProjectConfig({});
  process.env.NODE_ENV = 'test';
  process.env.TEST_RESET_TOKEN = TOKEN;
  scannedPatterns.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  process.env.NODE_ENV = originalEnv.nodeEnv;
  if (originalEnv.token === undefined) delete process.env.TEST_RESET_TOKEN;
  else process.env.TEST_RESET_TOKEN = originalEnv.token;
});

describe('handleTestResetRoute ?only=', () => {
  it('only=rateLimits clears the limiter and leaves sessions alone', async () => {
    const { status, body } = await call('?only=rateLimits');
    expect(status).toBe(200);
    expect(body.cleared).toStrictEqual(['rateLimits']);
    expect(clearAllRateLimits).toHaveBeenCalledTimes(1);
    expect(scannedPatterns).toStrictEqual([]);
    expect(clearAllHooks).not.toHaveBeenCalled();
  });

  it('accepts a comma list and clears exactly those targets', async () => {
    const { body } = await call('?only=sessions,hooks');
    expect(clearAllRateLimits).not.toHaveBeenCalled();
    expect(scannedPatterns).toHaveLength(1);
    expect(scannedPatterns[0]).toContain('-session');
    expect(body.cleared).toStrictEqual(['sessions', 'hooks']);
  });

  it('rejects an unknown target with 400 and clears nothing', async () => {
    const { status, body } = await call('?only=rateLimits,sesions');
    expect(status).toBe(400);
    expect(body.errorCode).toBe('test.invalidResetTarget');
    expect(clearAllRateLimits).not.toHaveBeenCalled();
    expect(scannedPatterns).toStrictEqual([]);
  });

  it('rejects an empty only= rather than treating it as "everything"', async () => {
    const { status } = await call('?only=');
    expect(status).toBe(400);
    expect(clearAllRateLimits).not.toHaveBeenCalled();
  });

  it('without only= keeps the legacy default: rate limits + sessions + activeUsers, no hooks', async () => {
    const { body } = await call();
    expect(body.cleared).toStrictEqual(['rateLimits', 'sessions', 'activeUsers']);
    expect(clearAllHooks).not.toHaveBeenCalled();
  });

  it('without only=, include=hooks still adds the hook clear', async () => {
    const { body } = await call('?include=hooks');
    expect(body.cleared).toContain('hooks');
    expect(clearAllHooks).toHaveBeenCalledTimes(1);
  });
});
