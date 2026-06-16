import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

//? M-15 login-lockout DoS regression. The credentials LOGIN branch must NOT run
//? the password-POLICY check: an attacker who knows a victim's email could
//? otherwise POST policy-violating passwords (e.g. "short") to trip the
//? per-account lockout counter and lock the victim out. Only a GENUINE
//? wrong-password attempt should feed the counter.
//?
//? Two layers are asserted:
//?  1. dispatcher: a policy-violating LOGIN password is NOT rejected with a
//?     policy reason key — it flows through to the bcrypt compare and yields the
//?     shared `login.wrongPassword` (or succeeds if it is the real password).
//?     REGISTER still enforces the policy.
//?  2. lockout hook: a policy reason on `stage:'login'` does NOT increment the
//?     counter, while `login.wrongPassword` does (defense-in-depth — see
//?     NON_COUNTING_REASONS).

// ---- shared mock state ----
interface UserRow { id: string; password?: string | null; lastLogin: Date | null }
const dispatchHookMock = vi.fn();
const validatePasswordMock = vi.fn<(pw: string) => string | null>();
const resolveUserByEmailMock = vi.fn<(...a: unknown[]) => Promise<UserRow | null>>();
const compareMock = vi.fn<(pw: string, hash: string) => Promise<boolean>>();
const saveSessionMock = vi.fn<(...a: unknown[]) => Promise<{ ok: boolean; errorCode?: string }>>();

const PROJECT_CONFIG = {
  logging: { devLogs: false },
  auth: {
    emailMaxLength: 320,
    nameMaxLength: 80,
    bcryptRounds: 10,
    allowRegistration: true,
    oauthStateTtlSeconds: 600,
    passwordPolicy: {},
  },
  defaultLanguage: 'en',
};

vi.mock('@luckystack/core', () => ({
  tryCatch: async <T>(fn: () => Promise<T>): Promise<[Error | null, T | null]> => {
    try {
      return [null, await fn()];
    } catch (error) {
      return [error as Error, null];
    }
  },
  tryCatchSync: <T>(fn: () => T): [Error | null, T | null] => {
    try {
      return [null, fn()];
    } catch (error) {
      return [error as Error, null];
    }
  },
  redis: {},
  getUploadsDir: () => '/tmp/uploads-test',
  dispatchHook: (...args: unknown[]) => {
    dispatchHookMock(...args);
    return Promise.resolve({ stopped: false });
  },
  getLogger: () => ({ warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() }),
  formatKey: (ns: string, suffix = '') => `luckystack${ns}:${suffix}`,
  getProjectConfig: () => PROJECT_CONFIG,
  getCookieValue: () => null,
}));

vi.mock('./oauthProviders', () => ({
  getOAuthProviders: () => [],
  isFullOAuthProvider: () => false,
}));
vi.mock('./redirectResolver', () => ({ getPostLoginRedirect: () => null }));
vi.mock('./session', () => ({ saveSession: (...a: unknown[]) => saveSessionMock(...a) }));
vi.mock('./userAdapter', () => ({
  getUserAdapter: () => ({
    update: vi.fn(() => Promise.resolve()),
    create: vi.fn(),
  }),
}));
vi.mock('./accountStrategy', () => ({
  resolveUserByEmail: (...a: unknown[]) => resolveUserByEmailMock(...a),
}));
vi.mock('./passwordPolicy', () => ({ validatePassword: (pw: string) => validatePasswordMock(pw) }));
vi.mock('./authLockout', () => ({
  isAccountLocked: () => Promise.resolve(false),
  clearAuthFailures: () => Promise.resolve(),
}));
vi.mock('bcryptjs', () => ({
  default: {
    compare: (pw: string, hash: string) => compareMock(pw, hash),
    genSalt: () => Promise.resolve('salt'),
    hash: () => Promise.resolve('hashed'),
  },
}));
//? validator is CJS-default; isEmail must pass for our test addresses.
vi.mock('validator', () => ({
  default: {
    isEmail: (v: string) => v.includes('@'),
    escape: (v: string) => v,
  },
}));
vi.mock('node:fs', () => ({ existsSync: () => false }));

import { loginWithCredentials } from './login';

beforeEach(() => {
  dispatchHookMock.mockReset();
  validatePasswordMock.mockReset();
  resolveUserByEmailMock.mockReset();
  compareMock.mockReset();
  saveSessionMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

//? Collect every `loginFailed` payload dispatched during a call.
const loginFailedReasons = (): string[] => {
  const reasons: string[] = [];
  for (const [name, payload] of dispatchHookMock.mock.calls) {
    if (name === 'loginFailed') reasons.push((payload as { reason: string }).reason);
  }
  return reasons;
};

describe('M-15: LOGIN branch does not run the password policy', () => {
  it('a policy-violating LOGIN password is NOT rejected with a policy reason — it reaches the wrong-password compare', async () => {
    //? The policy would reject "short", but the LOGIN branch must never call it.
    validatePasswordMock.mockReturnValue('login.passwordCharacterMinimum');
    resolveUserByEmailMock.mockResolvedValue({ id: 'u1', password: '$2b$10$realhash', lastLogin: null });
    compareMock.mockResolvedValue(false); // genuine wrong password

    const result = await loginWithCredentials({ email: 'victim@x.com', password: 'short' });

    expect(result.status).toBe(false);
    //? Reason is the shared wrong-password key, NOT a policy key.
    expect(result.reason).toBe('login.wrongPassword');
    //? The policy validator was never consulted on the login branch.
    expect(validatePasswordMock).not.toHaveBeenCalled();
    //? A real bcrypt compare happened (proves we reached the credential check).
    expect(compareMock).toHaveBeenCalledWith('short', '$2b$10$realhash');
    //? No policy reason was emitted that could feed the lockout counter.
    expect(loginFailedReasons()).toContain('login.wrongPassword');
    expect(loginFailedReasons()).not.toContain('login.passwordCharacterMinimum');
  });

  it('a policy-violating LOGIN password that is actually correct logs the user in', async () => {
    validatePasswordMock.mockReturnValue('login.passwordCharacterMinimum');
    resolveUserByEmailMock.mockResolvedValue({ id: 'u1', password: '$2b$10$realhash', lastLogin: null });
    compareMock.mockResolvedValue(true); // it IS the real (legacy weak) password
    saveSessionMock.mockResolvedValue({ ok: true });

    const result = await loginWithCredentials({ email: 'legacy@x.com', password: 'weak' });

    expect(result.status).toBe(true);
    expect(validatePasswordMock).not.toHaveBeenCalled();
  });

  it('REGISTER still enforces the password policy', async () => {
    validatePasswordMock.mockReturnValue('login.passwordCharacterMinimum');

    const result = await loginWithCredentials({
      email: 'new@x.com',
      password: 'short',
      name: 'New User',
      confirmPassword: 'short',
    });

    expect(result.status).toBe(false);
    expect(result.reason).toBe('login.passwordCharacterMinimum');
    expect(validatePasswordMock).toHaveBeenCalledWith('short');
    //? Register-stage rejection never reaches the user lookup.
    expect(resolveUserByEmailMock).not.toHaveBeenCalled();
  });
});
