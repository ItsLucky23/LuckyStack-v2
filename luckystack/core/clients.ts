//? Prisma + Redis client overrides. Leave this file empty to use the
//? framework's lazy defaults (PrismaClient + ioredis configured from .env).
//?
//? Examples for when you need to swap them:
//?
//?   // Custom Prisma client (logging, Accelerate, ...):
//?   import { registerPrismaClient } from '@luckystack/core';
//?   import { PrismaClient } from '@prisma/client';
//?   registerPrismaClient(new PrismaClient({ log: ['warn', 'error'] }));
//?
//?   // Custom Redis client (TLS, sentinel, ...):
//?   import { registerRedisClient } from '@luckystack/core';
//?   import Redis from 'ioredis';
//?   registerRedisClient(new Redis({ host: '...', tls: {} }));

export {};
