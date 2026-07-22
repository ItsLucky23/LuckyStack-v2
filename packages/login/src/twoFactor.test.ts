import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  store,
  fakeRedis,
  heldLeases,
  acquireLeaseMock,
  releaseLeaseMock,
  getProjectConfigMock,
  finalizeLoginMock,
  adapterMock,
  sendEmailMock,
} = vi.hoisted(() => {
  const backing = new Map<string, { value: string; ttl: number }>();
  const leases = new Set<string>();
  return {
    store: backing,
    heldLeases: leases,
    acquireLeaseMock: vi.fn(async (name: string) => {
      if (leases.has(name)) return null;
      leases.add(name);
      return `lease-token:${name}`;
    }),
    releaseLeaseMock: vi.fn(async (name: string) => leases.delete(name)),
    fakeRedis: {
      get: async (key: string) => backing.get(key)?.value ?? null,
      //? Supports the trailing `'NX'` flag: SET NX returns null when the key
      //? already exists (used by the atomic per-timestep replay claim).
      set: async (key: string, value: string, _ex?: string, ttl?: number, flag?: string) => {
        if (flag === 'NX' && backing.has(key)) return null;
        backing.set(key, { value, ttl: ttl ?? -1 });
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
      //? Email fallback uses emailOtp's atomic issue/verify Lua scripts.
      eval: async (
        script: string,
        _keyCount: number,
        key: string,
        counter: string,
        firstArg: string,
        secondArg: string,
      ) => {
        if (script.includes("redis.call('set'")) {
          backing.set(key, { value: firstArg, ttl: Number(secondArg) });
          backing.delete(counter);
          return 1;
        }
        const stored = backing.get(key);
        if (!stored) return 0;
        const attempts = Number(backing.get(counter)?.value ?? '0') + 1;
        backing.set(counter, { value: String(attempts), ttl: stored.ttl > 0 ? stored.ttl : 600 });
        if (attempts > Number(secondArg)) {
          backing.delete(key);
          backing.delete(counter);
          return 3;
        }
        if (stored.value !== firstArg) return 1;
        backing.delete(key);
        backing.delete(counter);
        return 2;
      },
    },
    getProjectConfigMock: vi.fn(),
    finalizeLoginMock: vi.fn(),
    adapterMock: {
      findByEmail: vi.fn(async () => null),
      //? Wide return type so tests can mockResolvedValue a UserRecord.
      findById: vi.fn<(id: string) => Promise<import('./userAdapter').UserRecord | null>>(async () => null),
      create: vi.fn(),
      update: vi.fn(),
    },
    sendEmailMock: vi.fn(async (_input: Record<string, unknown>) => ({ ok: true })),
  };
});

vi.mock('@luckystack/core', () => ({
  redis: fakeRedis,
  formatKey: (namespace: string, suffix: string) => `test${namespace}:${suffix}`,
  getProjectConfig: () => getProjectConfigMock(),
  getProjectName: () => 'testapp',
  getLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  dispatchHook: vi.fn(async () => ({ stopped: false })),
  acquireLease: acquireLeaseMock,
  releaseLease: releaseLeaseMock,
  tryCatch: async (fn: () => Promise<unknown>) => {
    try { return [null, await fn()]; } catch (error) { return [error, null]; }
  },
}));

vi.mock('./login', () => ({
  registerTwoFactorGate: vi.fn(),
  finalizeLogin: (...args: unknown[]) => finalizeLoginMock(...args),
}));

vi.mock('./userAdapter', () => ({
  getUserAdapter: () => adapterMock,
}));

vi.mock('./emailModuleLoader', () => ({
  loadEmailModule: async () => ({ sendEmail: sendEmailMock }),
}));

import crypto from 'node:crypto';
import {
  availableTwoFactorMethods,
  beginTotpEnrollment,
  confirmTotpEnrollment,
  createTwoFactorChallengeIfRequired,
  disableTwoFactor,
  encryptTotpSecret,
  decryptTotpSecret,
  requestTwoFactorEmailCode,
  verifyTwoFactorChallenge,
} from './twoFactor';
import { base32Decode, hotp } from './totp';
import type { UserRecord } from './userAdapter';

const AUTH_DEFAULTS = {
  twoFactor: 'optional',
  twoFactorEmailFallback: true,
  twoFactorChallengeTtlSeconds: 300,
  twoFactorMaxAttempts: 5,
  emailCodeTtlSeconds: 600,
  emailCodeLength: 6,
  emailCodeMaxAttempts: 5,
};

const setAuthConfig = (overrides: Record<string, unknown> = {}): void => {
  getProjectConfigMock.mockReturnValue({ auth: { ...AUTH_DEFAULTS, ...overrides } });
};

//? A fixed valid base32 secret + a helper to compute its CURRENT code.
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const currentCode = (offsetSteps = 0): string => {
  const key = base32Decode(SECRET);
  if (!key) throw new Error('secret must decode');
  return hotp(key, Math.floor(Date.now() / 1000 / 30) + offsetSteps);
};

const user = (overrides: Partial<UserRecord> = {}): UserRecord => ({
  id: 'u1',
  email: 'sam@example.com',
  twoFactorEnabled: true,
  totpSecret: SECRET,
  recoveryCodes: [],
  ...overrides,
}) as UserRecord;

beforeEach(() => {
  store.clear();
  heldLeases.clear();
  vi.clearAllMocks();
  setAuthConfig();
  adapterMock.update.mockImplementation(async () => user());
  finalizeLoginMock.mockResolvedValue({ status: true, reason: 'login.loggedIn', newToken: 't', session: {} });
  delete process.env.TOTP_ENCRYPTION_KEY;
  delete process.env.TOTP_ENCRYPTION_LEGACY_KEYS;
});

describe('createTwoFactorChallengeIfRequired (the login gate)', () => {
  it('returns null when the feature is globally disabled', async () => {
    setAuthConfig({ twoFactor: 'disabled' });
    await expect(createTwoFactorChallengeIfRequired(user(), {})).resolves.toBeNull();
  });

  it('returns null for users who never enrolled', async () => {
    await expect(createTwoFactorChallengeIfRequired(user({ twoFactorEnabled: false, totpSecret: null }), {})).resolves.toBeNull();
  });

  it('parks an enrolled login as a challenge (no session minted)', async () => {
    const challenge = await createTwoFactorChallengeIfRequired(user({ recoveryCodes: ['h'] }), {});
    expect(challenge?.requiresTwoFactor).toBe(true);
    expect(challenge?.challengeToken).toMatch(/^[a-f0-9]{64}$/);
    expect(challenge?.twoFactorMethods).toEqual(['totp', 'email-code', 'recovery-code']);
    expect(finalizeLoginMock).not.toHaveBeenCalled();
  });

  it('omits the email fallback when disabled in config', async () => {
    setAuthConfig({ twoFactorEmailFallback: false });
    const challenge = await createTwoFactorChallengeIfRequired(user(), {});
    expect(challenge?.twoFactorMethods).toEqual(['totp']);
  });
});

describe('verifyTwoFactorChallenge', () => {
  const startChallenge = async (record: UserRecord = user()): Promise<string> => {
    adapterMock.findById.mockResolvedValue(record);
    const challenge = await createTwoFactorChallengeIfRequired(record, {});
    if (!challenge) throw new Error('expected a challenge');
    return challenge.challengeToken;
  };

  it('a valid TOTP code completes the login through finalizeLogin', async () => {
    const token = await startChallenge();
    const result = await verifyTwoFactorChallenge({ challengeToken: token, code: currentCode() });
    expect(result.status).toBe(true);
    expect(finalizeLoginMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }), expect.objectContaining({ provider: 'credentials' }));
  });

  it('replay protection: the SAME code cannot complete two challenges', async () => {
    const code = currentCode();
    const first = await startChallenge();
    await verifyTwoFactorChallenge({ challengeToken: first, code });
    const second = await startChallenge();
    const replay = await verifyTwoFactorChallenge({ challengeToken: second, code });
    expect(replay.status).toBe(false);
    expect(replay.reason).toBe('login.twoFactorInvalidCode');
  });

  it('CONCURRENT verifies of the same code: the atomic NX claim lets exactly one win', async () => {
    const code = currentCode();
    const a = await startChallenge();
    const b = await startChallenge();
    //? Fire both before either awaits the claim — the per-timestep NX marker
    //? must serialize them so only one mints a session.
    const [r1, r2] = await Promise.all([
      verifyTwoFactorChallenge({ challengeToken: a, code }),
      verifyTwoFactorChallenge({ challengeToken: b, code }),
    ]);
    expect([r1.status, r2.status].filter(Boolean)).toHaveLength(1);
  });

  it('cross-challenge account lockout: too many failures locks the second factor regardless of fresh challenges', async () => {
    setAuthConfig({ twoFactorMaxAttempts: 100 }); //? isolate the ACCOUNT ceiling from the per-challenge budget
    //? 10 failed attempts (ACCOUNT_FAIL_LIMIT) across fresh challenges…
    for (let index = 0; index < 10; index++) {
      const token = await startChallenge();
      await verifyTwoFactorChallenge({ challengeToken: token, code: '000000' });
    }
    //? …now even a fresh challenge with the CORRECT code is refused (locked).
    const token = await startChallenge();
    const result = await verifyTwoFactorChallenge({ challengeToken: token, code: currentCode() });
    expect(result).toEqual({ status: false, reason: 'login.twoFactorLocked' });
  });

  it('an unknown/expired challenge token fails closed', async () => {
    const result = await verifyTwoFactorChallenge({ challengeToken: 'a'.repeat(64), code: currentCode() });
    expect(result).toEqual({ status: false, reason: 'login.twoFactorChallengeExpired' });
  });

  it('wrong codes are refused and the attempt budget burns the challenge', async () => {
    setAuthConfig({ twoFactorMaxAttempts: 2 });
    const token = await startChallenge();
    await expect(verifyTwoFactorChallenge({ challengeToken: token, code: '000000' })).resolves.toMatchObject({ reason: 'login.twoFactorInvalidCode' });
    await expect(verifyTwoFactorChallenge({ challengeToken: token, code: '000000' })).resolves.toMatchObject({ reason: 'login.twoFactorInvalidCode' });
    await expect(verifyTwoFactorChallenge({ challengeToken: token, code: currentCode() })).resolves.toMatchObject({ reason: 'login.twoFactorLocked' });
    await expect(verifyTwoFactorChallenge({ challengeToken: token, code: currentCode() })).resolves.toMatchObject({ reason: 'login.twoFactorChallengeExpired' });
  });

  it('a recovery code works once and is burned from the user record', async () => {
    const rawRecovery = 'ab12c-d34ef';
    const hash = crypto.createHash('sha256').update(rawRecovery).digest('hex');
    const record = user({ recoveryCodes: [hash, 'otherhash'] });
    const token = await startChallenge(record);
    const result = await verifyTwoFactorChallenge({ challengeToken: token, code: rawRecovery, method: 'recovery-code' });
    expect(result.status).toBe(true);
    expect(adapterMock.update).toHaveBeenCalledWith('u1', { recoveryCodes: ['otherhash'] });
  });

  it('a recovery code whose burn cannot be persisted is refused (fail closed)', async () => {
    const rawRecovery = 'ab12c-d34ef';
    const hash = crypto.createHash('sha256').update(rawRecovery).digest('hex');
    adapterMock.update.mockRejectedValue(new Error('db down'));
    const token = await startChallenge(user({ recoveryCodes: [hash] }));
    const result = await verifyTwoFactorChallenge({ challengeToken: token, code: rawRecovery, method: 'recovery-code' });
    expect(result.status).toBe(false);
  });

  it('the email fallback verifies a code issued via requestTwoFactorEmailCode', async () => {
    const token = await startChallenge();
    await requestTwoFactorEmailCode(token);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const sentText = (sendEmailMock.mock.calls[0]?.[0] as { text: string }).text;
    const code = /Code: (\d{6})/.exec(sentText)?.[1];
    expect(code).toBeDefined();
    const result = await verifyTwoFactorChallenge({ challengeToken: token, code: code ?? '', method: 'email-code' });
    expect(result.status).toBe(true);
  });
});

describe('enrollment', () => {
  it('begin → confirm with a valid first code enables 2FA + returns raw recovery codes once', async () => {
    const start = await beginTotpEnrollment(user({ twoFactorEnabled: false, totpSecret: null }));
    expect(start.ok).toBe(true);
    if (!start.ok) throw new Error('enrollment should start');
    expect(start.otpauthUri).toContain('otpauth://totp/');
    expect(start.otpauthUri).toContain('issuer=testapp');
    const key = base32Decode(start.secret);
    if (!key) throw new Error('secret must decode');
    const code = hotp(key, Math.floor(Date.now() / 1000 / 30));
    const confirmed = await confirmTotpEnrollment(user({ twoFactorEnabled: false, totpSecret: null }), code);
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) {
      expect(confirmed.recoveryCodes).toHaveLength(10);
      //? 80-bit codes, grouped 5×4.
      for (const raw of confirmed.recoveryCodes) expect(raw).toMatch(/^[a-f0-9]{5}-[a-f0-9]{5}-[a-f0-9]{5}-[a-f0-9]{5}$/);
    }
    expect(adapterMock.update).toHaveBeenCalledWith('u1', expect.objectContaining({ twoFactorEnabled: true }));
    //? The RAW codes are never persisted — only hashes.
    const patch = adapterMock.update.mock.calls[0]?.[1] as { recoveryCodes: string[] };
    for (const stored of patch.recoveryCodes) expect(stored).toMatch(/^[a-f0-9]{64}$/);
  });

  it('re-enrollment is refused while 2FA is already enabled (step-up required)', async () => {
    //? Hijacked-session threat: an already-enrolled user cannot overwrite the
    //? factor via setup+enable — they must disable first (which needs a code).
    const started = await beginTotpEnrollment(user({ twoFactorEnabled: true }));
    expect(started).toEqual({ ok: false, reason: 'login.twoFactorAlreadyEnabled' });
    const confirmed = await confirmTotpEnrollment(user({ twoFactorEnabled: true }), currentCode());
    expect(confirmed).toEqual({ ok: false, reason: 'login.twoFactorAlreadyEnabled' });
    expect(adapterMock.update).not.toHaveBeenCalled();
  });

  it('enrollment is refused when the feature is globally disabled', async () => {
    setAuthConfig({ twoFactor: 'disabled' });
    const started = await beginTotpEnrollment(user({ twoFactorEnabled: false, totpSecret: null }));
    expect(started).toEqual({ ok: false, reason: 'login.twoFactorDisabledByServer' });
  });

  it('confirm with a wrong code does not enable anything', async () => {
    await beginTotpEnrollment(user({ twoFactorEnabled: false, totpSecret: null }));
    const confirmed = await confirmTotpEnrollment(user({ twoFactorEnabled: false, totpSecret: null }), '000000');
    expect(confirmed.ok).toBe(false);
    expect(adapterMock.update).not.toHaveBeenCalled();
  });

  it('confirm without a pending enrollment reports expired', async () => {
    const confirmed = await confirmTotpEnrollment(user({ twoFactorEnabled: false, totpSecret: null }), '123456');
    expect(confirmed).toEqual({ ok: false, reason: 'login.twoFactorEnrollmentExpired' });
  });

  it('serializes concurrent confirms so only one recovery-code set is returned', async () => {
    const record = user({ twoFactorEnabled: false, totpSecret: null });
    const start = await beginTotpEnrollment(record);
    if (!start.ok) throw new Error('enrollment should start');
    const key = base32Decode(start.secret);
    if (!key) throw new Error('secret must decode');
    const code = hotp(key, Math.floor(Date.now() / 1000 / 30));

    let finishUpdate: () => void = () => undefined;
    const updateGate = new Promise<void>((resolve) => { finishUpdate = resolve; });
    adapterMock.update.mockImplementationOnce(async () => {
      await updateGate;
      return record;
    });

    const firstPromise = confirmTotpEnrollment(record, code);
    await vi.waitFor(() => { expect(adapterMock.update).toHaveBeenCalledTimes(1); });
    const second = await confirmTotpEnrollment(record, code);
    expect(second).toEqual({ ok: false, reason: 'login.twoFactorEnrollmentExpired' });

    finishUpdate();
    const first = await firstPromise;
    expect(first.ok).toBe(true);
    expect(adapterMock.update).toHaveBeenCalledTimes(1);
    expect(releaseLeaseMock).toHaveBeenCalledWith('2fa-enrollment:u1', 'lease-token:2fa-enrollment:u1');
  });

  it('disable requires a currently-valid code and clears the 2FA fields', async () => {
    const denied = await disableTwoFactor(user(), '000000');
    expect(denied.ok).toBe(false);
    const allowed = await disableTwoFactor(user(), currentCode());
    expect(allowed.ok).toBe(true);
    expect(adapterMock.update).toHaveBeenCalledWith('u1', { totpSecret: null, twoFactorEnabled: false, recoveryCodes: [] });
  });

  it('disable works right after a login that consumed the same timestep (no single-use guard on management)', async () => {
    //? Login boundary consumes timestep T (stores the replay guard)…
    adapterMock.findById.mockResolvedValue(user());
    const challenge = await createTwoFactorChallengeIfRequired(user(), {});
    if (!challenge) throw new Error('expected a challenge');
    const code = currentCode();
    await verifyTwoFactorChallenge({ challengeToken: challenge.challengeToken, code });
    //? …the user's app still shows the SAME code — disable must still accept it.
    const disabled = await disableTwoFactor(user(), code);
    expect(disabled.ok).toBe(true);
  });
});

describe('TOTP secret at rest', () => {
  const encryptLegacyGcm = (secret: string, rawKey: string): string => {
    const key = crypto.createHash('sha256').update(rawKey).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return `gcm:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ciphertext.toString('base64')}`;
  };

  it('without TOTP_ENCRYPTION_KEY the secret round-trips as plaintext', () => {
    const stored = encryptTotpSecret(SECRET);
    expect(stored).toBe(SECRET);
    expect(decryptTotpSecret(stored)).toBe(SECRET);
  });

  it('writes versioned AES-256-GCM ciphertext with a non-secret key id', () => {
    process.env.TOTP_ENCRYPTION_KEY = 'super-secret-key';
    const stored = encryptTotpSecret(SECRET);
    expect(stored.startsWith('enc:v2:')).toBe(true);
    expect(stored).not.toContain(SECRET);
    expect(stored).not.toContain('super-secret-key');
    expect(decryptTotpSecret(stored)).toBe(SECRET);
  });

  it('decrypts v2 ciphertext through the legacy key ring after primary rotation', () => {
    process.env.TOTP_ENCRYPTION_KEY = 'old-primary';
    const stored = encryptTotpSecret(SECRET);
    process.env.TOTP_ENCRYPTION_KEY = 'new-primary';
    process.env.TOTP_ENCRYPTION_LEGACY_KEYS = JSON.stringify(['old-primary']);

    expect(decryptTotpSecret(stored)).toBe(SECRET);
  });

  it('keeps pre-v2 gcm ciphertext readable through the legacy key ring', () => {
    const stored = encryptLegacyGcm(SECRET, 'old-primary');
    process.env.TOTP_ENCRYPTION_KEY = 'new-primary';
    process.env.TOTP_ENCRYPTION_LEGACY_KEYS = JSON.stringify(['old-primary']);

    expect(decryptTotpSecret(stored)).toBe(SECRET);
  });

  it('legacy plaintext secrets stay readable after the key is introduced', () => {
    process.env.TOTP_ENCRYPTION_KEY = 'super-secret-key';
    expect(decryptTotpSecret(SECRET)).toBe(SECRET);
  });

  it('an encrypted secret without its primary or legacy key fails closed', () => {
    process.env.TOTP_ENCRYPTION_KEY = 'super-secret-key';
    const stored = encryptTotpSecret(SECRET);
    delete process.env.TOTP_ENCRYPTION_KEY;
    expect(decryptTotpSecret(stored)).toBeNull();
  });

  it('lazily rewrites legacy-key ciphertext after a successful TOTP proof', async () => {
    process.env.TOTP_ENCRYPTION_KEY = 'old-primary';
    const oldCiphertext = encryptTotpSecret(SECRET);
    process.env.TOTP_ENCRYPTION_KEY = 'new-primary';
    process.env.TOTP_ENCRYPTION_LEGACY_KEYS = JSON.stringify(['old-primary']);
    const rotatedUser = user({ totpSecret: oldCiphertext });
    adapterMock.findById.mockResolvedValue(rotatedUser);
    const challenge = await createTwoFactorChallengeIfRequired(rotatedUser, {});
    if (!challenge) throw new Error('expected a challenge');

    await verifyTwoFactorChallenge({
      challengeToken: challenge.challengeToken,
      code: currentCode(),
    });

    const migrationCall = adapterMock.update.mock.calls.find((call) =>
      typeof call[1]?.totpSecret === 'string' && call[1].totpSecret.startsWith('enc:v2:'),
    );
    expect(migrationCall).toBeDefined();
    expect(decryptTotpSecret(migrationCall?.[1].totpSecret ?? '')).toBe(SECRET);
  });
});

describe('availableTwoFactorMethods', () => {
  it('lists exactly what the user can answer with', () => {
    expect(availableTwoFactorMethods(user({ recoveryCodes: ['h'] }))).toEqual(['totp', 'email-code', 'recovery-code']);
    expect(availableTwoFactorMethods(user({ email: null as unknown as string }))).toEqual(['totp']);
  });
});
