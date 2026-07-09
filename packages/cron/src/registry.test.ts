import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    logger,
    acquireLease: vi.fn(async () => null),
    renewLease: vi.fn(async () => true),
    releaseLease: vi.fn(async () => true),
    dispatchHook: vi.fn(async () => ({ stopped: false as const })),
    registerHook: vi.fn(),
  };
});

vi.mock('@luckystack/core', () => {
  const deepMergeImpl = (
    base: Record<string, unknown>,
    override: Record<string, unknown>,
  ): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(override ?? {})) {
      const baseValue = base?.[key];
      out[key] =
        value && typeof value === 'object' && !Array.isArray(value)
          ? deepMergeImpl(
              (baseValue ?? {}) as Record<string, unknown>,
              value as Record<string, unknown>,
            )
          : value;
    }
    return out;
  };
  return {
    acquireLease: mocks.acquireLease,
    renewLease: mocks.renewLease,
    releaseLease: mocks.releaseLease,
    dispatchHook: mocks.dispatchHook,
    registerHook: mocks.registerHook,
    getLogger: () => mocks.logger,
    formatKey: (namespace: string, suffix = ''): string =>
      suffix ? `test:${namespace}:${suffix}` : `test:${namespace}`,
    redis: { hset: vi.fn(), hincrby: vi.fn(), hgetall: vi.fn(async () => ({})) },
    tryCatch: async <T>(fn: () => Promise<T>): Promise<[Error | null, T | null]> => {
      try {
        return [null, await fn()];
      } catch (error) {
        return [error instanceof Error ? error : new Error(String(error)), null];
      }
    },
    deepMerge: deepMergeImpl,
  };
});

import {
  clearCronJobsForTests,
  getCronJobNames,
  registerCronJob,
  unregisterCronJob,
} from './registry';
import { resetCronSchedulerForTests } from './scheduler';

const noop = (): void => undefined;

afterEach(() => {
  clearCronJobsForTests();
  resetCronSchedulerForTests();
  vi.clearAllMocks();
});

describe('registerCronJob validation', () => {
  it('rejects names with a colon (Redis namespace separator)', () => {
    expect(() =>
      registerCronJob({ name: 'bad:name', schedule: { everyMs: 5000 }, handler: noop }),
    ).toThrow(/invalid job name/);
  });

  it('rejects empty / non-string names', () => {
    expect(() =>
      registerCronJob({ name: '', schedule: { everyMs: 5000 }, handler: noop }),
    ).toThrow(/invalid job name/);
  });

  it('rejects a missing handler', () => {
    expect(() =>
      registerCronJob({
        name: 'no-handler',
        schedule: { everyMs: 5000 },
        handler: undefined as unknown as () => void,
      }),
    ).toThrow(/no handler/);
  });

  it('rejects an invalid schedule at registration time', () => {
    expect(() =>
      registerCronJob({ name: 'bad-schedule', schedule: 'not a cron', handler: noop }),
    ).toThrow();
    expect(() =>
      registerCronJob({ name: 'bad-interval', schedule: { everyMs: 1 }, handler: noop }),
    ).toThrow(/invalid interval/);
  });
});

describe('registerCronJob lifecycle', () => {
  it('registers, lists, and unregisters jobs', () => {
    registerCronJob({ name: 'job-a', schedule: { everyMs: 5000 }, handler: noop });
    registerCronJob({ name: 'job-b', schedule: '*/5 * * * *', handler: noop });
    expect(getCronJobNames()).toEqual(['job-a', 'job-b']);

    expect(unregisterCronJob('job-a')).toBe(true);
    expect(unregisterCronJob('job-a')).toBe(false);
    expect(getCronJobNames()).toEqual(['job-b']);
  });

  it('replaces an existing job on re-registration (hot-reload friendly)', () => {
    registerCronJob({ name: 'job-a', schedule: { everyMs: 5000 }, handler: noop });
    registerCronJob({ name: 'job-a', schedule: { everyMs: 9000 }, handler: noop });
    expect(getCronJobNames()).toEqual(['job-a']);
    expect(mocks.logger.debug).toHaveBeenCalledWith(expect.stringContaining('re-registered'));
  });

  it('returns an unregister function', () => {
    const unregister = registerCronJob({
      name: 'job-a',
      schedule: { everyMs: 5000 },
      handler: noop,
    });
    unregister();
    expect(getCronJobNames()).toEqual([]);
  });

  it('registers the preServerStop teardown when the scheduler starts', () => {
    registerCronJob({ name: 'job-a', schedule: { everyMs: 5000 }, handler: noop });
    expect(mocks.registerHook).toHaveBeenCalledWith('preServerStop', expect.any(Function));
  });
});
