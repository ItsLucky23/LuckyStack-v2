//? Prisma + Redis client registries. Lets consumers swap the framework's
//? default clients (TLS, Accelerate, custom logger, sentinel, ...) without
//? touching framework code.
//?
//? Keyed by slot: the reserved `'default'` slot backs every framework
//? internal (sessions, rate-limit, presence) and the `prisma`/`redis`
//? proxies. Additional slots are opt-in and only reachable via
//? `getPrismaClientFor(key)` / `getRedisClientFor(key)`, so a consumer can run
//? graded credentials side by side — e.g. a read-only client on `'ro'` and a
//? read-write client on `'rw'`, or one client per tenant.
//?
//? `db.ts` and `redis.ts` re-export `prisma` and `redis` as Proxy objects that
//? forward every operation to the currently registered default client (or a
//? lazy default if nothing was registered). All existing call sites that do
//? `import { prisma } from '@luckystack/core'` or `import { redis } from '@luckystack/core'`
//? keep working unchanged — they resolve the `'default'` slot.

import type { PrismaClient } from '@prisma/client';
import type { Redis as RedisClient } from 'ioredis';

//? Reserved slot consumed by every framework internal and the proxies. A
//? no-key registration / lookup targets this slot, preserving the original
//? single-client behavior.
export const DEFAULT_CLIENT_KEY = 'default';

const prismaClients = new Map<string, PrismaClient>();
const redisClients = new Map<string, RedisClient>();

export const registerPrismaClient = (client: PrismaClient, key = DEFAULT_CLIENT_KEY): PrismaClient => {
  prismaClients.set(key, client);
  return client;
};

export const registerRedisClient = (client: RedisClient, key = DEFAULT_CLIENT_KEY): RedisClient => {
  redisClients.set(key, client);
  return client;
};

//? Boot guards check the DEFAULT slot only — a keyed-only registration does
//? not count as "the framework has a client", because internals use default.
export const isPrismaClientRegistered = (): boolean => prismaClients.has(DEFAULT_CLIENT_KEY);
export const isRedisClientRegistered = (): boolean => redisClients.has(DEFAULT_CLIENT_KEY);

//? Diagnostic: which slots have an explicitly-registered client.
export const getPrismaClientKeys = (): string[] => [...prismaClients.keys()];
export const getRedisClientKeys = (): string[] => [...redisClients.keys()];

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

//? Resolve a specific slot. The `'default'` slot falls back to the lazy
//? default resolver when nothing was registered; any other slot throws when
//? unregistered — a keyed lookup must NEVER silently hand back the privileged
//? default client, as that would defeat the point of graded credentials.
export const getPrismaClientFor = (key = DEFAULT_CLIENT_KEY): PrismaClient => {
  const client = prismaClients.get(key);
  if (client) return client;
  if (key === DEFAULT_CLIENT_KEY && defaultPrismaResolver) return defaultPrismaResolver();
  throw new Error(
    key === DEFAULT_CLIENT_KEY
      ? 'No Prisma client available. Either register one via registerPrismaClient(), ' +
        'or import "@luckystack/core" from a context where the default resolver was set.'
      : `No Prisma client registered for slot "${key}". Register one via registerPrismaClient(client, "${key}").`
  );
};

export const getRedisClientFor = (key = DEFAULT_CLIENT_KEY): RedisClient => {
  const client = redisClients.get(key);
  if (client) return client;
  if (key === DEFAULT_CLIENT_KEY && defaultRedisResolver) return defaultRedisResolver();
  throw new Error(
    key === DEFAULT_CLIENT_KEY
      ? 'No Redis client available. Either register one via registerRedisClient(), ' +
        'or import "@luckystack/core" from a context where the default resolver was set.'
      : `No Redis client registered for slot "${key}". Register one via registerRedisClient(client, "${key}").`
  );
};

export const getPrismaClient = (): PrismaClient => getPrismaClientFor(DEFAULT_CLIENT_KEY);
export const getRedisClient = (): RedisClient => getRedisClientFor(DEFAULT_CLIENT_KEY);

//? Test-only: drop every registered slot. The default resolvers (set once at
//? module load by db.ts / redis.ts) stay in place.
export const resetClientsForTests = (): void => {
  prismaClients.clear();
  redisClients.clear();
};
