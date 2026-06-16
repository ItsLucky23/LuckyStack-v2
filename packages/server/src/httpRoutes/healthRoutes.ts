import {
  computeSynchronizedEnvHashes,
  describeHealthHashConfig,
  getProjectConfig,
  prisma,
  readBootUuid,
  redis,
  resolveEnvKey,
  tryCatch,
} from '@luckystack/core';
import type { HttpRouteHandler } from './types';

//? Cross-provider connectivity ping. Prisma's generated TypeScript surface
//? differs per provider: SQL providers expose `$queryRaw`, MongoDB exposes
//? `$runCommandRaw`. The framework can't know which one the consumer's schema
//? uses, so this single seam asserts both as optional and probes at runtime.
//? Detecting the provider via `_engineConfig.activeProvider` is private API
//? and has drifted between Prisma major versions — runtime probing is more
//? robust.
interface PrismaPingShape {
  $queryRaw?: (template: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  $runCommandRaw?: (command: Record<string, unknown>) => Promise<unknown>;
}

const pingPrisma = async (): Promise<boolean> => {
  //? Prisma's generated client typings don't expose `$queryRaw` /
  //? `$runCommandRaw` uniformly (depends on the active datasource). The
  //? `PrismaPingShape` is our minimal local probe interface; the boundary
  //? cast is the structural exception the strict-typing policy allows.
  // eslint-disable-next-line no-restricted-syntax -- Prisma datasource-conditional shape
  const client = prisma as unknown as PrismaPingShape;
  //? Capture each function into a local before calling so the typeof
  //? narrow holds without `!`. The shape `PrismaPingShape` declares both
  //? methods optional because Prisma's generated types include one or the
  //? other depending on active provider — capturing into a local also
  //? removes the assertion-style cast that the strict-typing policy disallows.
  const queryRaw = client.$queryRaw;
  if (typeof queryRaw === 'function') {
    const [sqlError] = await tryCatch(() => queryRaw`SELECT 1`);
    if (!sqlError) return true;
  }
  const runCommandRaw = client.$runCommandRaw;
  if (typeof runCommandRaw === 'function') {
    const [mongoError] = await tryCatch(() => runCommandRaw({ ping: 1 }));
    return !mongoError;
  }
  return false;
};

export const handleLivezRoute: HttpRouteHandler = ({ res, routePath }) => {
  if (routePath !== getProjectConfig().http.liveEndpoint) return Promise.resolve(false);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ status: 'live' }));
  return Promise.resolve(true);
};

export const handleReadyzRoute: HttpRouteHandler = async ({ res, routePath }) => {
  if (routePath !== getProjectConfig().http.readyEndpoint) return false;

  const bootUuid = await readBootUuid();

  const [redisError, pong] = await tryCatch(() => redis.ping());
  const redisOk = !redisError && (pong === 'PONG' || Boolean(pong));

  const prismaOk = await pingPrisma();

  const ready = Boolean(bootUuid) && redisOk && prismaOk;
  res.statusCode = ready ? 200 : 503;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    status: ready ? 'ready' : 'not-ready',
    checks: { bootUuid: Boolean(bootUuid), redis: redisOk, prisma: prismaOk },
  }));
  return true;
};

export const handleHealthRoute: HttpRouteHandler = async ({ res, routePath }) => {
  if (routePath !== getProjectConfig().http.healthEndpoint) return false;

  const bootUuid = await readBootUuid();
  //? SEC-13: pass the boot UUID so the `'@bootUuid'` salt sentinel (the 0.2.0
  //? default `http.healthHash` = `{ mode: 'hmac', salt: '@bootUuid' }`) resolves
  //? to a per-boot HMAC key. Previously the arg was omitted, so the sentinel
  //? always collapsed to `'plain'` and `/_health` leaked a stable, unsalted
  //? `sha256(secret)` fingerprint of every synchronized env value.
  const synchronizedHashes = computeSynchronizedEnvHashes(bootUuid);
  res.statusCode = bootUuid ? 200 : 503;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    status: bootUuid ? 'ok' : 'degraded',
    bootUuid,
    envKey: resolveEnvKey(),
    synchronizedHashes,
    //? Tell the router HOW these hashes were produced (mode + whether the salt is
    //? the `@bootUuid` sentinel) so it can hash its local values with the SAME
    //? config instead of its own default. Never exposes a static salt (a secret).
    healthHash: describeHealthHashConfig(),
  }));
  return true;
};
