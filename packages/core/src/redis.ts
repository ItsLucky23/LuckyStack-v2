/* eslint-disable @typescript-eslint/no-misused-promises, @typescript-eslint/require-await */

import Redis from 'ioredis';
import type { Redis as RedisClient } from 'ioredis';
import { env } from './env';
import { getRedisClient, setDefaultRedisResolver } from './clients';

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
    console.log('Connected to Redis');
  });

  cachedDefault.on('error', (err) => {
    console.error('Error connecting to Redis:', err);
  });

  return cachedDefault;
};

setDefaultRedisResolver(buildDefaultRedisClient);

//? Proxy: same pattern as `prisma`. Defers resolution until call time so
//? `registerRedisClient(...)` can still win after this module is loaded.
const redisProxy = new Proxy({} as RedisClient, {
  get: (_target, prop, receiver) => {
    const real = getRedisClient() as object;
    const value = Reflect.get(real, prop, receiver);
    return typeof value === 'function' ? (value as Function).bind(real) : value;
  },
  has: (_target, prop) => Reflect.has(getRedisClient() as object, prop),
});

export const redis = redisProxy;
export default redisProxy;
