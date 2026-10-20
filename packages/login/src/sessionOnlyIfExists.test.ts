import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

//? `saveSession(..., { onlyIfExists: true })` is the write used by socket room
//? joins / location updates after an earlier read. A logout or revoke that
//? deleted the session in between must win: the update may not recreate the
//? record or re-add the token to the active set (finding 009).

const { redisSetMock } = vi.hoisted(() => ({ redisSetMock: vi.fn() }));

vi.mock('@luckystack/core', () => ({
  socketEventNames: {},
  dispatchHook: vi.fn(() => Promise.resolve({ stopped: false })),
  getCsrfConfig: () => ({ tokenLength: 16 }),
  getLogger: () => ({ warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() }),
  getProjectConfig: () => ({ session: { expiryDays: 1, basedToken: false, perUser: 'single' } }),
  getIoInstance: () => null,
  formatKey: (namespace: string, suffix = '') => (suffix === '' ? `p${namespace}` : `p${namespace}:${suffix}`),
  tryCatch: async (fn: () => Promise<unknown>) => {
    try {
      return [null, await fn()];
    } catch (error) {
      return [error, null];
    }
  },
  tryCatchSync: (fn: () => unknown) => {
    try {
      return [null, fn()];
    } catch (error) {
      return [error, null];
    }
  },
  redis: { set: (...args: unknown[]) => redisSetMock(...args) as unknown },
}));

import { saveSession } from './session';
import { redisSessionAdapter, registerSessionAdapter, type SessionAdapter } from './sessionAdapter';
import { registerSessionSanitizer, resetSessionSanitizerForTests } from './sessionSanitizer';

const makeAdapter = (initial: Record<string, string>, withAtomic: boolean) => {
  const records = new Map(Object.entries(initial));
  const active = new Set<string>();
  const adapter: SessionAdapter = {
    name: 'memory',
    getRaw: vi.fn((token: string) => Promise.resolve(records.get(token) ?? null)),
    setRaw: vi.fn((token: string, value: string) => { records.set(token, value); return Promise.resolve(); }),
    delete: vi.fn((token: string) => { records.delete(token); return Promise.resolve(); }),
    expire: vi.fn(() => Promise.resolve(true)),
    ttl: vi.fn(() => Promise.resolve(100)),
    trackActive: vi.fn((_userId: string, token: string) => { active.add(token); return Promise.resolve(); }),
    untrackActive: vi.fn((_userId: string, token: string) => { active.delete(token); return Promise.resolve(); }),
    listActive: vi.fn(() => Promise.resolve([...active])),
    touchActive: vi.fn(() => Promise.resolve()),
  };
  if (withAtomic) {
    adapter.setRawIfExists = vi.fn((token: string, value: string) => {
      if (!records.has(token)) return Promise.resolve(false);
      records.set(token, value);
      return Promise.resolve(true);
    });
  }
  return { adapter, records, active };
};

describe('saveSession onlyIfExists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  for (const withAtomic of [true, false]) {
    const label = withAtomic ? 'adapter with setRawIfExists' : 'adapter without setRawIfExists (re-read fallback)';

    it(`${label}: does not recreate a deleted session or re-track its token`, async () => {
      const { adapter, records, active } = makeAdapter({}, withAtomic);
      registerSessionAdapter(adapter);

      const result = await saveSession('gone', { id: 'u1', roomCodes: ['lobby'] }, undefined, { onlyIfExists: true });

      expect(result).toEqual({ ok: false, errorCode: 'session.notFound' });
      expect(records.has('gone')).toBe(false);
      expect(active.has('gone')).toBe(false);
      expect(adapter.setRaw).not.toHaveBeenCalled();
      expect(adapter.trackActive).not.toHaveBeenCalled();
    });

    it(`${label}: updates an existing session and only refreshes the active-set TTL`, async () => {
      const { adapter, records } = makeAdapter({ live: JSON.stringify({ id: 'u1', csrfToken: 'c' }) }, withAtomic);
      registerSessionAdapter(adapter);

      const result = await saveSession('live', { id: 'u1', csrfToken: 'c', roomCodes: ['lobby'] }, undefined, { onlyIfExists: true });

      expect(result).toEqual({ ok: true });
      expect(JSON.parse(records.get('live') ?? '{}')).toMatchObject({ roomCodes: ['lobby'] });
      expect(adapter.trackActive).not.toHaveBeenCalled();
      expect(adapter.touchActive).toHaveBeenCalledWith('u1', 86_400);
    });
  }

  it('a plain save still creates the record and tracks the token', async () => {
    const { adapter, records, active } = makeAdapter({}, true);
    registerSessionAdapter(adapter);

    const result = await saveSession('new', { id: 'u1' });

    expect(result).toEqual({ ok: true });
    expect(records.has('new')).toBe(true);
    expect(active.has('new')).toBe(true);
  });
});

describe('redisSessionAdapter.setRawIfExists', () => {
  it('uses SET ... XX and reports whether the key existed', async () => {
    redisSetMock.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    const { setRawIfExists } = redisSessionAdapter;
    if (!setRawIfExists) throw new Error('redis adapter must implement setRawIfExists');

    await expect(setRawIfExists('t', 'v', 60)).resolves.toBe(true);
    await expect(setRawIfExists('t', 'v', 60)).resolves.toBe(false);
    expect(redisSetMock).toHaveBeenCalledWith('p-session:t', 'v', 'EX', 60, 'XX');
  });
});

describe('saveSession sanitizer fallback', () => {
  afterEach(() => {
    resetSessionSanitizerForTests();
  });

  it('a throwing sanitizer still keeps the provider id, 2FA material and password out of the session (ADR 0086)', async () => {
    const { adapter, records } = makeAdapter({}, true);
    registerSessionAdapter(adapter);
    registerSessionSanitizer(() => { throw new Error('sanitizer bug'); });

    const record = { id: 'u1', password: 'hash', totpSecret: 's', recoveryCodes: ['r'], providerAccountId: 'sub-1' };
    const result = await saveSession('tok', record);

    expect(result).toEqual({ ok: true });
    const stored = JSON.parse(records.get('tok') ?? '{}') as Record<string, unknown>;
    expect(stored.id).toBe('u1');
    for (const key of ['password', 'totpSecret', 'recoveryCodes', 'providerAccountId']) {
      expect(stored).not.toHaveProperty(key);
    }
  });
});
