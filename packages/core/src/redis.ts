/* eslint-disable @typescript-eslint/no-misused-promises, @typescript-eslint/require-await */

import Redis from 'ioredis';
import type { Redis as RedisClient } from 'ioredis';
import { env } from './env';
import { getRedisClient, setDefaultRedisResolver } from './clients';
import { getLogger } from './loggerRegistry';

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

//? Proxy: same pattern as `prisma`. Defers resolution until call time so
//? `registerRedisClient(...)` can still win after this module is loaded.
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Proxy target placeholder
const redisProxy = new Proxy({} as RedisClient, {
  get: (_target, prop, receiver) => {
    const real = getRedisClient() as object;
    const value: unknown = Reflect.get(real, prop, receiver);
    if (typeof value === 'function') {
      return (value as (...args: unknown[]) => unknown).bind(real);
    }
    return value;
  },
  has: (_target, prop) => Reflect.has(getRedisClient() as object, prop),
});

export const redis = redisProxy;
export default redisProxy;
