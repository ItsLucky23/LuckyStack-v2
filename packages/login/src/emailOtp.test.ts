import { describe, it, expect, vi, beforeEach } from 'vitest';

//? In-memory Redis fake — just the commands emailOtp uses (get/set/del/incr/
//? ttl/expire), with EX bookkeeping so TTL propagation is observable.
//? `vi.hoisted` because the vi.mock factory below is hoisted above top-level consts.
const { store, fakeRedis } = vi.hoisted(() => {
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
    },
  };
});

vi.mock('@luckystack/core', () => ({
  redis: fakeRedis,
  formatKey: (namespace: string, suffix: string) => `test${namespace}:${suffix}`,
}));

import { generateNumericCode, issueEmailCode, verifyEmailCode, clearEmailCode } from './emailOtp';

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe('generateNumericCode', () => {
  it('always returns exactly `digits` digits (zero-padded)', () => {
    for (let index = 0; index < 200; index++) {
      expect(generateNumericCode(6)).toMatch(/^\d{6}$/);
    }
    expect(generateNumericCode(8)).toMatch(/^\d{8}$/);
  });
});

describe('issueEmailCode + verifyEmailCode', () => {
  const slot = { purpose: 'login' as const, identity: 'User@Example.com', ttlSeconds: 600, digits: 6 };

  it('round-trips: issued code verifies once, then the slot is consumed', async () => {
    const code = await issueEmailCode(slot);
    expect(code).toMatch(/^\d{6}$/);
    await expect(verifyEmailCode({ ...slot, code, maxAttempts: 5 })).resolves.toBe('valid');
    //? single-use: same code again → slot is gone.
    await expect(verifyEmailCode({ ...slot, code, maxAttempts: 5 })).resolves.toBe('expired');
  });

  it('stores only the hash, never the raw code', async () => {
    const code = await issueEmailCode(slot);
    const values = [...store.values()].map((entry) => entry.value);
    expect(values.some((value) => value.includes(code))).toBe(false);
  });

  it('normalizes the identity (email case/whitespace share one slot)', async () => {
    const code = await issueEmailCode(slot);
    await expect(verifyEmailCode({ ...slot, identity: '  user@example.COM ', code, maxAttempts: 5 })).resolves.toBe('valid');
  });

  it('wrong code → invalid, and the attempt budget eventually burns the code', async () => {
    const code = await issueEmailCode({ ...slot, ttlSeconds: 300 });
    await expect(verifyEmailCode({ ...slot, code: '000000', maxAttempts: 3 })).resolves.toBe('invalid');
    await expect(verifyEmailCode({ ...slot, code: '111111', maxAttempts: 3 })).resolves.toBe('invalid');
    await expect(verifyEmailCode({ ...slot, code: '222222', maxAttempts: 3 })).resolves.toBe('invalid');
    //? 4th attempt exceeds maxAttempts=3 → locked + code burned…
    await expect(verifyEmailCode({ ...slot, code, maxAttempts: 3 })).resolves.toBe('locked');
    //? …so even the CORRECT code is dead afterward.
    await expect(verifyEmailCode({ ...slot, code, maxAttempts: 3 })).resolves.toBe('expired');
  });

  it('re-issuing replaces the previous code and resets the attempt counter', async () => {
    const first = await issueEmailCode(slot);
    await verifyEmailCode({ ...slot, code: '000000', maxAttempts: 5 }); //? one failed attempt
    const second = await issueEmailCode(slot);
    await expect(verifyEmailCode({ ...slot, code: first, maxAttempts: 5 })).resolves.toBe('invalid');
    await expect(verifyEmailCode({ ...slot, code: second, maxAttempts: 5 })).resolves.toBe('valid');
  });

  it('verify without any issued code → expired', async () => {
    await expect(verifyEmailCode({ ...slot, code: '123456', maxAttempts: 5 })).resolves.toBe('expired');
  });

  it('purposes are isolated slots (login code cannot answer a 2fa challenge)', async () => {
    const code = await issueEmailCode(slot);
    await expect(verifyEmailCode({ purpose: '2fa', identity: slot.identity, code, maxAttempts: 5 })).resolves.toBe('expired');
  });

  it('the attempt counter inherits the code TTL (cannot outlive it)', async () => {
    await issueEmailCode({ ...slot, ttlSeconds: 300 });
    await verifyEmailCode({ ...slot, code: '000000', maxAttempts: 5 });
    const counterEntry = store.get('test-emailcode-attempts:login:user@example.com');
    expect(counterEntry?.ttl).toBe(300);
  });

  it('clearEmailCode drops the slot', async () => {
    const code = await issueEmailCode(slot);
    await clearEmailCode('login', slot.identity);
    await expect(verifyEmailCode({ ...slot, code, maxAttempts: 5 })).resolves.toBe('expired');
  });

  it('tolerates whitespace around the submitted code', async () => {
    const code = await issueEmailCode(slot);
    await expect(verifyEmailCode({ ...slot, code: ` ${code} `, maxAttempts: 5 })).resolves.toBe('valid');
  });
});
