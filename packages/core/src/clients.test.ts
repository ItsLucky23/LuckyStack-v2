import { beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis as RedisClient } from 'ioredis';
import {
  DEFAULT_CLIENT_KEY,
  getPrismaClient,
  getPrismaClientFor,
  getPrismaClientKeys,
  getRedisClient,
  getRedisClientFor,
  getRedisClientKeys,
  isPrismaClientRegistered,
  isRedisClientRegistered,
  registerPrismaClient,
  registerRedisClient,
  resetClientsForTests,
} from './clients';

//? Opaque client stubs: the registry only stores + returns the reference, so
//? a distinct empty object asserted to the client type is enough to test slot
//? routing + identity. Mirrors the proxy-placeholder pattern in db.ts/redis.ts.
const stubPrisma = (): PrismaClient => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- opaque client placeholder; tests assert reference identity only
  return {} as PrismaClient;
};
const stubRedis = (): RedisClient => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- opaque client placeholder; tests assert reference identity only
  return {} as RedisClient;
};

describe('client registry (keyed)', () => {
  beforeEach(() => {
    resetClientsForTests();
  });

  describe('default slot — backwards compatibility', () => {
    it('a no-key registration is reachable via getPrismaClient() and the default slot', () => {
      const client = registerPrismaClient(stubPrisma());
      expect(getPrismaClient()).toBe(client);
      expect(getPrismaClientFor()).toBe(client);
      expect(getPrismaClientFor(DEFAULT_CLIENT_KEY)).toBe(client);
      expect(isPrismaClientRegistered()).toBe(true);
    });

    it('mirrors for Redis', () => {
      const client = registerRedisClient(stubRedis());
      expect(getRedisClient()).toBe(client);
      expect(getRedisClientFor()).toBe(client);
      expect(isRedisClientRegistered()).toBe(true);
    });

    it('last-write-wins within a slot', () => {
      registerPrismaClient(stubPrisma());
      const second = registerPrismaClient(stubPrisma());
      expect(getPrismaClient()).toBe(second);
    });
  });

  describe('keyed slots — graded credentials', () => {
    it('keeps separate clients per slot', () => {
      const ro = registerPrismaClient(stubPrisma(), 'ro');
      const rw = registerPrismaClient(stubPrisma(), 'rw');
      expect(getPrismaClientFor('ro')).toBe(ro);
      expect(getPrismaClientFor('rw')).toBe(rw);
      expect(getPrismaClientFor('ro')).not.toBe(getPrismaClientFor('rw'));
    });

    it('mirrors for Redis', () => {
      const ro = registerRedisClient(stubRedis(), 'ro');
      const rw = registerRedisClient(stubRedis(), 'rw');
      expect(getRedisClientFor('ro')).toBe(ro);
      expect(getRedisClientFor('rw')).toBe(rw);
      expect(getRedisClientFor('ro')).not.toBe(getRedisClientFor('rw'));
    });

    it('lists registered slot names', () => {
      registerPrismaClient(stubPrisma(), 'ro');
      registerPrismaClient(stubPrisma(), 'rw');
      registerRedisClient(stubRedis(), 'cache');
      expect(getPrismaClientKeys().sort()).toEqual(['ro', 'rw']);
      expect(getRedisClientKeys()).toEqual(['cache']);
    });

    it('a keyed-only registration does NOT count as the default being registered', () => {
      registerPrismaClient(stubPrisma(), 'ro');
      expect(isPrismaClientRegistered()).toBe(false);
    });
  });

  describe('unregistered lookups throw (no silent fallback)', () => {
    it('throws for an unknown slot, naming it', () => {
      expect(() => getPrismaClientFor('ro')).toThrow(/slot "ro"/);
      expect(() => getRedisClientFor('cache')).toThrow(/slot "cache"/);
    });

    it('throws for the default slot when neither registration nor resolver exists', () => {
      //? Importing only ./clients (not db.ts/redis.ts) leaves the lazy default
      //? resolvers unset, so the default slot has nothing to fall back to.
      expect(() => getPrismaClient()).toThrow(/No Prisma client available/);
      expect(() => getRedisClient()).toThrow(/No Redis client available/);
    });
  });

  describe('resetClientsForTests', () => {
    it('drops every registered slot', () => {
      registerPrismaClient(stubPrisma());
      registerPrismaClient(stubPrisma(), 'ro');
      registerRedisClient(stubRedis(), 'cache');
      resetClientsForTests();
      expect(isPrismaClientRegistered()).toBe(false);
      expect(getPrismaClientKeys()).toEqual([]);
      expect(getRedisClientKeys()).toEqual([]);
    });
  });
});
