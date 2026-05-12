import {
  computeSynchronizedEnvHashes,
  getProjectConfig,
  prisma,
  readBootUuid,
  redis,
  resolveEnvKey,
  tryCatch,
} from '@luckystack/core';
import type { HttpRouteHandler } from './types';

//? Narrow shapes for the methods this route uses. Avoids broad `as any`
//? casts — same single-boundary type-erasure pattern used for the other
//? Redis/Prisma touch points (testResetRoute, defaultPrismaUserAdapter).
interface RedisPing {
  ping: () => Promise<string>;
}
interface PrismaQueryRaw {
  $queryRaw: (template: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
}

export const handleLivezRoute: HttpRouteHandler = async ({ res, routePath }) => {
  if (routePath !== getProjectConfig().http.liveEndpoint) return false;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ status: 'live' }));
  return true;
};

export const handleReadyzRoute: HttpRouteHandler = async ({ res, routePath }) => {
  if (routePath !== getProjectConfig().http.readyEndpoint) return false;

  const bootUuid = await readBootUuid();

  const redisDelegate = redis as unknown as RedisPing;
  const [redisError, pong] = await tryCatch(() => redisDelegate.ping());
  const redisOk = !redisError && (pong === 'PONG' || pong === 'pong' || Boolean(pong));

  const prismaDelegate = prisma as unknown as PrismaQueryRaw;
  const [prismaError] = await tryCatch(() => prismaDelegate.$queryRaw`SELECT 1`);
  const prismaOk = !prismaError;

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
  const synchronizedHashes = computeSynchronizedEnvHashes();
  res.statusCode = bootUuid ? 200 : 503;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    status: bootUuid ? 'ok' : 'degraded',
    bootUuid,
    envKey: resolveEnvKey(),
    synchronizedHashes,
  }));
  return true;
};
