/* eslint-disable @typescript-eslint/no-unnecessary-condition */

/**
 * Rate Limiter
 * 
 * Supports in-memory counters by default, with optional Redis counters for
 * multi-instance deployments.
 * 
 * Features:
 * - Per-key rate limiting (user ID, IP address, API name, etc.)
 * - Configurable window duration
 * - Automatic cleanup of expired entries
 * 
 * @example
 * ```typescript
 * // Check if request is allowed
 * const { allowed, remaining, resetIn } = checkRateLimit({
 *   key: `user:${userId}:api:${apiName}`,
 *   limit: 60,
 *   windowMs: 60000
 * });
 * 
 * if (!allowed) {
 *   return { status: 'error', message: `Rate limit exceeded. Try again in ${resetIn}s` };
 * }
 * ```
 */

import { rateLimiting } from '../../config';
import tryCatch from '../../shared/tryCatch';
import { redis } from '../functions/redis';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const RATE_LIMIT_REDIS_PREFIX = `${process.env.PROJECT_NAME ?? 'luckystack'}:${rateLimiting.redisKeyPrefix ?? 'rate-limit'}`;
const RATE_LIMIT_REDIS_MODE = rateLimiting.store === 'redis';
let redisFallbackLogged = false;

const RATE_LIMIT_INCREMENT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { current, ttl }
`;

interface CheckRateLimitParams {
  /** Unique key for rate limiting (e.g., "user:123:api:getData") */
  key: string;
  /** Maximum requests allowed in window */
  limit: number;
  /** Time window in milliseconds (default: 60_000 = 1 minute) */
  windowMs?: number;
}

interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Remaining requests in current window */
  remaining: number;
  /** Seconds until rate limit resets */
  resetIn: number;
}

const normalizeWindowMs = (windowMs: number): number => {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    return 60_000;
  }

  return windowMs;
};

const getRedisRateLimitKey = (key: string): string => {
  return `${RATE_LIMIT_REDIS_PREFIX}:${key}`;
};

const checkRateLimitInMemory = ({
  key,
  limit,
  windowMs = 60_000,
}: CheckRateLimitParams): RateLimitResult => {
  const safeWindowMs = normalizeWindowMs(windowMs);
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + safeWindowMs,
    });

    return {
      allowed: true,
      remaining: limit - 1,
      resetIn: Math.ceil(safeWindowMs / 1000),
    };
  }

  entry.count += 1;
  const resetIn = Math.ceil((entry.resetAt - now) / 1000);

  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    resetIn,
  };
};

const checkRateLimitInRedis = async ({
  key,
  limit,
  windowMs = 60_000,
}: CheckRateLimitParams): Promise<RateLimitResult | null> => {
  const safeWindowMs = normalizeWindowMs(windowMs);
  const redisKey = getRedisRateLimitKey(key);

  const [evalError, evalResponse] = await tryCatch(
    async () => await redis.eval(RATE_LIMIT_INCREMENT_SCRIPT, 1, redisKey, String(safeWindowMs)),
  );

  if (evalError || !Array.isArray(evalResponse) || evalResponse.length < 2) {
    return null;
  }

  const requestCount = Number(evalResponse[0]);
  const ttlMs = Number(evalResponse[1]);
  const safeCount = Number.isFinite(requestCount) ? requestCount : 1;
  const safeTtlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : safeWindowMs;

  return {
    allowed: safeCount <= limit,
    remaining: Math.max(0, limit - safeCount),
    resetIn: Math.ceil(safeTtlMs / 1000),
  };
};

const getRateLimitStatusInMemory = (key: string, limit: number): RateLimitResult => {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || entry.resetAt < now) {
    return { allowed: true, remaining: limit, resetIn: 0 };
  }

  return {
    allowed: entry.count < limit,
    remaining: Math.max(0, limit - entry.count),
    resetIn: Math.ceil((entry.resetAt - now) / 1000),
  };
};

const getRateLimitStatusInRedis = async (key: string, limit: number): Promise<RateLimitResult | null> => {
  const redisKey = getRedisRateLimitKey(key);
  const [txError, txResponse] = await tryCatch(
    async () => await redis.multi().get(redisKey).pttl(redisKey).exec(),
  );

  if (txError || !txResponse || txResponse.length < 2) {
    return null;
  }

  const getResult = txResponse[0];
  const ttlResult = txResponse[1];
  if (!getResult || getResult[0] || !ttlResult || ttlResult[0]) {
    return null;
  }

  const currentCount = Number(getResult[1] ?? 0);
  const ttlMs = Number(ttlResult[1] ?? 0);

  if (currentCount <= 0 || ttlMs <= 0) {
    return { allowed: true, remaining: limit, resetIn: 0 };
  }

  return {
    allowed: currentCount < limit,
    remaining: Math.max(0, limit - currentCount),
    resetIn: Math.ceil(ttlMs / 1000),
  };
};

const logRedisFallback = () => {
  if (redisFallbackLogged) {
    return;
  }

  redisFallbackLogged = true;
  console.log('[RateLimiter] Redis mode unavailable, falling back to in-memory mode', 'yellow');
};

/**
 * Check if a request is allowed under rate limiting rules.
 * Increments the counter for the key if allowed.
 */
export const checkRateLimit = async ({
  key,
  limit,
  windowMs = 60_000,
}: CheckRateLimitParams): Promise<RateLimitResult> => {
  if (RATE_LIMIT_REDIS_MODE) {
    const redisResult = await checkRateLimitInRedis({ key, limit, windowMs });
    if (redisResult) {
      return redisResult;
    }

    logRedisFallback();
  }

  return checkRateLimitInMemory({ key, limit, windowMs });
};

/**
 * Get current rate limit status without incrementing counter.
 * Useful for rate limit headers in responses.
 */
export const getRateLimitStatus = async (key: string, limit: number): Promise<RateLimitResult> => {
  if (RATE_LIMIT_REDIS_MODE) {
    const redisResult = await getRateLimitStatusInRedis(key, limit);
    if (redisResult) {
      return redisResult;
    }

    logRedisFallback();
  }

  return getRateLimitStatusInMemory(key, limit);
};

/**
 * Clear rate limit for a specific key.
 * Useful for admin overrides or testing.
 */
export const clearRateLimit = async (key: string): Promise<void> => {
  if (RATE_LIMIT_REDIS_MODE) {
    await tryCatch(async () => await redis.del(getRedisRateLimitKey(key)));
  }

  rateLimitStore.delete(key);
};

/**
 * Clear all rate limits.
 * Useful for testing or server restart.
 */
export const clearAllRateLimits = async (): Promise<void> => {
  if (RATE_LIMIT_REDIS_MODE) {
    let cursor = '0';
    do {
      const [scanError, scanResponse] = await tryCatch(
        async () => await redis.scan(cursor, 'MATCH', `${RATE_LIMIT_REDIS_PREFIX}:*`, 'COUNT', 100),
      );

      if (scanError || !scanResponse || scanResponse.length < 2) {
        break;
      }

      cursor = scanResponse[0];
      const keys = scanResponse[1];

      if (keys.length > 0) {
        await tryCatch(async () => await redis.del(...keys));
      }
    } while (cursor !== '0');
  }

  rateLimitStore.clear();
};

// Cleanup expired entries every minute
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, entry] of rateLimitStore) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`[RateLimiter] Cleaned ${String(cleaned)} expired entries`, 'gray');
  }
}, 60_000);

cleanupInterval.unref();
