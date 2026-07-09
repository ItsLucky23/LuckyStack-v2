//? Configurable knobs for the cron scheduler. Defaults suit a typical
//? single-Redis deployment; multi-instance installs mainly tune the lease
//? timings (renew well below TTL — see core's lease.ts contract).
//?
//? Read at call-time so projects can `registerCronConfig(...)` after import
//? (e.g. from a `luckystack/cron/*.ts` overlay file). Same lazy pattern as
//? `getProjectConfig()` in core.

import { deepMerge, type DeepPartial } from '@luckystack/core';

export interface CronConfig {
  /**
   * Master switch. When `false` the scheduler never competes for leadership
   * and no job fires — `registerCronJob` still records definitions, so the
   * flag can be flipped per environment without touching job files. Read at
   * every leader/tick pass, so it can be set before OR after jobs register.
   */
  enabled: boolean;
  /**
   * Default IANA timezone for cron-expression schedules (per-job `timezone`
   * overrides). Interval schedules (`{ everyMs }`) ignore timezones.
   */
  timezone: string;
  /**
   * Name of the scheduler's leader lease (namespaced by core's `formatKey`
   * to `<project>:lease:<leaseName>`). Override only when two independent
   * scheduler pools must coexist on one Redis.
   */
  leaseName: string;
  /**
   * Leader lease TTL. A leader that stalls past this window loses ownership
   * to another instance (single-Redis best-effort — jobs must tolerate a
   * rare double-fire; see core lease.ts).
   */
  leaseTtlMs: number;
  /**
   * How often the leader renews (and non-leaders try to acquire) the lease.
   * Keep well below `leaseTtlMs`.
   */
  renewIntervalMs: number;
  /** How often the leader checks for due jobs. */
  tickIntervalMs: number;
  /**
   * Default per-run lease TTL (per-job `runLeaseTtlMs` overrides). The run
   * lease is renewed while the handler executes, so it also caps how long a
   * crashed leader blocks the next run of the same job.
   */
  runLeaseTtlMs: number;
}

export const DEFAULT_CRON_CONFIG: CronConfig = {
  enabled: true,
  timezone: 'UTC',
  leaseName: 'cron-scheduler',
  leaseTtlMs: 30_000,
  renewIntervalMs: 10_000,
  tickIntervalMs: 1000,
  runLeaseTtlMs: 60_000,
};

export type CronConfigInput = DeepPartial<CronConfig>;

let activeConfig: CronConfig = DEFAULT_CRON_CONFIG;

export const registerCronConfig = (config: CronConfigInput): void => {
  activeConfig = deepMerge(DEFAULT_CRON_CONFIG, config);
};

export const getCronConfig = (): CronConfig => activeConfig;

export const resetCronConfigForTests = (): void => {
  activeConfig = DEFAULT_CRON_CONFIG;
};
