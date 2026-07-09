import './env';
import { createRequire } from 'node:module';
import type { PrismaClient } from '@prisma/client';
import { getPrismaClient, setDefaultPrismaResolver } from './clients';
import tryCatchSync from './tryCatchSync';

declare global {
  // eslint-disable-next-line no-var
  var __luckystackPrisma: PrismaClient | undefined;
}

//? '@prisma/client' deliberately left the static-import position (ADR 0020,
//? the ORM-choice decision): with `orm: 'none'` (or a non-Prisma ORM) the
//? package is legitimately absent, and an unguarded value-import crashed boot
//? with a bare ERR_MODULE_NOT_FOUND before any framework error handling
//? existed. The type-only import above is erased at runtime; the client is
//? require()d lazily on first default-resolver access instead.
const requireFromCore = createRequire(import.meta.url);

/**
 * Is a generated `@prisma/client` present in this install? Used by the
 * default resolver's error path and by `/readyz` to decide whether a missing
 * DB ping means "broken" or "this project has no Prisma by design".
 */
export const isPrismaClientResolvable = (): boolean => {
  const [error] = tryCatchSync(() => requireFromCore.resolve('@prisma/client'));
  return !error;
};

interface PrismaClientModuleShape {
  PrismaClient?: new () => PrismaClient;
}

//? Lazy default: only constructed when the proxy is first accessed AND no
//? consumer has registered their own Prisma client. Avoids paying the
//? PrismaClient construction cost in code paths that swap it out at boot.
const buildDefaultPrismaClient = (): PrismaClient => {
  if (!globalThis.__luckystackPrisma) {
    const [loadError, loaded] = tryCatchSync(
      () => requireFromCore('@prisma/client') as PrismaClientModuleShape,
    );
    const PrismaClientCtor = loaded?.PrismaClient;
    if (loadError || typeof PrismaClientCtor !== 'function') {
      //? THE `orm: 'none'` error seam (ADR 0020): every DB access without a
      //? registered client lands here with an actionable message instead of a
      //? module-resolution stack trace.
      throw new Error(
        "[luckystack] no database client is available: '@prisma/client' is not installed/generated " +
          'and no client was registered. Register your own database client in ' +
          '`luckystack/core/clients.ts` via registerPrismaClient(...) (any client whose surface your ' +
          'handlers use) — and swap the login UserAdapter via registerUserAdapter(...) if auth is on — ' +
          'or install Prisma: `npm i @prisma/client prisma` + `npx prisma generate`. ' +
          "Projects scaffolded with orm: 'none' are expected to fill in that file.",
      );
    }
    globalThis.__luckystackPrisma = new PrismaClientCtor();
  }
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
  get: (_target, prop, _receiver) => {
    const real = getPrismaClient() as object;
    //? Pass `real` (not the Proxy) as the receiver so that getter-backed
    //? private fields (Prisma uses #-private slots internally) look up their
    //? slot on the real target instead of on the Proxy, which has no private
    //? slots and would throw TypeError (CORE-N9).
    const value: unknown = Reflect.get(real, prop, real);
    if (typeof value !== 'function') return value;
    const fn = value as (...args: unknown[]) => unknown;
    return fn.bind(real);
  },
  has: (_target, prop) => Reflect.has(getPrismaClient(), prop),
  ownKeys: () => Reflect.ownKeys(getPrismaClient()),
  getOwnPropertyDescriptor: (_target, prop) =>
    Reflect.getOwnPropertyDescriptor(getPrismaClient(), prop),
});
