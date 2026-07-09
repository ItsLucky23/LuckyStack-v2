//? Schedule normalization + next-occurrence computation. Cron expressions are
//? parsed by `croner` (zero-dependency, DST/timezone-correct via Intl) — we
//? deliberately do NOT hand-roll a cron parser: day-of-month/day-of-week OR
//? semantics and DST transitions are exactly where home-grown parsers break.
//? Croner is used ONLY as a next-occurrence calculator here; the timer/lease
//? runtime lives in scheduler.ts.

import { Cron } from 'croner';

export type CronScheduleInput = string | { everyMs: number };

/** Below this an interval would out-race the scheduler tick and hot-loop. */
const MIN_INTERVAL_MS = 1000;

export type NormalizedSchedule =
  | { kind: 'interval'; everyMs: number; source: CronScheduleInput }
  | { kind: 'cron'; cron: Cron; source: CronScheduleInput };

/**
 * Validate + normalize a schedule input. Throws on an invalid cron expression
 * (croner's constructor validates) or an interval under 1000ms, so bad input
 * surfaces at `registerCronJob` time instead of silently never firing.
 */
export const normalizeSchedule = (
  schedule: CronScheduleInput,
  timezone: string,
): NormalizedSchedule => {
  if (typeof schedule === 'string') {
    //? Constructing without a callback never starts a timer — pattern-only use.
    const cron = new Cron(schedule, { timezone });
    return { kind: 'cron', cron, source: schedule };
  }
  if (!Number.isFinite(schedule.everyMs) || schedule.everyMs < MIN_INTERVAL_MS) {
    throw new Error(
      `[cron] invalid interval schedule — expected { everyMs: number >= ${MIN_INTERVAL_MS} }, got ${JSON.stringify(schedule)}`,
    );
  }
  return { kind: 'interval', everyMs: schedule.everyMs, source: schedule };
};

/**
 * Compute the next fire time (ms epoch) strictly after `fromMs`, plus a random
 * 0..jitterMs offset. Returns `null` when a cron expression has no future
 * occurrence (e.g. a fixed date in the past) — the job then never fires.
 */
export const computeNextRun = (
  normalized: NormalizedSchedule,
  fromMs: number,
  jitterMs = 0,
): number | null => {
  const base =
    normalized.kind === 'interval'
      ? fromMs + normalized.everyMs
      : (normalized.cron.nextRun(new Date(fromMs))?.getTime() ?? null);
  if (base === null) return null;
  const jitter = jitterMs > 0 ? Math.floor(Math.random() * (jitterMs + 1)) : 0;
  return base + jitter;
};
