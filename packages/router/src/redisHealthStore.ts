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

  //? Compute once; `input.envKey` never changes after construction, so
  //? recomputing the channel string on every pub/sub call is a gratuitous
  //? allocation. All four call sites below use this cached value.
  const channel = healthChannel(input.envKey);
  const cache = new Map<string, boolean>();

  await subscriber.subscribe(channel);
  subscriber.on('message', (msg, raw) => {
    if (msg !== channel) return;
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
      //? Skip services already in cache — a pub/sub notification could have
      //? arrived between `subscribe()` and the mget response (TOCTOU). The
      //? notification carries a more recent value; do not overwrite it.
      if (cache.has(service)) continue;
      const value = values[i];
      //? Default to healthy when the key is absent — pessimistic unhealthy
      //? would route every first request to fallback until the next poll.
      cache.set(service, value !== 'unhealthy');
    }
  };

  const set = async (service: string, healthy: boolean): Promise<void> => {
    //? Atomic MULTI/EXEC: the SET and PUBLISH must land together so a sibling
    //? router can never read the key before the pub/sub notification arrives
    //? (or vice-versa). Without the pipeline a partial failure (SET ok, then
    //? Redis drops the connection before PUBLISH) leaves siblings with a stale
    //? in-memory view that no future notification ever corrects.
    const results = await client
      .multi()
      .set(healthKey(input.envKey, service), healthy ? 'healthy' : 'unhealthy', 'EX', ttlSeconds)
      .publish(channel, JSON.stringify({ service, healthy }))
      .exec();
    //? Update local cache only after the durable write commits so a sibling
    //? querying our in-memory view (via getLocalHealth) agrees with Redis.
    //? MULTI/EXEC returns null when the transaction is aborted (EXECABORT —
    //? e.g. a WATCH-triggered optimistic concurrency failure on some Redis
    //? configurations). In that case the SET and PUBLISH were never executed:
    //? log the failure so operators can see it; do NOT update the local cache
    //? (which would disagree with Redis and potentially never self-correct).
    if (results === null) {
      getLogger().error('[router] health-store MULTI/EXEC aborted (EXECABORT) — health state may be stale', { service, healthy });
      return;
    }
    //? A non-null result is an array of [error, value] tuples — one per queued
    //? command. exec() resolves (not rejects) even when an individual command
    //? errors (e.g. SET under an OOM/maxmemory condition), surfacing the failure
    //? in that tuple's error slot. The durable write may not have landed, so
    //? treat a per-command error exactly like EXECABORT: log it and do NOT
    //? update the local cache, which would otherwise disagree with Redis and
    //? never self-correct.
    const commandError = results.find(([err]) => err)?.[0];
    if (commandError) {
      getLogger().error('[router] health-store MULTI/EXEC command failed — health state may be stale', { service, healthy, error: commandError });
      return;
    }
    cache.set(service, healthy);
  };

  const get = (service: string): boolean => cache.get(service) ?? true;

  const close = async (): Promise<void> => {
    //? Best-effort unsubscribe before quitting so Redis cleans up the
    //? subscriber slot. `quit()` sends a graceful QUIT command vs the
    //? hard-disconnect of `disconnect()` — prefer it on the shutdown path.
    await tryCatch(() => subscriber.unsubscribe(channel));
    await tryCatch(() => subscriber.quit());
    await tryCatch(() => client.quit());
  };

  return { hydrate, set, get, close };
};
