import { describe, it, expect, beforeEach, vi } from 'vitest';

//? Mock ioredis so `new Redis(...)` never opens a socket. Each construction is a
//? distinct object, so we can assert identity to detect an eager rebuild.
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
import { getRedisClient, isRedisClientRegistered, registerRedisClient, resetClientsForTests } from './clients';
import { rebuildDefaultRedisClient, resetDefaultRedisClient } from './redis';
import { notifySecretsResolved } from './secretsResolved';

describe('default Redis client rebuild on secret resolution (FIX-1, ADR 0026)', () => {
  beforeEach(() => {
    resetClientsForTests(); // drop any registered default from a prior test
    resetDefaultRedisClient(); // drop the resolver's cached client
  });

  it('rebuildDefaultRedisClient registers a fresh client that wins over the resolver', () => {
    const before = getRedisClient(); // resolver path (not registered yet)
    expect(isRedisClientRegistered()).toBe(false);

    const rebuilt = rebuildDefaultRedisClient();

    expect(isRedisClientRegistered()).toBe(true); // now a registered default
    expect(rebuilt).not.toBe(before); // a genuinely fresh client
    expect(getRedisClient()).toBe(rebuilt); // the registered one wins
  });

  it('the secrets-resolved hook eagerly rebuilds + registers when a REDIS_ key changed', () => {
    const before = getRedisClient();
    notifySecretsResolved(['REDIS_PASSWORD']);
    expect(isRedisClientRegistered()).toBe(true);
    expect(getRedisClient()).not.toBe(before);
  });

  it('rebuilds defensively when the changed keys are unknown (undefined)', () => {
    const before = getRedisClient();
    notifySecretsResolved();
    expect(getRedisClient()).not.toBe(before);
  });

  it('does NOT rebuild when only a non-Redis secret changed', () => {
    const before = getRedisClient();
    notifySecretsResolved(['DATABASE_URL', 'OPENAI_KEY']);
    expect(getRedisClient()).toBe(before);
    expect(isRedisClientRegistered()).toBe(false);
  });

  it('preserves a consumer-registered default client across automatic secret refresh', () => {
    const custom = getRedisClient();
    registerRedisClient(custom);
    notifySecretsResolved(['REDIS_PASSWORD']);

    expect(getRedisClient()).toBe(custom);
    expect(isRedisClientRegistered()).toBe(true);
  });
});
