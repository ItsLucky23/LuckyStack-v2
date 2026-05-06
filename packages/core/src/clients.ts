//? Prisma + Redis client registries. Lets consumers swap the framework's
//? default clients (TLS, Accelerate, custom logger, sentinel, ...) without
//? touching framework code.
//?
//? `db.ts` and `redis.ts` re-export `prisma` and `redis` as Proxy objects that
//? forward every operation to the currently registered client (or a lazy
//? default if nothing was registered). All existing call sites that do
//? `import { prisma } from '@luckystack/core'` or `import { redis } from '@luckystack/core'`
//? keep working unchanged.

import type { PrismaClient } from '@prisma/client';
import type { Redis as RedisClient } from 'ioredis';

let registeredPrisma: PrismaClient | null = null;
let registeredRedis: RedisClient | null = null;

export const registerPrismaClient = (client: PrismaClient): PrismaClient => {
  registeredPrisma = client;
  return registeredPrisma;
};

export const registerRedisClient = (client: RedisClient): RedisClient => {
  registeredRedis = client;
  return registeredRedis;
};

export const isPrismaClientRegistered = (): boolean => registeredPrisma !== null;
export const isRedisClientRegistered = (): boolean => registeredRedis !== null;

//? `db.ts` and `redis.ts` set these accessors at module load with the lazy
//? defaults. Splitting registration from default construction keeps a hard
//? type dependency on `@prisma/client` / `ioredis` out of this file.
let defaultPrismaResolver: (() => PrismaClient) | null = null;
let defaultRedisResolver: (() => RedisClient) | null = null;

export const setDefaultPrismaResolver = (resolver: () => PrismaClient): void => {
  defaultPrismaResolver = resolver;
};

export const setDefaultRedisResolver = (resolver: () => RedisClient): void => {
  defaultRedisResolver = resolver;
};

export const getPrismaClient = (): PrismaClient => {
  if (registeredPrisma) return registeredPrisma;
  if (defaultPrismaResolver) return defaultPrismaResolver();
  throw new Error(
    'No Prisma client available. Either register one via registerPrismaClient(), ' +
    'or import "@luckystack/core" from a context where the default resolver was set.'
  );
};

export const getRedisClient = (): RedisClient => {
  if (registeredRedis) return registeredRedis;
  if (defaultRedisResolver) return defaultRedisResolver();
  throw new Error(
    'No Redis client available. Either register one via registerRedisClient(), ' +
    'or import "@luckystack/core" from a context where the default resolver was set.'
  );
};
