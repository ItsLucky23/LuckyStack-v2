import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

//? In-memory Redis fake exercising the SET-with-EX + MULTI(GET, DEL) path the
//? primitive uses. Keyed by the HASHED key the module computes, so the test also
//? asserts the raw token is never the stored key (hash-at-rest guarantee).
//? `vi.hoisted` so the fake exists before the hoisted `vi.mock` factory runs.
const { store, fakeRedis } = vi.hoisted(() => {
  const store = new Map<string, string>();
  const fakeRedis = {
    set: vi.fn((key: string, value: string, _ex: string, _ttl: number) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    multi: () => {
      let pendingKey = '';
      const chain = {
        get(key: string) {
          pendingKey = key;
          return chain;
        },
        del(_key: string) {
          return chain;
        },
        exec(): Promise<[Error | null, unknown][]> {
          const value = store.get(pendingKey);
          store.delete(pendingKey);
          return Promise.resolve([[null, value ?? null]]);
        },
      };
      return chain;
    },
  };
  return { store, fakeRedis };
});

vi.mock('./redis', () => ({ default: fakeRedis, redis: fakeRedis }));

import {
  issueOneTimeToken,
  consumeOneTimeToken,
  consumeOneTimeTokenJson,
  oneTimeTokenKey,
} from './oneTimeToken';
import { formatKey } from './redisKeyFormatter';

const NS = '-otp-test';

afterEach(() => {
  store.clear();
  fakeRedis.set.mockClear();
});

describe('issueOneTimeToken', () => {
  it('returns a 64-char hex raw token and stores ONLY its sha256 hash as the key', async () => {
    const handle = issueOneTimeToken(NS, 3600, 'user-123');
    expect(handle.token).toMatch(/^[0-9a-f]{64}$/);
    await handle.store();

    const expectedHash = createHash('sha256').update(handle.token).digest('hex');
    const expectedKey = formatKey(NS, expectedHash);
    expect(oneTimeTokenKey(NS, handle.token)).toBe(expectedKey);
    expect(fakeRedis.set).toHaveBeenCalledWith(expectedKey, 'user-123', 'EX', 3600);

    // The RAW token never appears in any stored key (hash-at-rest).
    for (const key of store.keys()) {
      expect(key).not.toContain(handle.token);
    }
  });

  it('does not touch Redis until store() is called', () => {
    issueOneTimeToken(NS, 3600, 'user-123');
    expect(fakeRedis.set).not.toHaveBeenCalled();
  });

  it('JSON-stringifies an object payload', async () => {
    const handle = issueOneTimeToken(NS, 60, { userId: 'u1', newEmail: 'a@b.c' });
    await handle.store();
    const stored = store.get(oneTimeTokenKey(NS, handle.token));
    expect(stored).toBe(JSON.stringify({ userId: 'u1', newEmail: 'a@b.c' }));
  });
});

describe('consumeOneTimeToken (round-trip)', () => {
  it('issue -> consume returns the payload', async () => {
    const handle = issueOneTimeToken(NS, 3600, 'user-123');
    await handle.store();
    expect(await consumeOneTimeToken(NS, handle.token)).toBe('user-123');
  });

  it('a consumed token can NOT be reused (single MULTI get+del)', async () => {
    const handle = issueOneTimeToken(NS, 3600, 'user-123');
    await handle.store();
    expect(await consumeOneTimeToken(NS, handle.token)).toBe('user-123');
    expect(await consumeOneTimeToken(NS, handle.token)).toBeNull();
  });

  it('a wrong / never-issued token fails (returns null)', async () => {
    const handle = issueOneTimeToken(NS, 3600, 'user-123');
    await handle.store();
    expect(await consumeOneTimeToken(NS, 'deadbeef'.repeat(8))).toBeNull();
  });

  it('an empty / non-string token returns null without hitting Redis', async () => {
    expect(await consumeOneTimeToken(NS, '')).toBeNull();
    //? A non-string value reaching the consume guard at runtime (defensive: the
    //? token usually arrives un-typed from a URL query param) is rejected too.
    const nonStringToken = 12_345 as unknown;
    expect(await consumeOneTimeToken(NS, nonStringToken as string)).toBeNull();
  });

  it('a token issued in one namespace is not redeemable in another', async () => {
    const handle = issueOneTimeToken(NS, 3600, 'user-123');
    await handle.store();
    expect(await consumeOneTimeToken('-other-ns', handle.token)).toBeNull();
  });
});

describe('consumeOneTimeTokenJson', () => {
  it('round-trips an object payload', async () => {
    const handle = issueOneTimeToken(NS, 3600, { userId: 'u1', newEmail: 'a@b.c' });
    await handle.store();
    expect(await consumeOneTimeTokenJson<{ userId: string; newEmail: string }>(NS, handle.token)).toEqual({
      userId: 'u1',
      newEmail: 'a@b.c',
    });
  });

  it('returns null on a malformed (non-JSON) stored payload', async () => {
    const handle = issueOneTimeToken(NS, 3600, 'not-json');
    await handle.store();
    expect(await consumeOneTimeTokenJson(NS, handle.token)).toBeNull();
  });
});
