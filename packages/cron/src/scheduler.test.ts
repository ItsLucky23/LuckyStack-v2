import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    logger,
    acquireLease: vi.fn(),
    renewLease: vi.fn(async () => true),
    releaseLease: vi.fn(async () => true),
    dispatchHook: vi.fn<
      (name: string, payload?: unknown) => Promise<{ stopped: boolean; signal?: unknown }>
    >(async () => ({ stopped: false })),
    registerHook: vi.fn(),
    redis: {
      hset: vi.fn(async () => 1),
      hincrby: vi.fn(async () => 1),
      hgetall: vi.fn(async () => ({})),
    },
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
    redis: mocks.redis,
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

import { registerCronConfig, resetCronConfigForTests } from './cronConfig';
import { clearCronJobsForTests, registerCronJob } from './registry';
import {
  isCronLeader,
  resetCronSchedulerForTests,
  runCronJobNow,
  stopCronScheduler,
} from './scheduler';

//? Leadership grants only the scheduler lease by default; per-run leases are
//? granted too unless a test overrides.
const grantAllLeases = (): void => {
  mocks.acquireLease.mockImplementation(async (name: string) =>
    name.startsWith('cron-run:') ? `run-token-${name}` : 'leader-token',
  );
};

const denyLeadership = (): void => {
  mocks.acquireLease.mockImplementation(async (name: string) =>
    name.startsWith('cron-run:') ? `run-token-${name}` : null,
  );
};

beforeEach(() => {
  vi.useFakeTimers();
  //? Re-establish default implementations — per-test `mockImplementation`
  //? overrides (veto, failed renewal) must never bleed into the next test.
  grantAllLeases();
  mocks.renewLease.mockImplementation(async () => true);
  mocks.releaseLease.mockImplementation(async () => true);
  mocks.dispatchHook.mockImplementation(async () => ({ stopped: false as const }));
});

afterEach(() => {
  clearCronJobsForTests();
  resetCronSchedulerForTests();
  resetCronConfigForTests();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('leadership', () => {
  it('acquires the scheduler lease and runs a due job', async () => {
    const handler = vi.fn();
    registerCronJob({ name: 'job-a', schedule: { everyMs: 1000 }, handler });

    await vi.advanceTimersByTimeAsync(1); // flush the immediate leaderTick
    expect(isCronLeader()).toBe(true);

    await vi.advanceTimersByTimeAsync(1100);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ jobName: 'job-a', scheduledFor: expect.any(Number) }),
    );
  });

  it('never runs jobs while another instance holds the lease', async () => {
    denyLeadership();
    const handler = vi.fn();
    registerCronJob({ name: 'job-a', schedule: { everyMs: 1000 }, handler });

    await vi.advanceTimersByTimeAsync(5000);
    expect(isCronLeader()).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('stops firing after losing the lease and resumes after re-acquiring', async () => {
    const handler = vi.fn();
    registerCronJob({ name: 'job-a', schedule: { everyMs: 1000 }, handler });
    await vi.advanceTimersByTimeAsync(1100);
    expect(handler).toHaveBeenCalledTimes(1);

    //? Renewal fails at the next leader tick (10s) → leadership lost.
    mocks.renewLease.mockResolvedValue(false);
    denyLeadership();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(isCronLeader()).toBe(false);
    expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('lost scheduler leadership'));

    const callsWhileFollower = handler.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(handler).toHaveBeenCalledTimes(callsWhileFollower);

    //? Lease becomes free again → re-acquire on a later leader tick.
    grantAllLeases();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(isCronLeader()).toBe(true);
  });

  it('does nothing when cronConfig.enabled is false', async () => {
    registerCronConfig({ enabled: false });
    const handler = vi.fn();
    registerCronJob({ name: 'job-a', schedule: { everyMs: 1000 }, handler });

    await vi.advanceTimersByTimeAsync(15_000);
    expect(isCronLeader()).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(mocks.acquireLease).not.toHaveBeenCalled();
  });
});

describe('run behavior', () => {
  it('skips the next tick while the previous run is still going (overlap guard)', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = vi.fn(async () => gate);
    registerCronJob({ name: 'slow', schedule: { everyMs: 1000 }, handler });

    await vi.advanceTimersByTimeAsync(1100); // first run starts, blocks on the gate
    expect(handler).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000); // second tick lands while running
    expect(handler).toHaveBeenCalledTimes(1);
    expect(mocks.redis.hincrby).toHaveBeenCalledWith(expect.stringContaining('slow'), 'skipCount', 1);

    release();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.redis.hset).toHaveBeenCalled(); // run stats written after completion
  });

  it('skips when the per-run lease is held elsewhere', async () => {
    mocks.acquireLease.mockImplementation(async (name: string) =>
      name.startsWith('cron-run:') ? null : 'leader-token',
    );
    const handler = vi.fn();
    registerCronJob({ name: 'job-a', schedule: { everyMs: 1000 }, handler });

    await vi.advanceTimersByTimeAsync(1100);
    expect(handler).not.toHaveBeenCalled();
    expect(mocks.redis.hincrby).toHaveBeenCalledWith(expect.stringContaining('job-a'), 'skipCount', 1);
  });

  it('a preCronRun stop signal vetoes the run', async () => {
    mocks.dispatchHook.mockImplementation(async (name: string) =>
      name === 'preCronRun'
        ? { stopped: true as const, signal: { stop: true as const, errorCode: 'maintenance' } }
        : { stopped: false as const },
    );
    const handler = vi.fn();
    registerCronJob({ name: 'job-a', schedule: { everyMs: 1000 }, handler });

    await vi.advanceTimersByTimeAsync(1100);
    expect(handler).not.toHaveBeenCalled();
  });

  it('captures a failing handler, records error stats, and dispatches postCronRun', async () => {
    const boom = new Error('boom');
    const handler = vi.fn(async () => {
      throw boom;
    });
    registerCronJob({ name: 'fails', schedule: { everyMs: 1000 }, handler });

    await vi.advanceTimersByTimeAsync(1100);
    expect(mocks.redis.hset).toHaveBeenCalledWith(
      expect.stringContaining('fails'),
      expect.objectContaining({ lastStatus: 'error', lastError: 'boom' }),
    );
    expect(mocks.redis.hincrby).toHaveBeenCalledWith(expect.stringContaining('fails'), 'failCount', 1);
    expect(mocks.dispatchHook).toHaveBeenCalledWith(
      'postCronRun',
      expect.objectContaining({ jobName: 'fails', error: boom }),
    );
    expect(mocks.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('fails'),
      boom,
      expect.any(Object),
    );
  });

  it('fans out over tenants with ctx.tenant set, isolating per-tenant failures', async () => {
    const seen: unknown[] = [];
    const handler = vi.fn(async (ctx: { tenant?: unknown }) => {
      seen.push(ctx.tenant);
      if (ctx.tenant === 'ws-2') throw new Error('tenant boom');
    });
    registerCronJob({
      name: 'fanout',
      schedule: { everyMs: 1000 },
      handler,
      perTenant: { tenants: () => ['ws-1', 'ws-2', 'ws-3'] },
    });

    await vi.advanceTimersByTimeAsync(1100);
    expect(seen).toEqual(['ws-1', 'ws-2', 'ws-3']);
    //? The run's recorded error is the FIRST tenant failure.
    expect(mocks.redis.hset).toHaveBeenCalledWith(
      expect.stringContaining('fanout'),
      expect.objectContaining({ lastStatus: 'error', lastError: 'tenant boom' }),
    );
  });

  it('runOnStart fires once on gaining leadership, then follows the schedule', async () => {
    const handler = vi.fn();
    registerCronJob({ name: 'warmup', schedule: '0 3 * * *', handler, runOnStart: true });

    await vi.advanceTimersByTimeAsync(1100);
    expect(handler).toHaveBeenCalledTimes(1); // fired immediately, not at 03:00
  });
});

describe('runCronJobNow', () => {
  it('runs a job on demand without leadership', async () => {
    denyLeadership();
    const handler = vi.fn();
    registerCronJob({ name: 'manual', schedule: '0 3 * * *', handler });

    const error = await runCronJobNow('manual');
    expect(error).toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('returns the handler error instead of throwing', async () => {
    const boom = new Error('boom');
    registerCronJob({
      name: 'manual-fail',
      schedule: '0 3 * * *',
      handler: async () => {
        throw boom;
      },
    });
    expect(await runCronJobNow('manual-fail')).toBe(boom);
  });

  it('throws for an unknown job', async () => {
    await expect(runCronJobNow('nope')).rejects.toThrow(/no job registered/);
  });
});

describe('shutdown', () => {
  it('stopCronScheduler halts ticks and releases the leader lease', async () => {
    const handler = vi.fn();
    registerCronJob({ name: 'job-a', schedule: { everyMs: 1000 }, handler });
    await vi.advanceTimersByTimeAsync(1100);
    expect(handler).toHaveBeenCalledTimes(1);

    await stopCronScheduler();
    expect(mocks.releaseLease).toHaveBeenCalledWith('cron-scheduler', 'leader-token');
    expect(isCronLeader()).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
