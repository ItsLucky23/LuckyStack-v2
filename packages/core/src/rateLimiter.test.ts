import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  defaultRateLimitStrategy,
  registerRateLimitStrategy,
  getRateLimitStrategy,
  checkRateLimit,
  getRateLimitStatus,
  clearRateLimit,
  clearAllRateLimits,
} from './rateLimiter';
import { registerProjectConfig } from './projectConfig';
import type { RateLimitStrategy } from './rateLimiter';

//? Mock the Redis DI seam so the rate limiter never constructs a real ioredis
//? client (which would also pull in env.ts -> dotenv). Each method is a spy the
//? tests configure per-scenario. The logger seam is mocked to keep the
//? one-shot fallback warning out of the test output.
const redisEval = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const redisDel = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const redisScan = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const redisMultiExec = vi.fn<() => Promise<unknown>>();

interface MultiChain {
  get: () => MultiChain;
  pttl: () => MultiChain;
  exec: () => Promise<unknown>;
}

const multiChain: MultiChain = {
  get: () => multiChain,
  pttl: () => multiChain,
  exec: () => redisMultiExec(),
};

vi.mock('./redis', () => ({
  redis: {
    eval: (...args: unknown[]): Promise<unknown> => redisEval(...args),
    del: (...args: unknown[]): Promise<unknown> => redisDel(...args),
    scan: (...args: unknown[]): Promise<unknown> => redisScan(...args),
    multi: (): MultiChain => multiChain,
  },
}));

vi.mock('./loggerRegistry', () => ({
  getLogger: (): {
    warn: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  } => ({
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

const uniqueKey = (() => {
  let counter = 0;
  return (): string => {
    counter += 1;
    return `test-key-${String(counter)}`;
  };
})();

describe('defaultRateLimitStrategy — in-memory math', () => {
  beforeEach(() => {
    // memory store, rate limiting on.
    registerProjectConfig({ rateLimiting: { enabled: true, store: 'memory' } });
    redisEval.mockReset();
    redisMultiExec.mockReset();
  });

  it('allows the first request and reports remaining = limit - 1', async () => {
    const key = uniqueKey();
    const result = await defaultRateLimitStrategy.check({ key, limit: 3, windowMs: 60_000 });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
    expect(result.resetIn).toBe(60);
  });

  it('decrements remaining on each subsequent request within the window', async () => {
    const key = uniqueKey();
    await defaultRateLimitStrategy.check({ key, limit: 3 });
    const second = await defaultRateLimitStrategy.check({ key, limit: 3 });
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(1);
  });

  it('blocks once the count exceeds the limit and clamps remaining at 0', async () => {
    const key = uniqueKey();
    await defaultRateLimitStrategy.check({ key, limit: 2 });
    await defaultRateLimitStrategy.check({ key, limit: 2 });
    const third = await defaultRateLimitStrategy.check({ key, limit: 2 });
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
  });

  it('normalizes a non-positive windowMs to the configured default window', async () => {
    registerProjectConfig({ rateLimiting: { enabled: true, store: 'memory', windowMs: 30_000 } });
    const key = uniqueKey();
    const result = await defaultRateLimitStrategy.check({ key, limit: 5, windowMs: 0 });
    expect(result.resetIn).toBe(30);
  });

  it('short-circuits to allowed (counters untouched) when rate limiting is disabled', async () => {
    registerProjectConfig({ rateLimiting: { enabled: false, store: 'memory' } });
    const key = uniqueKey();
    // Many calls, all allowed; remaining stays at the full limit.
    for (let i = 0; i < 5; i += 1) {
      const result = await defaultRateLimitStrategy.check({ key, limit: 2 });
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
    }
  });
});

describe('defaultRateLimitStrategy — getStatus (in-memory)', () => {
  beforeEach(() => {
    registerProjectConfig({ rateLimiting: { enabled: true, store: 'memory' } });
  });

  it('reports a fresh key as fully available without incrementing', async () => {
    const key = uniqueKey();
    const status = await defaultRateLimitStrategy.getStatus(key, 5);
    expect(status.allowed).toBe(true);
    expect(status.remaining).toBe(5);
    expect(status.resetIn).toBe(0);

    // Confirm getStatus did not consume a slot.
    const afterCheck = await defaultRateLimitStrategy.check({ key, limit: 5 });
    expect(afterCheck.remaining).toBe(4);
  });

  it('reflects consumed slots after a check', async () => {
    const key = uniqueKey();
    await defaultRateLimitStrategy.check({ key, limit: 5 });
    const status = await defaultRateLimitStrategy.getStatus(key, 5);
    expect(status.remaining).toBe(4);
    expect(status.allowed).toBe(true);
  });

  it('returns the allowed result when rate limiting is disabled', async () => {
    registerProjectConfig({ rateLimiting: { enabled: false, store: 'memory' } });
    const status = await defaultRateLimitStrategy.getStatus(uniqueKey(), 7);
    expect(status.allowed).toBe(true);
    expect(status.remaining).toBe(7);
  });
});

describe('defaultRateLimitStrategy — clear (in-memory)', () => {
  beforeEach(() => {
    registerProjectConfig({ rateLimiting: { enabled: true, store: 'memory' } });
  });

  it('resets a single key so the next request starts fresh', async () => {
    const key = uniqueKey();
    await defaultRateLimitStrategy.check({ key, limit: 2 });
    await defaultRateLimitStrategy.check({ key, limit: 2 });
    await defaultRateLimitStrategy.clear(key);
    const afterClear = await defaultRateLimitStrategy.check({ key, limit: 2 });
    expect(afterClear.allowed).toBe(true);
    expect(afterClear.remaining).toBe(1);
  });

  it('clearAll empties the in-memory store', async () => {
    const key = uniqueKey();
    await defaultRateLimitStrategy.check({ key, limit: 2 });
    await defaultRateLimitStrategy.check({ key, limit: 2 });
    await defaultRateLimitStrategy.clearAll();
    const afterClear = await defaultRateLimitStrategy.check({ key, limit: 2 });
    expect(afterClear.remaining).toBe(1);
  });
});

describe('defaultRateLimitStrategy — redis mode', () => {
  beforeEach(() => {
    registerProjectConfig({ rateLimiting: { enabled: true, store: 'redis' } });
    redisEval.mockReset();
    redisMultiExec.mockReset();
  });

  it('uses the Lua INCR result to compute allowed/remaining/resetIn', async () => {
    // [currentCount, ttlMs]
    redisEval.mockResolvedValue([2, 45_000]);
    const result = await defaultRateLimitStrategy.check({ key: uniqueKey(), limit: 5 });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
    expect(result.resetIn).toBe(45);
    expect(redisEval).toHaveBeenCalledTimes(1);
  });

  it('reports blocked when the redis count exceeds the limit', async () => {
    redisEval.mockResolvedValue([6, 10_000]);
    const result = await defaultRateLimitStrategy.check({ key: uniqueKey(), limit: 5 });
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('falls back to in-memory when the redis eval throws', async () => {
    redisEval.mockRejectedValue(new Error('redis down'));
    const key = uniqueKey();
    const result = await defaultRateLimitStrategy.check({ key, limit: 4 });
    // In-memory path: first request -> remaining = limit - 1.
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
  });

  it('falls back to in-memory when redis returns a malformed (too-short) array', async () => {
    redisEval.mockResolvedValue([1]);
    const result = await defaultRateLimitStrategy.check({ key: uniqueKey(), limit: 4 });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
  });

  it('getStatus reads count + ttl from a redis multi() transaction', async () => {
    // exec() -> [[getErr, getVal], [pttlErr, pttlVal]]
    redisMultiExec.mockResolvedValue([
      [null, '2'],
      [null, '30000'],
    ]);
    const status = await defaultRateLimitStrategy.getStatus(uniqueKey(), 5);
    expect(status.allowed).toBe(true);
    expect(status.remaining).toBe(3);
    expect(status.resetIn).toBe(30);
  });

  it('getStatus reports fully-available when redis has no entry (count 0)', async () => {
    redisMultiExec.mockResolvedValue([
      [null, null],
      [null, '-2'],
    ]);
    const status = await defaultRateLimitStrategy.getStatus(uniqueKey(), 5);
    expect(status.allowed).toBe(true);
    expect(status.remaining).toBe(5);
    expect(status.resetIn).toBe(0);
  });
});

describe('rate-limit strategy registry + dispatch helpers', () => {
  beforeEach(() => {
    registerRateLimitStrategy(defaultRateLimitStrategy);
    registerProjectConfig({ rateLimiting: { enabled: true, store: 'memory' } });
  });

  it('defaults to the built-in strategy', () => {
    expect(getRateLimitStrategy()).toBe(defaultRateLimitStrategy);
    expect(defaultRateLimitStrategy.name).toBe('default-memory-redis');
  });

  it('swaps the active strategy and routes all dispatch helpers through it', async () => {
    const allowedResult = { allowed: true, remaining: 99, resetIn: 0 };
    const checkSpy = vi.fn<RateLimitStrategy['check']>().mockResolvedValue(allowedResult);
    const getStatusSpy = vi.fn<RateLimitStrategy['getStatus']>().mockResolvedValue(allowedResult);
    const clearSpy = vi.fn<RateLimitStrategy['clear']>().mockResolvedValue();
    const clearAllSpy = vi.fn<RateLimitStrategy['clearAll']>().mockResolvedValue();
    const custom: RateLimitStrategy = {
      name: 'custom-test',
      check: checkSpy,
      getStatus: getStatusSpy,
      clear: clearSpy,
      clearAll: clearAllSpy,
    };

    registerRateLimitStrategy(custom);
    expect(getRateLimitStrategy()).toBe(custom);

    await checkRateLimit({ key: 'k', limit: 1 });
    await getRateLimitStatus('k', 1);
    await clearRateLimit('k');
    await clearAllRateLimits();

    expect(checkSpy).toHaveBeenCalledWith({ key: 'k', limit: 1 });
    expect(getStatusSpy).toHaveBeenCalledWith('k', 1);
    expect(clearSpy).toHaveBeenCalledWith('k');
    expect(clearAllSpy).toHaveBeenCalledTimes(1);

    // Restore the default for any later files in the same worker.
    registerRateLimitStrategy(defaultRateLimitStrategy);
  });
});
