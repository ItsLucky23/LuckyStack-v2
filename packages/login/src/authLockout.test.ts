import { describe, it, expect, vi, beforeEach } from 'vitest';

//? `authLockout` reads `getProjectConfig().rateLimiting.auth` at call time and
//? drives the framework rate limiter (`checkRateLimit` / `getRateLimitStatus` /
//? `clearRateLimit`). Mock @luckystack/core so the feature flag + the limiter
//? calls are fully test-controlled and no real config/Redis is touched.
interface AuthCfg { enabled: boolean; maxAttempts: number; maxAttemptsPerAccount: number; windowMs: number }

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
  //? DD-LOGIN-F5: optional IP for composite lockout key
  requesterIp?: string;
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
  //? `clearAuthFailures` now wraps its `clearRateLimit` calls in `tryCatch` (L6)
  //? so a fire-and-forget `void` call can't leak an unhandled rejection. Mirror
  //? the real [error, result] tuple contract so the callback actually runs.
  tryCatch: async (fn: () => Promise<unknown>) => {
    try { return [null, await fn()]; } catch (error) { return [error, null]; }
  },
  getLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  registerHook: (name: string, handler: (p: LoginFailedPayload) => Promise<void>) => {
    registerHookMock(name, handler);
  },
}));

import { isAccountLocked, recordAuthFailure, clearAuthFailures, registerAuthLockoutHook } from './authLockout';

const setAuth = (auth: Partial<AuthCfg> & { enabled: boolean }): void => {
  getProjectConfigMock.mockReturnValue({
    rateLimiting: { auth: { maxAttempts: 5, maxAttemptsPerAccount: 50, windowMs: 900_000, ...auth } },
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

  it('reports locked when the cross-IP per-account budget is exhausted (non-incrementing)', async () => {
    setAuth({ enabled: true, maxAttempts: 5, maxAttemptsPerAccount: 50 });
    getRateLimitStatusMock.mockResolvedValue({ allowed: false, remaining: 0, resetIn: 60 });
    expect(await isAccountLocked('a@x.com')).toBe(true);
    //? No IP → only the bare-account bucket is checked, against the cross-IP cap.
    expect(getRateLimitStatusMock).toHaveBeenCalledWith('auth:a@x.com', 50);
    //? checking the lock must NOT increment the counter
    expect(checkRateLimitMock).not.toHaveBeenCalled();
  });

  it('reports unlocked while attempts remain', async () => {
    setAuth({ enabled: true, maxAttempts: 5 });
    getRateLimitStatusMock.mockResolvedValue({ allowed: true, remaining: 3, resetIn: 0 });
    expect(await isAccountLocked('a@x.com')).toBe(false);
  });

  it('records a failure by incrementing the bare-account counter, lower-cased + trimmed key', async () => {
    setAuth({ enabled: true, maxAttempts: 5, maxAttemptsPerAccount: 50, windowMs: 900_000 });
    checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 4, resetIn: 0 });
    await recordAuthFailure('  Alice@X.com ');
    //? No IP → only the bare-account bucket increments, against the cross-IP cap.
    expect(checkRateLimitMock).toHaveBeenCalledWith({
      key: 'auth:alice@x.com',
      limit: 50,
      windowMs: 900_000,
    });
  });

  //? DD-LOGIN-F5: composite key includes IP when provided so one IP cannot lock
  //? out the account for users on different IPs.
  it('uses IP+account composite key when requesterIp is provided', async () => {
    setAuth({ enabled: true, maxAttempts: 5, windowMs: 900_000 });
    checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 4, resetIn: 0 });
    await recordAuthFailure('alice@x.com', '1.2.3.4');
    expect(checkRateLimitMock).toHaveBeenCalledWith({
      key: 'auth:alice@x.com:1.2.3.4',
      limit: 5,
      windowMs: 900_000,
    });
  });

  it('isAccountLocked checks the per-IP composite key when requesterIp is provided', async () => {
    setAuth({ enabled: true, maxAttempts: 5, maxAttemptsPerAccount: 50 });
    //? Bare-account bucket still has budget; the per-IP composite is exhausted —
    //? so the lock decision must come from the composite key.
    getRateLimitStatusMock.mockImplementation((key: string) =>
      Promise.resolve(
        key === 'auth:a@x.com:10.0.0.1'
          ? { allowed: false, remaining: 0, resetIn: 60 }
          : { allowed: true, remaining: 3, resetIn: 0 },
      ),
    );
    expect(await isAccountLocked('a@x.com', '10.0.0.1')).toBe(true);
    expect(getRateLimitStatusMock).toHaveBeenCalledWith('auth:a@x.com:10.0.0.1', 5);
  });

  it('isAccountLocked locks across IPs when the cross-IP per-account cap is hit', async () => {
    setAuth({ enabled: true, maxAttempts: 5, maxAttemptsPerAccount: 50 });
    //? Bare-account (cross-IP) bucket exhausted → locked regardless of this IP's
    //? own composite budget — the distributed-credential-stuffing defense.
    getRateLimitStatusMock.mockImplementation((key: string) =>
      Promise.resolve(
        key === 'auth:a@x.com'
          ? { allowed: false, remaining: 0, resetIn: 60 }
          : { allowed: true, remaining: 5, resetIn: 0 },
      ),
    );
    expect(await isAccountLocked('a@x.com', '9.9.9.9')).toBe(true);
    expect(getRateLimitStatusMock).toHaveBeenCalledWith('auth:a@x.com', 50);
  });

  it('clears the counter on success', async () => {
    setAuth({ enabled: true });
    await clearAuthFailures('Alice@x.com');
    expect(clearRateLimitMock).toHaveBeenCalledWith('auth:alice@x.com');
  });

  it('clears the composite key on success when requesterIp is provided', async () => {
    setAuth({ enabled: true });
    await clearAuthFailures('Alice@x.com', '1.2.3.4');
    expect(clearRateLimitMock).toHaveBeenCalledWith('auth:alice@x.com:1.2.3.4');
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

  it('counts a genuine wrong-password attempt (bare account key when no IP)', async () => {
    await fire({ reason: 'login.wrongPassword' });
    //? No IP → only the bare-account (cross-IP) bucket increments, against the cross-IP cap.
    expect(checkRateLimitMock).toHaveBeenCalledWith({ key: 'auth:victim@x.com', limit: 50, windowMs: 900_000 });
  });

  //? DD-LOGIN-F5: composite key used when `requesterIp` is present in the payload.
  it('counts a genuine wrong-password attempt using composite key when requesterIp is provided', async () => {
    checkRateLimitMock.mockClear();
    await fire({ reason: 'login.wrongPassword', requesterIp: '5.6.7.8' });
    expect(checkRateLimitMock).toHaveBeenCalledWith({ key: 'auth:victim@x.com:5.6.7.8', limit: 5, windowMs: 900_000 });
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
