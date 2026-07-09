import type { CronScheduleInput } from './schedule';

export interface CronJobContext<TTenant = unknown> {
  jobName: string;
  /** The tick this run was scheduled for (ms epoch, includes jitter). */
  scheduledFor: number;
  /**
   * Set only for `perTenant` jobs — the tenant currently being processed.
   * Wrap your own `runInTenant`-style helper around it inside the handler.
   */
  tenant?: TTenant;
}

export type CronJobHandler<TTenant = unknown> = (
  ctx: CronJobContext<TTenant>,
) => Promise<void> | void;

export interface CronJobDefinition<TTenant = unknown> {
  /**
   * Unique job name. Also the suffix of the job's Redis bookkeeping key and
   * per-run lease, so it must be Redis-key-safe: `A-Za-z0-9 _ . -` (no `:`).
   * Re-registering an existing name replaces the previous definition
   * (hot-reload friendly).
   */
  name: string;
  /**
   * A 5/6-field cron expression (croner syntax, DST-correct) or a plain
   * interval `{ everyMs }` (min 1000ms). Intervals anchor on "previous fire +
   * everyMs" — they drift with long-running handlers by design.
   */
  schedule: CronScheduleInput;
  handler: CronJobHandler<TTenant>;
  /** IANA timezone for cron expressions. Default: `cronConfig.timezone`. */
  timezone?: string;
  /**
   * Random 0..jitterMs added to every computed fire time — smooths thundering
   * herds when many projects share infrastructure. Default 0.
   */
  jitterMs?: number;
  /**
   * Fire once as soon as this instance holds (or gains) leadership, then
   * follow the schedule. Fires at most once per process. Default false.
   */
  runOnStart?: boolean;
  /**
   * Fan the handler out over tenants: `tenants()` is resolved per run and the
   * handler is invoked once per entry with `ctx.tenant` set. Failures are
   * isolated per tenant (each is logged + captured; the run's `error` is the
   * first failure).
   */
  perTenant?: {
    tenants: () => Promise<readonly TTenant[]> | readonly TTenant[];
    /** Max concurrent tenant invocations. Default 1 (sequential). */
    concurrency?: number;
  };
  /** Per-run lease TTL override (see `cronConfig.runLeaseTtlMs`). */
  runLeaseTtlMs?: number;
}
