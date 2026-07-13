import { describe, it, expect, vi } from 'vitest';

//? Mock ioredis so `new Redis(...)` never opens a socket. Each construction is a
//? distinct object, so we can assert identity to detect a rebuild-after-reset.
vi.mock('ioredis', () => {
  class MockRedis {
    constructor(public options: unknown) {}
    on(): this {
      return this;
    }
    disconnect(): void {
      //? no-op
    }
  }
  return { default: MockRedis };
});

//? Imported AFTER the mock so redis.ts builds mock clients. Importing redis.ts
//? runs its module side effects: it registers the default resolver AND the
//? secrets-resolved listener under test.
import { getRedisClient } from './clients';
import { resetDefaultRedisClient } from './redis';
import { notifySecretsResolved } from './secretsResolved';

describe('default Redis client reset on secret resolution (FIX-1)', () => {
  it('rebuilds the cached default client when a REDIS_ credential changed', () => {
    resetDefaultRedisClient();
    const first = getRedisClient();
    expect(getRedisClient()).toBe(first); // cached until something resets it

    notifySecretsResolved(['REDIS_PASSWORD']);

    expect(getRedisClient()).not.toBe(first); // rebuilt from the resolved env
  });

  it('resets defensively when the changed keys are unknown (undefined)', () => {
    resetDefaultRedisClient();
    const first = getRedisClient();
    notifySecretsResolved();
    expect(getRedisClient()).not.toBe(first);
  });

  it('does NOT rebuild when only a non-Redis secret changed', () => {
    resetDefaultRedisClient();
    const first = getRedisClient();
    notifySecretsResolved(['DATABASE_URL', 'OPENAI_KEY']);
    expect(getRedisClient()).toBe(first);
  });
});
