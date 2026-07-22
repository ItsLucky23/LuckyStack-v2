import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { RunContractSummary } from './types';
import type { RunCustomTestsSummary } from './customTests';

//? Characterization tests for the `runAllTests` orchestrator. They pin the
//? behavior the TR-16 decomposition must preserve byte-for-byte: layer ORDER
//? (contract → auth → rate-limit → fuzz → custom), the per-layer disable-flag
//? gating, the auth-Cookie header building (sweep layers get it, the auth layer
//? deliberately does not), the rate-limit clear BEFORE the custom layer, and
//? the totals arithmetic (sum of each present layer's passed/failed, absent
//? layers contribute 0). Every dependency is mocked so no server is needed.

const order: string[] = [];

const summaryOf = (passed: number, failed: number): RunContractSummary => ({
  total: passed + failed,
  passed,
  failed,
  skipped: 0,
  results: [],
});

const customSummaryOf = (passed: number, failed: number): RunCustomTestsSummary => ({
  total: passed + failed,
  passed,
  failed,
  xfailed: 0,
  xpassed: 0,
  results: [],
});

const runContractTests = vi.fn((_input: unknown): Promise<RunContractSummary> => { order.push('contract'); return Promise.resolve(summaryOf(2, 0)); });
const runAuthEnforcementTests = vi.fn((_input: unknown): Promise<RunContractSummary> => { order.push('auth'); return Promise.resolve(summaryOf(3, 1)); });
const runRateLimitTests = vi.fn((_input: unknown): Promise<RunContractSummary> => { order.push('rateLimit'); return Promise.resolve(summaryOf(4, 0)); });
const runCsrfEnforcementTests = vi.fn((_input: unknown): Promise<RunContractSummary> => { order.push('csrf'); return Promise.resolve(summaryOf(7, 1)); });
const runFuzzTests = vi.fn((_input: unknown): Promise<RunContractSummary> => { order.push('fuzz'); return Promise.resolve(summaryOf(5, 2)); });
const runCustomTests = vi.fn((_input: unknown): Promise<RunCustomTestsSummary> => { order.push('custom'); return Promise.resolve(customSummaryOf(6, 3)); });
const clearAllRateLimits = vi.fn((): Promise<void> => { order.push('clear'); return Promise.resolve(); });
const getProjectConfig = vi.fn(() => ({ http: { sessionCookieName: 'cfg_cookie' } }));
const resetServerState = vi.fn((_input: unknown): Promise<boolean> => { order.push('reset'); return Promise.resolve(true); });
const resolveTestEnvironment = vi.fn((_input: unknown): Promise<void> => Promise.resolve());

vi.mock('./resetServerState', () => ({ resetServerState: (i: unknown) => resetServerState(i) }));
vi.mock('./resolveTestEnvironment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./resolveTestEnvironment')>();
  return {
    ...actual,
    resolveTestEnvironment: (input: unknown) => resolveTestEnvironment(input),
  };
});
vi.mock('./runContractTests', () => ({ runContractTests: (i: unknown) => runContractTests(i) }));
vi.mock('./runAuthEnforcementTests', () => ({ runAuthEnforcementTests: (i: unknown) => runAuthEnforcementTests(i) }));
vi.mock('./runRateLimitTests', () => ({ runRateLimitTests: (i: unknown) => runRateLimitTests(i) }));
vi.mock('./runCsrfEnforcementTests', () => ({ runCsrfEnforcementTests: (i: unknown) => runCsrfEnforcementTests(i) }));
vi.mock('./runFuzzTests', () => ({ runFuzzTests: (i: unknown) => runFuzzTests(i) }));
vi.mock('./customTests', () => ({
  runCustomTestsAfterEnvironmentPrepared: (i: unknown) => runCustomTests(i),
}));
vi.mock('@luckystack/core', () => ({
  clearAllRateLimits: () => clearAllRateLimits(),
  getProjectConfig: () => getProjectConfig(),
}));

// Imported after the mocks are registered.
const { runAllTests } = await import('./runAllTests');

const baseInput = {
  apiMethodMap: {},
  apiMetaMap: {},
  apiInputSchemas: {},
  baseUrl: 'http://localhost:3000',
  loadProjectConfig: vi.fn(() => ({ secretManager: { url: '' } })),
};

const originalResetToken = process.env.TEST_RESET_TOKEN;

beforeEach(() => {
  order.length = 0;
  vi.clearAllMocks();
  //? The reset bookends are gated on a token; clear it so the existing
  //? characterization tests see no bookend resets (the bookend tests set it).
  delete process.env.TEST_RESET_TOKEN;
});

afterEach(() => {
  if (originalResetToken === undefined) delete process.env.TEST_RESET_TOKEN;
  else process.env.TEST_RESET_TOKEN = originalResetToken;
});

describe('runAllTests orchestration (characterization)', () => {
  it('fails closed when a JavaScript caller omits the required config loader', async () => {
    const withoutLoader = { ...baseInput };
    Reflect.deleteProperty(withoutLoader, 'loadProjectConfig');

    await expect(Reflect.apply(runAllTests, undefined, [withoutLoader])).rejects.toThrow(
      'runAllTests requires a lazy loadProjectConfig callback',
    );
    expect(resolveTestEnvironment).not.toHaveBeenCalled();
  });

  it('prepares the test-process env before running any layer', async () => {
    const loadProjectConfig = vi.fn(() => ({ secretManager: { url: '' } }));

    await runAllTests({ ...baseInput, loadProjectConfig });

    expect(resolveTestEnvironment).toHaveBeenCalledTimes(1);
    expect(resolveTestEnvironment).toHaveBeenCalledWith({ loadProjectConfig });
    expect(resolveTestEnvironment.mock.invocationCallOrder[0]).toBeLessThan(
      runContractTests.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('runs every layer in order: contract → auth → rate-limit → fuzz → clear → custom', async () => {
    await runAllTests({ ...baseInput });
    expect(order).toStrictEqual(['contract', 'auth', 'rateLimit', 'fuzz', 'clear', 'custom']);
  });

  it('sums per-layer passed/failed into the totals', async () => {
    const summary = await runAllTests({ ...baseInput });
    //? passed: 2 + 3 + 4 + 5 + 6 = 20 · failed: 0 + 1 + 0 + 2 + 3 = 6
    expect(summary.totalPassed).toBe(20);
    expect(summary.totalFailed).toBe(6);
    expect(summary.contract).toStrictEqual(summaryOf(2, 0));
    expect(summary.auth).toStrictEqual(summaryOf(3, 1));
    expect(summary.rateLimit).toStrictEqual(summaryOf(4, 0));
    expect(summary.fuzz).toStrictEqual(summaryOf(5, 2));
    expect(summary.custom).toStrictEqual(customSummaryOf(6, 3));
  });

  it('noSweep skips the four sweep layers but still runs custom', async () => {
    const summary = await runAllTests({ ...baseInput, noSweep: true });
    expect(order).toStrictEqual(['clear', 'custom']);
    expect(summary.contract).toBeUndefined();
    expect(summary.auth).toBeUndefined();
    expect(summary.rateLimit).toBeUndefined();
    expect(summary.fuzz).toBeUndefined();
    //? Absent sweep layers contribute 0; only custom counts.
    expect(summary.totalPassed).toBe(6);
    expect(summary.totalFailed).toBe(3);
  });

  it('noRateLimit / noFuzz gate only their own layers, auth still runs', async () => {
    await runAllTests({ ...baseInput, noRateLimit: true, noFuzz: true });
    expect(order).toStrictEqual(['contract', 'auth', 'clear', 'custom']);
  });

  it('noCustom skips the custom layer and its rate-limit clear', async () => {
    const summary = await runAllTests({ ...baseInput, noCustom: true });
    expect(order).toStrictEqual(['contract', 'auth', 'rateLimit', 'fuzz']);
    expect(clearAllRateLimits).not.toHaveBeenCalled();
    expect(summary.custom).toBeUndefined();
  });

  it('builds no Cookie header without an authToken; the auth layer never receives one', async () => {
    await runAllTests({ ...baseInput });
    expect(runContractTests.mock.calls[0]?.[0]).toMatchObject({ headers: {} });
    //? The auth-enforcement layer is called WITHOUT a `headers` field by design.
    expect(runAuthEnforcementTests.mock.calls[0]?.[0]).not.toHaveProperty('headers');
    expect(getProjectConfig).not.toHaveBeenCalled();
  });

  it('builds a Cookie header from sessionCookieName when an authToken is given', async () => {
    await runAllTests({ ...baseInput, authToken: 'tok123', sessionCookieName: 'my_cookie' });
    expect(runContractTests.mock.calls[0]?.[0]).toMatchObject({ headers: { Cookie: 'my_cookie=tok123' } });
    expect(runRateLimitTests.mock.calls[0]?.[0]).toMatchObject({ headers: { Cookie: 'my_cookie=tok123' } });
    expect(runFuzzTests.mock.calls[0]?.[0]).toMatchObject({ headers: { Cookie: 'my_cookie=tok123' } });
    //? sessionCookieName supplied → config fallback is NOT consulted.
    expect(getProjectConfig).not.toHaveBeenCalled();
  });

  it('falls back to the project config cookie name when authToken is set but sessionCookieName is not', async () => {
    await runAllTests({ ...baseInput, authToken: 'tok123' });
    expect(getProjectConfig).toHaveBeenCalledTimes(1);
    expect(runContractTests.mock.calls[0]?.[0]).toMatchObject({ headers: { Cookie: 'cfg_cookie=tok123' } });
  });

  it('skips the CSRF layer when no authToken is supplied (no session to probe past the auth guard)', async () => {
    const summary = await runAllTests({ ...baseInput });
    expect(order).not.toContain('csrf');
    expect(runCsrfEnforcementTests).not.toHaveBeenCalled();
    expect(summary.csrf).toBeUndefined();
  });

  it('runs the CSRF layer after rate-limit and before fuzz when an authToken is supplied', async () => {
    const summary = await runAllTests({ ...baseInput, authToken: 'tok123', sessionCookieName: 'my_cookie' });
    expect(order).toStrictEqual(['contract', 'auth', 'rateLimit', 'csrf', 'fuzz', 'clear', 'custom']);
    expect(summary.csrf).toStrictEqual(summaryOf(7, 1));
    //? The CSRF layer carries the same session Cookie the sweep layers got.
    expect(runCsrfEnforcementTests.mock.calls[0]?.[0]).toMatchObject({ authCookie: 'my_cookie=tok123' });
    //? csrf passed/failed flow into the totals (contract 2 + auth 3 + rl 4 + csrf 7 + fuzz 5 + custom 6 = 27 passed).
    expect(summary.totalPassed).toBe(27);
    //? failed: auth 1 + fuzz 2 + csrf 1 + custom 3 = 7
    expect(summary.totalFailed).toBe(7);
  });

  it('noCsrf disables the CSRF layer even when an authToken is supplied', async () => {
    const summary = await runAllTests({ ...baseInput, authToken: 'tok123', noCsrf: true });
    expect(order).not.toContain('csrf');
    expect(runCsrfEnforcementTests).not.toHaveBeenCalled();
    expect(summary.csrf).toBeUndefined();
  });

  it('does not crash when clearAllRateLimits throws, still runs custom', async () => {
    clearAllRateLimits.mockRejectedValueOnce(new Error('no clear()'));
    const summary = await runAllTests({ ...baseInput });
    expect(order).toContain('custom');
    expect(summary.custom).toStrictEqual(customSummaryOf(6, 3));
  });
});

describe('runAllTests reset bookends (mutation safety, finding #98)', () => {
  it('skips both bookend resets when no reset token is available', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* swallow expected warning */ });
    await runAllTests({ ...baseInput });
    expect(resetServerState).not.toHaveBeenCalled();
    expect(order).not.toContain('reset');
    //? Skipping is logged, not failed — the sweep still runs every layer.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('resets once before the first sweep layer and once after the last when a token is supplied', async () => {
    await runAllTests({ ...baseInput, resetToken: 'reset-secret' });
    //? Bookends wrap the whole sweep: reset → (contract … fuzz) → reset → clear → custom.
    expect(order).toStrictEqual(['reset', 'contract', 'auth', 'rateLimit', 'fuzz', 'reset', 'clear', 'custom']);
    expect(resetServerState).toHaveBeenCalledTimes(2);
    expect(resetServerState.mock.calls[0]?.[0]).toMatchObject({ baseUrl: baseInput.baseUrl, token: 'reset-secret' });
  });

  it('picks up the reset token from TEST_RESET_TOKEN when not passed explicitly', async () => {
    process.env.TEST_RESET_TOKEN = 'env-secret';
    await runAllTests({ ...baseInput });
    expect(resetServerState).toHaveBeenCalledTimes(2);
    expect(resetServerState.mock.calls[0]?.[0]).toMatchObject({ token: 'env-secret' });
  });

  it('resetBookends:false opts out even when a token is available', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* swallow expected warning */ });
    await runAllTests({ ...baseInput, resetToken: 'reset-secret', resetBookends: false });
    expect(resetServerState).not.toHaveBeenCalled();
    expect(order).not.toContain('reset');
    //? Opt-out is a deliberate choice, not a missing-token degrade — no warning.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not run bookends when the whole sweep is disabled (noSweep)', async () => {
    await runAllTests({ ...baseInput, resetToken: 'reset-secret', noSweep: true });
    expect(resetServerState).not.toHaveBeenCalled();
  });
});
