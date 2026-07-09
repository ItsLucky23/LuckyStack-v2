import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeNextRun, normalizeSchedule } from './schedule';

const T0 = Date.UTC(2026, 0, 15, 0, 0, 0); // 2026-01-15T00:00:00Z

describe('normalizeSchedule', () => {
  it('accepts a cron expression', () => {
    const normalized = normalizeSchedule('*/5 * * * *', 'UTC');
    expect(normalized.kind).toBe('cron');
  });

  it('accepts an interval of at least 1000ms', () => {
    const normalized = normalizeSchedule({ everyMs: 5000 }, 'UTC');
    expect(normalized).toMatchObject({ kind: 'interval', everyMs: 5000 });
  });

  it('throws on an invalid cron expression', () => {
    expect(() => normalizeSchedule('not a cron', 'UTC')).toThrow();
  });

  it('throws on an interval under 1000ms', () => {
    expect(() => normalizeSchedule({ everyMs: 500 }, 'UTC')).toThrow(/invalid interval/);
  });

  it('throws on a missing/garbage interval', () => {
    expect(() => normalizeSchedule({} as { everyMs: number }, 'UTC')).toThrow(/invalid interval/);
    expect(() => normalizeSchedule({ everyMs: Number.NaN }, 'UTC')).toThrow(/invalid interval/);
  });
});

describe('computeNextRun', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('computes the next cron occurrence strictly after `from`', () => {
    const normalized = normalizeSchedule('*/5 * * * *', 'UTC');
    expect(computeNextRun(normalized, T0)).toBe(T0 + 5 * 60_000);
  });

  it('honors the timezone option (12:00 Amsterdam = 11:00 UTC in winter)', () => {
    const normalized = normalizeSchedule('0 12 * * *', 'Europe/Amsterdam');
    expect(computeNextRun(normalized, T0)).toBe(Date.UTC(2026, 0, 15, 11, 0, 0));
  });

  it('computes interval schedules as from + everyMs', () => {
    const normalized = normalizeSchedule({ everyMs: 5000 }, 'UTC');
    expect(computeNextRun(normalized, 10_000)).toBe(15_000);
  });

  it('adds bounded jitter', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const normalized = normalizeSchedule({ everyMs: 5000 }, 'UTC');
    expect(computeNextRun(normalized, 10_000, 1000)).toBe(15_000 + Math.floor(0.5 * 1001));
  });

  it('adds no jitter when jitterMs is 0/omitted', () => {
    const randomSpy = vi.spyOn(Math, 'random');
    const normalized = normalizeSchedule({ everyMs: 5000 }, 'UTC');
    expect(computeNextRun(normalized, 10_000, 0)).toBe(15_000);
    expect(randomSpy).not.toHaveBeenCalled();
  });
});
