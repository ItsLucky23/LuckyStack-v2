import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

//? Mock ioredis so `new Redis(...)` never opens a socket. The mock keeps the
//? options object it was constructed with, which is what these tests assert on.
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

//? Imported AFTER the mock so redis.ts builds mock clients.
import { getRedisClient, resetClientsForTests } from './clients';
import { getRedisConnectionOptions, rebuildDefaultRedisClient, resetDefaultRedisClient } from './redis';
import { notifySecretsResolved } from './secretsResolved';

const originalHost = process.env.REDIS_HOST;
const originalPort = process.env.REDIS_PORT;

const hostOf = (client: ReturnType<typeof getRedisClient>): unknown => (client.options as { host?: unknown }).host;
const portOf = (client: ReturnType<typeof getRedisClient>): unknown => (client.options as { port?: unknown }).port;

describe('Redis host/port are read at call time, not from the frozen env snapshot (B9)', () => {
  beforeEach(() => {
    resetClientsForTests();
    resetDefaultRedisClient();
    process.env.REDIS_HOST = originalHost;
    process.env.REDIS_PORT = originalPort;
  });

  afterAll(() => {
    process.env.REDIS_HOST = originalHost;
    process.env.REDIS_PORT = originalPort;
  });

  it('getRedisConnectionOptions reflects a REDIS_HOST changed after module load', () => {
    process.env.REDIS_HOST = 'first-host.example.com';
    expect(getRedisConnectionOptions().host).toBe('first-host.example.com');

    //? The frozen `env` snapshot cannot change — so if this second read still
    //? returned the first value, the call-time read would be broken.
    process.env.REDIS_HOST = 'second-host.example.com';
    expect(getRedisConnectionOptions().host).toBe('second-host.example.com');
  });

  it('getRedisConnectionOptions reflects a REDIS_PORT changed after module load', () => {
    process.env.REDIS_PORT = '6380';
    expect(getRedisConnectionOptions().port).toBe(6380);

    process.env.REDIS_PORT = '6381';
    expect(getRedisConnectionOptions().port).toBe(6381);
  });

  it('a secret-manager pointer resolved after boot lands on the rebuilt client', () => {
    //? Boot state: REDIS_HOST is still an unresolved secret-manager pointer.
    //? It passes the Zod `min(1)` check, so nothing fails loudly — the client
    //? would just connect to a host literally named after the pointer.
    process.env.REDIS_HOST = 'REDIS_HOST_V1';
    const stale = rebuildDefaultRedisClient();
    expect(hostOf(stale)).toBe('REDIS_HOST_V1');

    //? secret-manager resolves the pointer into process.env, then fires the
    //? decoupled channel. The listener rebuilds + re-registers the client.
    process.env.REDIS_HOST = 'real-redis.internal';
    notifySecretsResolved(['REDIS_HOST']);

    expect(hostOf(getRedisClient())).toBe('real-redis.internal');
  });

  it('a resolved REDIS_PORT also lands on the rebuilt client', () => {
    process.env.REDIS_PORT = '6379';
    rebuildDefaultRedisClient();

    process.env.REDIS_PORT = '6390';
    notifySecretsResolved(['REDIS_PORT']);

    expect(portOf(getRedisClient())).toBe(6390);
  });

  it('falls back to the validated snapshot when REDIS_HOST is emptied', () => {
    //? `||` (not `??`) is deliberate: an empty string must lose to the Zod-
    //? validated default rather than be passed to ioredis as a blank host.
    process.env.REDIS_HOST = '';
    const { host } = getRedisConnectionOptions();
    expect(host).toBeTruthy();
    expect(host).not.toBe('');
  });

  it('constructRedisClient and getRedisConnectionOptions agree on host/port', () => {
    //? These are two independent read sites (the default client vs the options
    //? the router reuses for cross-env probes). They must not drift.
    process.env.REDIS_HOST = 'agreement-host.example.com';
    process.env.REDIS_PORT = '6399';

    const client = rebuildDefaultRedisClient();
    const options = getRedisConnectionOptions();

    expect(hostOf(client)).toBe(options.host);
    expect(portOf(client)).toBe(options.port);
    expect(options.host).toBe('agreement-host.example.com');
    expect(options.port).toBe(6399);
  });
});
