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

//? No eager dev init: the `globalThis.__luckystackPrisma` cache already
//? guarantees a single Prisma instance across HMR reloads on first proxy
//? access, so constructing it at import time only burdens tools/CLIs/tests that
//? type-import core but never touch the DB (the package's "no import-time side
//? effects" doctrine).

//? Proxy forwards every read/call to whichever client is active *at access
//? time*, so a `registerPrismaClient(...)` performed after this module is
//? imported still wins. The empty-object Proxy target needs an `as` cast
//? because the target is never read directly — every access is intercepted.
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Proxy target placeholder
export const prisma = new Proxy({} as PrismaClient, {
  //? Bind methods to the real client so a CAPTURED method keeps its `this`.
  //? Without binding, a detached call (`const q = prisma.$queryRaw; q(...)`)
  //? runs with `this === undefined` and Prisma's internal `this`-access throws
  //? — exactly how the `/readyz` prisma ping silently failed (it captures
  //? `$runCommandRaw` / `$queryRaw` into a local before calling, so the ping
  //? always threw → `prisma: false` → 503, even with the DB reachable).
  //? Mirrors the `redis` proxy. Non-function reads (model delegates like
  //? `prisma.user`) pass through untouched, so their methods bind to the
  //? delegate as before.
  get: (_target, prop, receiver) => {
    const real = getPrismaClient() as object;
    const value: unknown = Reflect.get(real, prop, receiver);
    if (typeof value !== 'function') return value;
    const fn = value as (...args: unknown[]) => unknown;
    return fn.bind(real);
  },
  has: (_target, prop) => Reflect.has(getPrismaClient(), prop),
  ownKeys: () => Reflect.ownKeys(getPrismaClient()),
  getOwnPropertyDescriptor: (_target, prop) =>
    Reflect.getOwnPropertyDescriptor(getPrismaClient(), prop),
});
