import { describe, it, expect, vi, beforeEach } from 'vitest';

//? `authLockout` reads `getProjectConfig().rateLimiting.auth` at call time and
//? drives the framework rate limiter (`checkRateLimit` / `getRateLimitStatus` /
//? `clearRateLimit`). Mock @luckystack/core so the feature flag + the limiter
//? calls are fully test-controlled and no real config/Redis is touched.
interface AuthCfg { enabled: boolean; maxAttempts: number; windowMs: number }

interface RateResult { allowed: boolean; remaining: number; resetIn: number }

const getProjectConfigMock = vi.fn<() => { rateLimiting: { auth: AuthCfg } }>();
const checkRateLimitMock = vi.fn<(params: unknown) => Promise<RateResult>>();
const getRateLimitStatusMock = vi.fn<(key: string, limit: number) => Promise<RateResult>>();
const clearRateLimitMock = vi.fn<(key: string) => Promise<void>>();

//? Capture the handler that `registerAuthLockoutHook` registers for `loginFailed`
//? so the lockout-counting decision (COUNTING_REASONS allow-list) can be exercised
//? directly without a real hook bus.
interface LoginFailedPayload {
  email?: string;
  provider: string;
  reason: string;
  stage: 'login' | 'register' | 'oauth';
}
let registeredLoginFailedHandler: ((p: LoginFailedPayload) => Promise<void>) | null = null;
const registerHookMock = vi.fn((name: string, handler: (p: LoginFailedPayload) => Promise<void>) => {
  if (name === 'loginFailed') registeredLoginFailedHandler = handler;
});

vi.mock('@luckystack/core', () => ({
  getProjectConfig: () => getProjectConfigMock(),
  checkRateLimit: (params: unknown) => checkRateLimitMock(params),
  getRateLimitStatus: (key: string, limit: number) => getRateLimitStatusMock(key, limit),
  clearRateLimit: (key: string) => clearRateLimitMock(key),
  getLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  registerHook: (name: string, handler: (p: LoginFailedPayload) => Promise<void>) => {
    registerHookMock(name, handler);
  },
}));

import { isAccountLocked, recordAuthFailure, clearAuthFailures, registerAuthLockoutHook } from './authLockout';

const setAuth = (auth: Partial<AuthCfg> & { enabled: boolean }): void => {
  getProjectConfigMock.mockReturnValue({
    rateLimiting: { auth: { maxAttempts: 5, windowMs: 900_000, ...auth } },
  });
};

describe('authLockout', () => {
  beforeEach(() => {
    getProjectConfigMock.mockReset();
    checkRateLimitMock.mockReset();
    getRateLimitStatusMock.mockReset();
    clearRateLimitMock.mockClear();
  });

  it('is a no-op when rateLimiting.auth.enabled is false (default)', async () => {
    setAuth({ enabled: false });
    expect(await isAccountLocked('a@x.com')).toBe(false);
    await recordAuthFailure('a@x.com');
    await clearAuthFailures('a@x.com');
    expect(checkRateLimitMock).not.toHaveBeenCalled();
    expect(getRateLimitStatusMock).not.toHaveBeenCalled();
    expect(clearRateLimitMock).not.toHaveBeenCalled();
  });

  it('reports locked when the per-account budget is exhausted (non-incrementing)', async () => {
    setAuth({ enabled: true, maxAttempts: 5 });
    getRateLimitStatusMock.mockResolvedValue({ allowed: false, remaining: 0, resetIn: 60 });
    expect(await isAccountLocked('a@x.com')).toBe(true);
    expect(getRateLimitStatusMock).toHaveBeenCalledWith('auth:a@x.com', 5);
    //? checking the lock must NOT increment the counter
    expect(checkRateLimitMock).not.toHaveBeenCalled();
  });

  it('reports unlocked while attempts remain', async () => {
    setAuth({ enabled: true, maxAttempts: 5 });
    getRateLimitStatusMock.mockResolvedValue({ allowed: true, remaining: 3, resetIn: 0 });
    expect(await isAccountLocked('a@x.com')).toBe(false);
  });

  it('records a failure by incrementing the counter, lower-cased + trimmed key', async () => {
    setAuth({ enabled: true, maxAttempts: 5, windowMs: 900_000 });
    checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 4, resetIn: 0 });
    await recordAuthFailure('  Alice@X.com ');
    expect(checkRateLimitMock).toHaveBeenCalledWith({
      key: 'auth:alice@x.com',
      limit: 5,
      windowMs: 900_000,
    });
  });

  it('clears the counter on success', async () => {
    setAuth({ enabled: true });
    await clearAuthFailures('Alice@x.com');
    expect(clearRateLimitMock).toHaveBeenCalledWith('auth:alice@x.com');
  });

  it('ignores empty account keys', async () => {
    setAuth({ enabled: true });
    expect(await isAccountLocked('')).toBe(false);
    await recordAuthFailure('');
    await clearAuthFailures('');
    expect(checkRateLimitMock).not.toHaveBeenCalled();
    expect(clearRateLimitMock).not.toHaveBeenCalled();
  });
});

//? M-15 / ADR 0012: the lockout hook must only count a GENUINE wrong-password
//? attempt (`COUNTING_REASONS` allow-list). Password-POLICY reasons, input-shape
//? reasons, the already-locked self-trip, infra errors, AND consumer `preLogin`
//? veto errorCodes must NOT increment the per-account counter — otherwise an
//? attacker who knows a victim's email could DoS the account by tripping a veto.
describe('registerAuthLockoutHook — COUNTING_REASONS allow-list (M-15 / ADR 0012)', () => {
  beforeEach(() => {
    //? `registerAuthLockoutHook` is idempotent (guarded), so the handler is
    //? captured on the FIRST call and stays registered for the whole file. Don't
    //? null `registeredLoginFailedHandler` between tests — just reset the limiter
    //? + config mocks so each scenario starts clean.
    checkRateLimitMock.mockReset();
    getProjectConfigMock.mockReset();
    setAuth({ enabled: true, maxAttempts: 5, windowMs: 900_000 });
    checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 4, resetIn: 0 });
    registerAuthLockoutHook();
  });

  // eslint-disable-next-line unicorn/consistent-function-scoping -- closes over the captured handler + expect; keep it local to this describe
  const fire = async (payload: Partial<LoginFailedPayload>): Promise<void> => {
    expect(registeredLoginFailedHandler).toBeTypeOf('function');
    await registeredLoginFailedHandler?.({
      email: 'victim@x.com',
      provider: 'credentials',
      stage: 'login',
      reason: 'login.wrongPassword',
      ...payload,
    });
  };

  it('counts a genuine wrong-password attempt', async () => {
    await fire({ reason: 'login.wrongPassword' });
    expect(checkRateLimitMock).toHaveBeenCalledWith({ key: 'auth:victim@x.com', limit: 5, windowMs: 900_000 });
  });

  it.each([
    'login.passwordCharacterMinimum',
    'login.passwordCharacterLimit',
    'login.passwordRequiresUppercase',
    'login.passwordRequiresLowercase',
    'login.passwordRequiresNumber',
    'login.passwordRequiresSpecial',
    'login.passwordTooCommon',
  ])('does NOT count a password-policy reason: %s', async (reason) => {
    await fire({ reason });
    expect(checkRateLimitMock).not.toHaveBeenCalled();
  });

  it('does NOT count the already-locked reason (no self-re-trip)', async () => {
    await fire({ reason: 'login.accountLocked' });
    expect(checkRateLimitMock).not.toHaveBeenCalled();
  });

  it('does NOT count register-stage or non-credentials failures', async () => {
    await fire({ stage: 'register', reason: 'login.wrongPassword' });
    await fire({ provider: 'google', stage: 'oauth', reason: 'login.wrongPassword' });
    expect(checkRateLimitMock).not.toHaveBeenCalled();
  });

  //? ADR 0012 core: a `preLogin` veto emits `loginFailed` with the consumer's
  //? own `errorCode` (an arbitrary, attacker-triggerable reason that runs before
  //? any password check). The allow-list must reject it so it can't drive lockout.
  it('does NOT count a consumer preLogin-veto errorCode', async () => {
    await fire({ reason: 'account.pendingVerification' });
    expect(checkRateLimitMock).not.toHaveBeenCalled();
  });

  //? Infra failures (DB find / bcrypt throw, surfaced via toReasonKey) are not a
  //? credential mismatch and must not lock the account on transient outages.
  it('does NOT count an infra/unknown reason', async () => {
    await fire({ reason: 'errors.unknown' });
    expect(checkRateLimitMock).not.toHaveBeenCalled();
  });
});
