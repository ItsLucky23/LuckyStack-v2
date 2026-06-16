import Redis from 'ioredis';
import { getLogger, tryCatch, tryCatchSync } from '@luckystack/core';
import { getHealthStoreTtlSeconds } from './healthConfig';

//? Shared health state across multiple router instances.
//?
//? Key shape:  router:health:<envKey>:<service>  -> 'healthy' | 'unhealthy'
//? Channel:    router:health:events:<envKey>     -> JSON { service, healthy }
//?
//? Each router instance runs its own health poller. When an instance flips a
//? service's state, it writes the key AND publishes on the channel so sibling
//? routers update their in-memory view immediately (no poll delay).

export interface RedisHealthStoreInput {
  envKey: string;
  onExternalChange: (service: string, healthy: boolean) => void;
  /**
   * Override Redis connection. Falls back to REDIS_HOST + REDIS_PORT env vars.
   */
  redisHost?: string;
  redisPort?: number;
  redisPassword?: string;
  /**
   * TTL (seconds) for each health key. Defaults to the deploy-config
   * `routing.healthStoreTtlSeconds` (itself defaulting to 60s — see
   * `healthConfig.ts`). Injectable for testing.
   */
  ttlSeconds?: number;
}

export interface RedisHealthStore {
  hydrate: (services: string[]) => Promise<void>;
  set: (service: string, healthy: boolean) => Promise<void>;
  get: (service: string) => boolean;
  close: () => Promise<void>;
}

const healthKey = (envKey: string, service: string): string =>
  `router:health:${envKey}:${service}`;

const healthChannel = (envKey: string): string =>
  `router:health:events:${envKey}`;

export const createRedisHealthStore = async (
  input: RedisHealthStoreInput,
): Promise<RedisHealthStore> => {
  const host = input.redisHost ?? process.env.REDIS_HOST ?? '127.0.0.1';
  const port = input.redisPort ?? Number.parseInt(process.env.REDIS_PORT ?? '6379', 10);
  const password = input.redisPassword ?? process.env.REDIS_PASSWORD;
  //? Every health key gets a TTL so a router that dies without flipping a
  //? service back to healthy can't pin a stale verdict forever — the key
  //? expires and siblings revert to the absent-key default on the next read.
  //? A non-positive override is ignored in favour of the config/default so a
  //? key can never be written without an expiry.
  const ttlSeconds = (typeof input.ttlSeconds === 'number' && input.ttlSeconds > 0)
    ? input.ttlSeconds
    : getHealthStoreTtlSeconds();

  const client = new Redis({ host, port, password, lazyConnect: true });
  const subscriber = new Redis({ host, port, password, lazyConnect: true });

  //? Attach 'error' listeners before connecting: an ioredis client that emits
  //? 'error' with no listener throws as an unhandled exception and crashes the
  //? process (e.g. a mid-session Redis drop). Logging keeps the router alive.
  client.on('error', (err) => {
    getLogger().error('[router] health-store client Redis error', err);
  });
  subscriber.on('error', (err) => {
    getLogger().error('[router] health-store subscriber Redis error', err);
  });

  //? lazyConnect + explicit connect lets us hard-fail when Redis is down
  //? instead of silently buffering commands behind a retry loop.
  await client.connect();
  //? If the subscriber fails to connect, the already-connected `client` would
  //? leak its socket/FD. Disconnect it before propagating the failure.
  const [subscriberError] = await tryCatch(() => subscriber.connect());
  if (subscriberError) {
    client.disconnect();
    subscriber.disconnect();
    throw subscriberError;
  }

  const cache = new Map<string, boolean>();

  await subscriber.subscribe(healthChannel(input.envKey));
  subscriber.on('message', (channel, raw) => {
    if (channel !== healthChannel(input.envKey)) return;
    //? Ignore malformed messages. Another router's bug shouldn't crash us.
    const [parseError, parsed] = tryCatchSync(
      () => JSON.parse(raw) as { service?: string; healthy?: boolean },
    );
    if (parseError || !parsed) return;
    if (typeof parsed.service !== 'string' || typeof parsed.healthy !== 'boolean') return;
    cache.set(parsed.service, parsed.healthy);
    input.onExternalChange(parsed.service, parsed.healthy);
  });

  const hydrate = async (services: string[]): Promise<void> => {
    if (services.length === 0) return;
    const keys = services.map(service => healthKey(input.envKey, service));
    const values = await client.mget(...keys);
    for (const [i, service] of services.entries()) {
      const value = values[i];
      //? Default to healthy when the key is absent — pessimistic unhealthy
      //? would route every first request to fallback until the next poll.
      cache.set(service, value !== 'unhealthy');
    }
  };

  const set = async (service: string, healthy: boolean): Promise<void> => {
    cache.set(service, healthy);
    //? EX <ttl> stamps an expiry on every write so stale health self-heals.
    await client.set(
      healthKey(input.envKey, service),
      healthy ? 'healthy' : 'unhealthy',
      'EX',
      ttlSeconds,
    );
    await client.publish(
      healthChannel(input.envKey),
      JSON.stringify({ service, healthy }),
    );
  };

  const get = (service: string): boolean => cache.get(service) ?? true;

  const close = async (): Promise<void> => {
    //? Best-effort unsubscribe; a failure here must not block teardown.
    await tryCatch(() => subscriber.unsubscribe(healthChannel(input.envKey)));
    subscriber.disconnect();
    client.disconnect();
  };

  return { hydrate, set, get, close };
};
