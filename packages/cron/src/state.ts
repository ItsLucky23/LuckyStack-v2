//? Shared mutable scheduler state, isolated in its own module so registry.ts
//? and scheduler.ts can both import it without a circular edge.

import type { NormalizedSchedule } from './schedule';
import type { CronJobDefinition } from './types';

export interface JobRuntime {
  def: CronJobDefinition;
  normalized: NormalizedSchedule;
  /** Next fire time (ms epoch, jittered). `null` = schedule exhausted. */
  nextRunAt: number | null;
  /** In-process overlap guard — true while this job's handler is executing here. */
  running: boolean;
  /** `runOnStart` fires at most once per process. */
  ranOnStart: boolean;
}

export const jobRuntimes = new Map<string, JobRuntime>();
