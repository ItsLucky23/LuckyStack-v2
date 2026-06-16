import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

//? These tests assert that `@luckystack/login`'s password-reset and email-change
//? token primitives now route through the `@luckystack/core` one-time-token
//? primitive (hash-at-rest) instead of storing the RAW token as the Redis key.
//?
//? We mock @luckystack/core with a faithful re-implementation of the primitive's
//? observable contract:
//?  - `issueOneTimeToken` mints a 64-char hex raw token and returns a `store()`
//?    that writes `sha256(token)` -> payload into an in-memory map (NEVER the raw
//?    token as the key).
//?  - `consumeOneTimeToken` / `consumeOneTimeTokenJson` atomically read+delete by
//?    the hashed key (single-use), returning null on miss / malformed.
//? The in-memory `store` is keyed by the HASH, so a test can prove the raw token
//? is never a stored key (hash-at-rest guarantee), and that a token is one-shot.

const TTL_SECONDS = 3600;

const {
  store,
  issueOneTimeToken,
  consumeOneTimeToken,
  consumeOneTimeTokenJson,
  redis,
  formatKey,
  oneTimeTokenKey,
} = vi.hoisted(() => {
  //? Unified in-memory map shared by both the one-time-token primitive and the
  //? `redis` stub. Token hashes and pointer keys are always distinct strings so
  //? they coexist without collision.
  const store = new Map<string, string>();
  // eslint-disable-next-line unicorn/consistent-function-scoping -- must live inside the hoisted factory so the mock closure is self-contained
  const sha = (token: string): string => createHash('sha256').update(token).digest('hex');

  const issueOneTimeToken = (
    _namespace: string,
    _ttlSeconds: number,
    payload: string | Record<string, unknown>,
  ): { token: string; store: () => Promise<void> } => {
    const value = typeof payload === 'string' ? payload : JSON.stringify(payload);
    //? Random 64-char hex raw token (entropy source is irrelevant for the test).
    const token = sha(`${Math.random()}-${Date.now()}-${value}`);
    return {
      token,
      store: (): Promise<void> => {
        store.set(sha(token), value);
        return Promise.resolve();
      },
    };
  };

  const consumeOneTimeToken = (_namespace: string, token: string): Promise<string | null> => {
    if (!token || typeof token !== 'string') return Promise.resolve(null);
    const key = sha(token);
    const value = store.get(key);
    if (value === undefined) return Promise.resolve(null);
    store.delete(key); // single-use GET+DEL
    return Promise.resolve(value.length > 0 ? value : null);
  };

  const consumeOneTimeTokenJson = async <T>(namespace: string, token: string): Promise<T | null> => {
    const raw = await consumeOneTimeToken(namespace, token);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  };

  //? `formatKey` in tests: simple namespace:suffix join (no project-name prefix
  //? needed — the key uniqueness contract is all that matters here).
  const formatKey = (namespace: string, suffix = ''): string =>
    suffix === '' ? namespace : `${namespace}:${suffix}`;

  //? `oneTimeTokenKey` must produce the SAME key that `issueOneTimeToken.store()`
  //? writes into `store` (i.e. sha(token)), so that `redis.del(priorKey)` issued
  //? by the LOGIN-F16 invalidation path actually removes the old token entry.
  //? The real implementation calls `formatKey(namespace, sha(token))`, but in our
  //? mock the stored key is plain `sha(token)` — so we replicate that here.
  const oneTimeTokenKey = (_namespace: string, token: string): string => sha(token);

  //? Minimal Redis stub: get/set/del all operate on the shared `store` Map so
  //? the pointer-key write (`redis.set`) and the invalidation read+delete
  //? (`redis.get` + `redis.del`) exercise the real LOGIN-F16 code path against
  //? the same data as the token-consumption assertions.
  const redis = {
    get: (key: string): Promise<string | null> => Promise.resolve(store.get(key) ?? null),
    set: (key: string, value: string, ..._rest: unknown[]): Promise<void> => {
      store.set(key, value);
      return Promise.resolve();
    },
    del: (key: string): Promise<void> => {
      store.delete(key);
      return Promise.resolve();
    },
  };

  return { store, issueOneTimeToken, consumeOneTimeToken, consumeOneTimeTokenJson, redis, formatKey, oneTimeTokenKey };
});

vi.mock('@luckystack/core', () => ({
  getProjectConfig: vi.fn(() => ({
    auth: { passwordResetTtlSeconds: TTL_SECONDS, emailChangeTtlSeconds: TTL_SECONDS, bcryptRounds: 10 },
  })),
  issueOneTimeToken,
  consumeOneTimeToken,
  consumeOneTimeTokenJson,
  redis,
  formatKey,
  oneTimeTokenKey,
}));

//? userAdapter + passwordPolicy are pulled in by passwordReset.ts's other
//? exports (updatePasswordHash); stub them so the import graph loads without a
//? Prisma/Redis dependency. The token functions under test don't touch them.
vi.mock('./userAdapter', () => ({ getUserAdapter: vi.fn() }));
vi.mock('./passwordPolicy', () => ({ validatePassword: vi.fn(() => null) }));

import { createPasswordResetToken, consumePasswordResetToken } from './passwordReset';
import { createEmailChangeToken, consumeEmailChangeToken } from './emailChange';

const sha256 = (token: string): string => createHash('sha256').update(token).digest('hex');

beforeEach(() => {
  store.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('password-reset token (hash-at-rest, one-time)', () => {
  it('issue -> consume round-trips the bound userId', async () => {
    const token = await createPasswordResetToken('user-123');
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await consumePasswordResetToken(token)).toBe('user-123');
  });

  it('stores ONLY sha256(token) as the key — never the raw token', async () => {
    const token = await createPasswordResetToken('user-123');
    expect(store.has(sha256(token))).toBe(true);
    for (const key of store.keys()) {
      expect(key).not.toBe(token);
      expect(key).not.toContain(token);
    }
  });

  it('cannot be reused (single-use): second consume returns null', async () => {
    const token = await createPasswordResetToken('user-123');
    expect(await consumePasswordResetToken(token)).toBe('user-123');
    expect(await consumePasswordResetToken(token)).toBeNull();
  });

  it('a wrong / never-issued token returns null', async () => {
    await createPasswordResetToken('user-123');
    expect(await consumePasswordResetToken('deadbeef'.repeat(8))).toBeNull();
  });

  it('an empty token returns null', async () => {
    expect(await consumePasswordResetToken('')).toBeNull();
  });
});

describe('email-change token (hash-at-rest, one-time)', () => {
  it('issue -> consume round-trips the { userId, newEmail } payload', async () => {
    const token = await createEmailChangeToken('user-7', 'new@x.com');
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await consumeEmailChangeToken(token)).toEqual({ userId: 'user-7', newEmail: 'new@x.com' });
  });

  it('stores ONLY sha256(token) as the key — never the raw token', async () => {
    const token = await createEmailChangeToken('user-7', 'new@x.com');
    expect(store.has(sha256(token))).toBe(true);
    for (const key of store.keys()) {
      expect(key).not.toContain(token);
    }
  });

  it('cannot be reused (single-use): second consume returns null', async () => {
    const token = await createEmailChangeToken('user-7', 'new@x.com');
    expect(await consumeEmailChangeToken(token)).toEqual({ userId: 'user-7', newEmail: 'new@x.com' });
    expect(await consumeEmailChangeToken(token)).toBeNull();
  });

  it('a wrong / never-issued token returns null', async () => {
    await createEmailChangeToken('user-7', 'new@x.com');
    expect(await consumeEmailChangeToken('deadbeef'.repeat(8))).toBeNull();
  });

  it('rejects a malformed payload (missing required fields)', async () => {
    //? Inject a token whose stored value is valid JSON but not the expected
    //? shape — the wrapper must fail closed to null.
    const token = 'a'.repeat(64);
    store.set(sha256(token), JSON.stringify({ userId: 'only-this' }));
    expect(await consumeEmailChangeToken(token)).toBeNull();
  });
});
