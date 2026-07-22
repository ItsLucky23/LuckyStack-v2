import { describe, it, expect, vi, beforeEach } from 'vitest';

const { store, fakeRedis, getProjectConfigMock, checkRateLimitMock, finalizeLoginMock, resolveUserMock, sendCodeEmailMock, challengeGateMock } = vi.hoisted(() => {
  const backing = new Map<string, { value: string; ttl: number }>();
  return {
    store: backing,
    fakeRedis: {
      get: async (key: string) => backing.get(key)?.value ?? null,
      set: async (key: string, value: string, _ex: string, ttl: number) => {
        backing.set(key, { value, ttl });
        return 'OK';
      },
      del: async (key: string) => (backing.delete(key) ? 1 : 0),
      incr: async (key: string) => {
        const next = Number(backing.get(key)?.value ?? '0') + 1;
        backing.set(key, { value: String(next), ttl: backing.get(key)?.ttl ?? -1 });
        return next;
      },
      ttl: async (key: string) => backing.get(key)?.ttl ?? -2,
      expire: async (key: string, ttl: number) => {
        const entry = backing.get(key);
        if (entry) entry.ttl = ttl;
        return entry ? 1 : 0;
      },
      eval: async (script: string, _keyCount: number, codeKey: string, attemptsKey: string, expectedHash: string, limitOrTtl: string) => {
        if (!script.includes("local stored = redis.call('get'")) {
          backing.set(codeKey, { value: expectedHash, ttl: Number(limitOrTtl) });
          backing.delete(attemptsKey);
          return 1;
        }
        const stored = backing.get(codeKey);
        if (!stored) return 0;
        const attempts = Number(backing.get(attemptsKey)?.value ?? '0') + 1;
        backing.set(attemptsKey, { value: String(attempts), ttl: stored.ttl > 0 ? stored.ttl : 600 });
        if (attempts > Number(limitOrTtl)) {
          backing.delete(codeKey);
          backing.delete(attemptsKey);
          return 3;
        }
        if (stored.value !== expectedHash) return 1;
        backing.delete(codeKey);
        backing.delete(attemptsKey);
        return 2;
      },

    },
    getProjectConfigMock: vi.fn(),
    checkRateLimitMock: vi.fn(),
    finalizeLoginMock: vi.fn(),
    resolveUserMock: vi.fn(),
    sendCodeEmailMock: vi.fn(),
    challengeGateMock: vi.fn(),
  };
});

vi.mock('@luckystack/core', () => ({
  redis: fakeRedis,
  formatKey: (namespace: string, suffix: string) => `test${namespace}:${suffix}`,
  getProjectConfig: () => getProjectConfigMock(),
  getProjectName: () => 'testapp',
  getLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  checkRateLimit: (params: unknown) => checkRateLimitMock(params),
  tryCatch: async (fn: () => Promise<unknown>) => {
    try { return [null, await fn()]; } catch (error) { return [error, null]; }
  },
}));

vi.mock('./login', () => ({
  registerTwoFactorGate: vi.fn(),
  finalizeLogin: (...args: unknown[]) => finalizeLoginMock(...args),
}));

vi.mock('./twoFactor', () => ({
  sendCodeEmail: (...args: unknown[]) => sendCodeEmailMock(...args),
  createTwoFactorChallengeIfRequired: (...args: unknown[]) => challengeGateMock(...args),
}));

vi.mock('./accountStrategy', () => ({
  resolveUserByEmail: (...args: unknown[]) => resolveUserMock(...args),
}));

vi.mock('./userAdapter', () => ({
  getUserAdapter: () => ({}),
}));

import { requestEmailLoginCode, verifyEmailLoginCode } from './emailCodeLogin';
import type { UserRecord } from './userAdapter';

const sam = { id: 'u1', email: 'sam@example.com' } as UserRecord;

const setConfig = (overrides: Record<string, unknown> = {}): void => {
  getProjectConfigMock.mockReturnValue({
    auth: {
      emailCodeLogin: true,
      emailCodeTtlSeconds: 600,
      emailCodeLength: 6,
      emailCodeMaxAttempts: 5,
      emailMaxLength: 191,
      ...overrides,
    },
  });
};

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  setConfig();
  checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 2, resetIn: 0 });
  resolveUserMock.mockResolvedValue(sam);
  sendCodeEmailMock.mockResolvedValue(true);
  challengeGateMock.mockResolvedValue(null);
  finalizeLoginMock.mockResolvedValue({ status: true, reason: 'login.loggedIn', newToken: 't', session: {} });
});

//? Pull the raw code out of the mocked send (second positional arg).
const lastSentCode = (): string => String(sendCodeEmailMock.mock.calls.at(-1)?.[1] ?? '');

describe('requestEmailLoginCode', () => {
  it('is a hard no when the feature is off (config default)', async () => {
    setConfig({ emailCodeLogin: false });
    await expect(requestEmailLoginCode({ email: 'sam@example.com' })).resolves.toEqual({ ok: false, reason: 'login.emailCodeDisabled' });
    expect(sendCodeEmailMock).not.toHaveBeenCalled();
  });

  it('issues + emails a code for an existing account', async () => {
    await expect(requestEmailLoginCode({ email: 'Sam@Example.com' })).resolves.toEqual({ ok: true });
    expect(sendCodeEmailMock).toHaveBeenCalledTimes(1);
    expect(lastSentCode()).toMatch(/^\d{6}$/);
    //? normalized recipient
    expect(sendCodeEmailMock.mock.calls[0]?.[0]).toBe('sam@example.com');
  });

  it('anti-enumeration: an unknown address answers ok WITHOUT sending', async () => {
    resolveUserMock.mockResolvedValue(null);
    await expect(requestEmailLoginCode({ email: 'ghost@example.com' })).resolves.toEqual({ ok: true });
    expect(sendCodeEmailMock).not.toHaveBeenCalled();
  });

  it('anti-enumeration: a lookup failure ALSO answers ok', async () => {
    resolveUserMock.mockRejectedValue(new Error('db down'));
    await expect(requestEmailLoginCode({ email: 'sam@example.com' })).resolves.toEqual({ ok: true });
    expect(sendCodeEmailMock).not.toHaveBeenCalled();
  });

  it('request throttling runs BEFORE the user lookup', async () => {
    checkRateLimitMock.mockResolvedValue({ allowed: false, remaining: 0, resetIn: 60 });
    await expect(requestEmailLoginCode({ email: 'sam@example.com', requesterIp: '1.2.3.4' })).resolves.toEqual({ ok: false, reason: 'api.rateLimitExceeded' });
    expect(resolveUserMock).not.toHaveBeenCalled();
  });

  it('rejects oversized/empty input without touching the backend', async () => {
    await expect(requestEmailLoginCode({ email: '   ' })).resolves.toMatchObject({ ok: false });
    expect(checkRateLimitMock).not.toHaveBeenCalled();
  });
});

describe('verifyEmailLoginCode', () => {
  const request = async (): Promise<string> => {
    await requestEmailLoginCode({ email: 'sam@example.com' });
    return lastSentCode();
  };

  it('a valid code completes the login through finalizeLogin', async () => {
    const code = await request();
    const result = await verifyEmailLoginCode({ email: 'sam@example.com', code });
    expect(result.status).toBe(true);
    expect(finalizeLoginMock).toHaveBeenCalledWith(sam, expect.objectContaining({ provider: 'credentials', email: 'sam@example.com' }));
  });

  it('the code is single-use', async () => {
    const code = await request();
    await verifyEmailLoginCode({ email: 'sam@example.com', code });
    const replay = await verifyEmailLoginCode({ email: 'sam@example.com', code });
    expect(replay).toMatchObject({ status: false, reason: 'login.emailCodeExpired' });
  });

  it('maps the verdicts to distinct reasons', async () => {
    await expect(verifyEmailLoginCode({ email: 'sam@example.com', code: '123456' })).resolves.toMatchObject({ reason: 'login.emailCodeExpired' });
    const code = await request();
    await expect(verifyEmailLoginCode({ email: 'sam@example.com', code: '000000' })).resolves.toMatchObject({ reason: 'login.emailCodeInvalid' });
    //? burn the attempt budget (maxAttempts 5; one spent above)
    for (let index = 0; index < 4; index++) await verifyEmailLoginCode({ email: 'sam@example.com', code: '000000' });
    await expect(verifyEmailLoginCode({ email: 'sam@example.com', code })).resolves.toMatchObject({ reason: 'login.emailCodeLocked' });
  });

  it('an authenticator-enrolled account still gets the 2FA challenge', async () => {
    const parked = { status: true, reason: 'login.twoFactorRequired', requiresTwoFactor: true, challengeToken: 'c'.repeat(64), twoFactorMethods: ['totp'] };
    challengeGateMock.mockResolvedValue(parked);
    const code = await request();
    const result = await verifyEmailLoginCode({ email: 'sam@example.com', code });
    expect(result).toBe(parked);
    expect(finalizeLoginMock).not.toHaveBeenCalled();
  });

  it('feature off → verify refuses even a would-be-valid code', async () => {
    const code = await request();
    setConfig({ emailCodeLogin: false });
    await expect(verifyEmailLoginCode({ email: 'sam@example.com', code })).resolves.toMatchObject({ reason: 'login.emailCodeDisabled' });
  });
});
