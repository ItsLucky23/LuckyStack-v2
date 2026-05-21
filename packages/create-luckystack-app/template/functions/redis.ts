//? Framework-default shim. Re-exports the ioredis singleton from @luckystack/core
//? so it shows up as `functions.redis.redis` (and `functions.redis.default`) inside
//? every API + sync handler.
//?
//? Edit this file to wrap Redis usage (custom key-prefix per tenant, dead-letter
//? queue patterns, retry policies). Affects calls that go through
//? `functions.redis.redis` in your own handlers. Framework-internal code
//? (sessions, rate-limiting, presence) imports the redis singleton directly
//? from `@luckystack/core` and is NOT affected.
//?
//? For framework-wide Redis backend override: build a custom Redis adapter
//? in `luckystack/core/clients.ts` before bootstrap.
import { redis } from '@luckystack/core';

export { redis };
export default redis;
