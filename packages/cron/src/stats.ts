//? Per-job run bookkeeping in Redis so "did the nightly job run, how long, did
//? it fail?" is answerable from ANY instance (the leader may be elsewhere).
//? Stats writes are best-effort: a Redis hiccup never fails the job itself
//? (tryCatch captures it to the error tracker and moves on).

import { redis, formatKey, tryCatch } from '@luckystack/core';

const statsKey = (jobName: string): string => formatKey('cron', `job:${jobName}`);

export interface CronJobStats {
  /** Start time of the most recent run (ms epoch). */
  lastRunAt: number | null;
  lastDurationMs: number | null;
  lastStatus: 'success' | 'error' | null;
  /** First 500 chars of the most recent failure's message ('' after a success). */
  lastError: string | null;
  runCount: number;
  failCount: number;
  /** Ticks skipped by the overlap guard or a held per-run lease. */
  skipCount: number;
}

export const writeRunStats = async (
  jobName: string,
  input: { lastRunAt: number; durationMs: number; error: Error | null },
): Promise<void> => {
  await tryCatch(async () => {
    const key = statsKey(jobName);
    await redis.hset(key, {
      lastRunAt: String(input.lastRunAt),
      lastDurationMs: String(input.durationMs),
      lastStatus: input.error ? 'error' : 'success',
      lastError: input.error ? input.error.message.slice(0, 500) : '',
    });
    await redis.hincrby(key, 'runCount', 1);
    if (input.error) await redis.hincrby(key, 'failCount', 1);
  });
};

export const incrementSkipStat = async (jobName: string): Promise<void> => {
  await tryCatch(async () => {
    await redis.hincrby(statsKey(jobName), 'skipCount', 1);
  });
};

/**
 * Read a job's run stats from Redis. Returns `null` when the job has never
 * run (or Redis is unreachable) — callers can't distinguish those two, which
 * is fine for an observability surface.
 */
export const getCronJobStats = async (jobName: string): Promise<CronJobStats | null> => {
  const [, hash] = await tryCatch(async () => redis.hgetall(statsKey(jobName)));
  if (!hash || Object.keys(hash).length === 0) return null;
  const { lastError = '' } = hash;
  return {
    lastRunAt: hash.lastRunAt ? Number(hash.lastRunAt) : null,
    lastDurationMs: hash.lastDurationMs ? Number(hash.lastDurationMs) : null,
    lastStatus: hash.lastStatus === 'success' || hash.lastStatus === 'error' ? hash.lastStatus : null,
    lastError: lastError === '' ? null : lastError,
    runCount: Number(hash.runCount ?? 0),
    failCount: Number(hash.failCount ?? 0),
    skipCount: Number(hash.skipCount ?? 0),
  };
};
