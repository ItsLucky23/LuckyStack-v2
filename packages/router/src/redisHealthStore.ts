import Redis from 'ioredis';

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

  const client = new Redis({ host, port, password, lazyConnect: true });
  const subscriber = new Redis({ host, port, password, lazyConnect: true });

  //? lazyConnect + explicit connect lets us hard-fail when Redis is down
  //? instead of silently buffering commands behind a retry loop.
  await client.connect();
  await subscriber.connect();

  const cache = new Map<string, boolean>();

  await subscriber.subscribe(healthChannel(input.envKey));
  subscriber.on('message', (channel, raw) => {
    if (channel !== healthChannel(input.envKey)) return;
    try {
      const parsed = JSON.parse(raw) as { service?: string; healthy?: boolean };
      if (typeof parsed.service !== 'string' || typeof parsed.healthy !== 'boolean') return;
      cache.set(parsed.service, parsed.healthy);
      input.onExternalChange(parsed.service, parsed.healthy);
    } catch {
      //? Ignore malformed messages. Another router's bug shouldn't crash us.
    }
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
    await client.set(healthKey(input.envKey, service), healthy ? 'healthy' : 'unhealthy');
    await client.publish(
      healthChannel(input.envKey),
      JSON.stringify({ service, healthy }),
    );
  };

  const get = (service: string): boolean => cache.get(service) ?? true;

  const close = async (): Promise<void> => {
    try { await subscriber.unsubscribe(healthChannel(input.envKey)); } catch { /* noop */ }
    subscriber.disconnect();
    client.disconnect();
  };

  return { hydrate, set, get, close };
};
