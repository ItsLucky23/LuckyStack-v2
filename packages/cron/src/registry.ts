//? Declarative job registry. `registerCronJob` validates eagerly (bad cron
//? expressions surface at boot, not silently-never-firing) and lazily starts
//? the scheduler loop on the first registration — a project with zero jobs
//? pays zero timers and never competes for the leader lease.

import { getLogger } from '@luckystack/core';
import { getCronConfig } from './cronConfig';
import { computeNextRun, normalizeSchedule } from './schedule';
import { ensureCronSchedulerStarted } from './scheduler';
import { jobRuntimes } from './state';
import type { CronJobDefinition } from './types';

//? Redis-key-safe (the name suffixes the stats key + per-run lease); `:` is
//? excluded because the framework uses it as the namespace separator.
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/**
 * Register (or replace) a recurring job. Returns an unregister function.
 * Throws synchronously on an invalid name, handler, or schedule.
 */
export const registerCronJob = <TTenant = unknown>(
  def: CronJobDefinition<TTenant>,
): (() => void) => {
  if (typeof def.name !== 'string' || !NAME_PATTERN.test(def.name)) {
    throw new Error(
      `[cron] invalid job name ${JSON.stringify(def.name)} — expected /${NAME_PATTERN.source}/ (Redis-key-safe, no ':')`,
    );
  }
  if (typeof def.handler !== 'function') {
    throw new TypeError(`[cron] job "${def.name}" has no handler function`);
  }
  const timezone = def.timezone ?? getCronConfig().timezone;
  const normalized = normalizeSchedule(def.schedule, timezone);

  if (jobRuntimes.has(def.name)) {
    getLogger().debug(`[cron] job "${def.name}" re-registered — replacing previous definition`);
  }
  const now = Date.now();
  jobRuntimes.set(def.name, {
    def: def as CronJobDefinition,
    normalized,
    //? Jobs normally register before the first leader tick, which recomputes
    //? every schedule. Hot-reload/plugin registrations can happen AFTER this
    //? process already owns leadership; in that case onLeadershipGained() will
    //? not run again. Arm runOnStart here as well so "on start" means the
    //? registration's first leader-owned tick, not only process boot.
    nextRunAt: def.runOnStart
      ? now
      : computeNextRun(normalized, now, def.jitterMs ?? 0),
    running: false,
    ranOnStart: false,
  });
  ensureCronSchedulerStarted();
  return () => {
    unregisterCronJob(def.name);
  };
};

export const unregisterCronJob = (name: string): boolean => jobRuntimes.delete(name);

export const getCronJobNames = (): string[] => [...jobRuntimes.keys()];

export const clearCronJobsForTests = (): void => {
  jobRuntimes.clear();
};
