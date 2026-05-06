import './env';
import { PrismaClient } from '@prisma/client';
import { getPrismaClient, setDefaultPrismaResolver } from './clients';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

//? Lazy default: only constructed when the proxy is first accessed AND no
//? consumer has registered their own Prisma client. Avoids paying the
//? PrismaClient construction cost in code paths that swap it out at boot.
const buildDefaultPrismaClient = (): PrismaClient => {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient();
  }
  return globalForPrisma.prisma;
};

setDefaultPrismaResolver(buildDefaultPrismaClient);

if (process.env.NODE_ENV !== 'production') {
  // Eager-init in dev so HMR sees a single Prisma instance across reloads.
  buildDefaultPrismaClient();
}

//? Proxy forwards every read/call to whichever client is active *at access
//? time*, so a `registerPrismaClient(...)` performed after this module is
//? imported still wins.
export const prisma = new Proxy({} as PrismaClient, {
  get: (_target, prop, receiver) => Reflect.get(getPrismaClient() as object, prop, receiver),
  has: (_target, prop) => Reflect.has(getPrismaClient() as object, prop),
  ownKeys: () => Reflect.ownKeys(getPrismaClient() as object),
  getOwnPropertyDescriptor: (_target, prop) =>
    Reflect.getOwnPropertyDescriptor(getPrismaClient() as object, prop),
}) as PrismaClient;
