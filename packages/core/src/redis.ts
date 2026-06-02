/* eslint-disable @typescript-eslint/no-misused-promises, @typescript-eslint/require-await */

import Redis from 'ioredis';
import type { Redis as RedisClient } from 'ioredis';
import { env } from './env';
import { getRedisClient, setDefaultRedisResolver } from './clients';
import { getLogger } from './loggerRegistry';
import { applyStrayKeyPrefix } from './redisKeyFormatter';

let cachedDefault: RedisClient | null = null;

const buildDefaultRedisClient = (): RedisClient => {
  if (cachedDefault) return cachedDefault;

  cachedDefault = new Redis({
    host: env.REDIS_HOST,
    port: Number.parseInt(env.REDIS_PORT, 10),
    ...(process.env.REDIS_USERNAME && { username: process.env.REDIS_USERNAME }),
    ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),

    retryStrategy(times) {
      return Math.min(times * 50, 2000);
    },
  });

  cachedDefault.on('connect', async () => {
    getLogger().info('Connected to Redis');
  });

  cachedDefault.on('error', (err) => {
    getLogger().error('Error connecting to Redis', err);
  });

  return cachedDefault;
};

setDefaultRedisResolver(buildDefaultRedisClient);

//? Single source of truth for Redis connection params. Used by
//? `@luckystack/router`'s bootHandshake (which opens its own short-lived
//? connections for cross-env probes) so a config rename touches only this
//? file. Reads env at call time so dotenv timing doesn't capture a stale
//? value.
export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export const getRedisConnectionOptions = (): RedisConnectionOptions => ({
  host: env.REDIS_HOST,
  port: Number.parseInt(env.REDIS_PORT, 10),
  ...(process.env.REDIS_USERNAME ? { username: process.env.REDIS_USERNAME } : {}),
  ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
});

//? Single-key commands whose FIRST argument is the key. The proxy runs that
//? argument through `applyStrayKeyPrefix` as a best-effort namespace net for
//? raw app keys; already-namespaced keys (anything containing `:`, which is
//? every framework key) pass through untouched, so framework behavior is
//? unchanged. Variadic / non-arg0-key commands (`del`, `scan`, `eval`,
//? `multi`, `mget`, ...) are deliberately excluded — their key positions can't
//? be inferred safely; those call sites use `formatKey()` explicitly.
const STRAY_PREFIX_COMMANDS = new Set<string>([
  'get', 'set', 'setex', 'psetex', 'setnx', 'getset', 'getdel', 'append', 'strlen',
  'expire', 'pexpire', 'expireat', 'pexpireat', 'persist', 'ttl', 'pttl', 'type',
  'incr', 'incrby', 'incrbyfloat', 'decr', 'decrby',
  'sadd', 'srem', 'smembers', 'scard', 'sismember', 'spop', 'srandmember',
  'hget', 'hset', 'hdel', 'hgetall', 'hkeys', 'hvals', 'hexists', 'hincrby', 'hmget', 'hmset',
  'lpush', 'rpush', 'lpop', 'rpop', 'llen', 'lrange', 'lrem',
  'zadd', 'zrem', 'zscore', 'zrange', 'zrank', 'zcard',
  'getbit', 'setbit', 'bitcount',
]);

//? Proxy: same pattern as `prisma`. Defers resolution until call time so
//? `registerRedisClient(...)` can still win after this module is loaded.
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Proxy target placeholder
const redisProxy = new Proxy({} as RedisClient, {
  get: (_target, prop, receiver) => {
    const real = getRedisClient() as object;
    const value: unknown = Reflect.get(real, prop, receiver);
    if (typeof value !== 'function') return value;
    const fn = value as (...args: unknown[]) => unknown;
    if (typeof prop === 'string' && STRAY_PREFIX_COMMANDS.has(prop.toLowerCase())) {
      return (...args: unknown[]): unknown => {
        if (args.length > 0 && typeof args[0] === 'string') {
          args[0] = applyStrayKeyPrefix(args[0]);
        }
        return fn.apply(real, args);
      };
    }
    return fn.bind(real);
  },
  has: (_target, prop) => Reflect.has(getRedisClient(), prop),
});

export const redis = redisProxy;
export default redisProxy;
