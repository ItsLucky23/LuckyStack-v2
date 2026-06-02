import './env';
import { PrismaClient } from '@prisma/client';
import { getPrismaClient, setDefaultPrismaResolver } from './clients';

declare global {
  // eslint-disable-next-line no-var
  var __luckystackPrisma: PrismaClient | undefined;
}

//? Lazy default: only constructed when the proxy is first accessed AND no
//? consumer has registered their own Prisma client. Avoids paying the
//? PrismaClient construction cost in code paths that swap it out at boot.
const buildDefaultPrismaClient = (): PrismaClient => {
  globalThis.__luckystackPrisma ??= new PrismaClient();
  return globalThis.__luckystackPrisma;
};

setDefaultPrismaResolver(buildDefaultPrismaClient);

if (process.env.NODE_ENV !== 'production') {
  // Eager-init in dev so HMR sees a single Prisma instance across reloads.
  buildDefaultPrismaClient();
}

//? Proxy forwards every read/call to whichever client is active *at access
//? time*, so a `registerPrismaClient(...)` performed after this module is
//? imported still wins. The empty-object Proxy target needs an `as` cast
//? because the target is never read directly — every access is intercepted.
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Proxy target placeholder
export const prisma = new Proxy({} as PrismaClient, {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- Reflect.get must forward `unknown`/`any` through to satisfy the Proxy handler contract
  get: (_target, prop, receiver) => Reflect.get(getPrismaClient(), prop, receiver),
  has: (_target, prop) => Reflect.has(getPrismaClient(), prop),
  ownKeys: () => Reflect.ownKeys(getPrismaClient()),
  getOwnPropertyDescriptor: (_target, prop) =>
    Reflect.getOwnPropertyDescriptor(getPrismaClient(), prop),
});
