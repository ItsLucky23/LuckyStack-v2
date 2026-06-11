/* eslint-disable @typescript-eslint/no-misused-promises, @typescript-eslint/require-await */

import Redis from 'ioredis';
import type { Redis as RedisClient } from 'ioredis';
import { env } from './env';
import { getRedisClient, setDefaultRedisResolver } from './clients';
import { getLogger } from './loggerRegistry';
import { applyStrayKeyPrefix } from './redisKeyFormatter';

let cachedDefault: RedisClient | null = null;

//? Stop reconnecting after this many consecutive failures so a permanently
//? unreachable / misconfigured Redis (bad creds, wrong host) doesn't hammer
//? forever. With the capped backoff below this is ~1 minute of attempts —
//? long enough to ride out a transient blip, short enough to surface a real
//? outage. A process manager / the dev supervisor restarts the process, which
//? re-resolves a corrected `.env`. Raise it for longer outage tolerance.
const MAX_REDIS_RECONNECT_ATTEMPTS = 50;

const buildDefaultRedisClient = (): RedisClient => {
  if (cachedDefault) return cachedDefault;

  cachedDefault = new Redis({
    host: env.REDIS_HOST,
    port: Number.parseInt(env.REDIS_PORT, 10),
    ...(process.env.REDIS_USER && { username: process.env.REDIS_USER }),
    ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),

    retryStrategy(times) {
      if (times > MAX_REDIS_RECONNECT_ATTEMPTS) {
        getLogger().error(
          `Redis unreachable after ${String(MAX_REDIS_RECONNECT_ATTEMPTS)} reconnect attempts; giving up. Check REDIS_HOST / REDIS_PORT / credentials and that Redis is reachable.`,
        );
        return null;
      }
      return Math.min(times * 50, 2000);
    },
  });

  //? `ready` (not `connect`): `connect` fires on TCP connect BEFORE the AUTH
  //? handshake, so logging there reports success even when credentials are
  //? wrong. `ready` fires only after AUTH succeeds.
  cachedDefault.on('ready', async () => {
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
  ...(process.env.REDIS_USER ? { username: process.env.REDIS_USER } : {}),
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

//? Extend the set of single-key, arg0-is-key commands the `redis` proxy runs
//? through `applyStrayKeyPrefix`. Additive — the built-in set above is always
//? retained — so a consumer using a Redis command the framework's default
//? list doesn't cover (a newer/module command whose first argument is the
//? key) can opt it into the multi-tenant stray-prefix net without forking.
//? Command names are matched case-insensitively, mirroring the proxy lookup.
//? Variadic / non-arg0-key commands must NOT be registered here — their key
//? positions can't be inferred safely; use `formatKey()` explicitly instead.
export const registerStrayPrefixCommand = (...commands: string[]): void => {
  for (const command of commands) {
    STRAY_PREFIX_COMMANDS.add(command.toLowerCase());
  }
};

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
