/**
 * Rate Limiter
 *
 * The framework's rate-limit dispatch is pluggable via
 * `registerRateLimitStrategy()`. The built-in `defaultRateLimitStrategy`
 * implements in-memory counters with optional Redis backing for
 * multi-instance deployments. Consumers can plug in alternative strategies
 * (token-bucket, sliding-window, per-user tiers, edge-KV-backed, etc.) by
 * implementing the `RateLimitStrategy` interface.
 */

import { getProjectConfig } from './projectConfig';
import tryCatch from './tryCatch';
import { redis } from './redis';
import { formatKey } from './redisKeyFormatter';
import { getLogger } from './loggerRegistry';

export interface CheckRateLimitParams {
  /** Unique key for rate limiting (e.g., "user:123:api:getData") */
  key: string;
  /** Maximum requests allowed in window */
  limit: number;
  /** Time window in milliseconds (default: 60_000 = 1 minute) */
  windowMs?: number;
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Remaining requests in current window */
  remaining: number;
  /** Seconds until rate limit resets */
  resetIn: number;
}

/**
 * Pluggable rate-limit backend. The framework calls these methods through
 * the active strategy slot. Default implementation is memory + Redis.
 * Replace via `registerRateLimitStrategy(...)` at boot.
 */
export interface RateLimitStrategy {
  /** Human-readable identifier (used in logs/diagnostics). */
  name: string;
  /** Increment the counter for `key` and return whether the request is allowed. */
  check(params: CheckRateLimitParams): Promise<RateLimitResult>;
  /** Read current status without incrementing — useful for response headers. */
  getStatus(key: string, limit: number): Promise<RateLimitResult>;
  /** Reset the counter for a single key. */
  clear(key: string): Promise<void>;
  /** Reset all counters under this strategy's namespace. */
  clearAll(): Promise<void>;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

//? Resolved at call time so `registerProjectConfig` can run after this
//? module is imported. If the project never registers, the defaults from
//? projectConfig.ts take effect (memory store, 'rate-limit' prefix).
const getRedisPrefix = (): string =>
  formatKey(`:${getProjectConfig().rateLimiting.redisKeyPrefix}`, '');

const isRedisMode = (): boolean => getProjectConfig().rateLimiting.store === 'redis';
const isRateLimitingEnabled = (): boolean => getProjectConfig().rateLimiting.enabled;

const buildAllowedResult = (limit: number): RateLimitResult => ({
  allowed: true,
  remaining: Math.max(0, limit),
  resetIn: 0,
});

let redisFallbackLogged = false;

const RATE_LIMIT_INCREMENT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { current, ttl }
`;

const normalizeWindowMs = (windowMs: number): number => {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    return getProjectConfig().rateLimiting.windowMs;
  }
  return windowMs;
};

const getRedisRateLimitKey = (key: string): string => `${getRedisPrefix()}:${key}`;

const checkRateLimitInMemory = ({
  key,
  limit,
  windowMs = 60_000,
}: CheckRateLimitParams): RateLimitResult => {
  const safeWindowMs = normalizeWindowMs(windowMs);
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + safeWindowMs });
    return { allowed: true, remaining: limit - 1, resetIn: Math.ceil(safeWindowMs / 1000) };
  }

  entry.count += 1;
  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    resetIn: Math.ceil((entry.resetAt - now) / 1000),
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

  if (txError || !txResponse || txResponse.length < 2) return null;

  const getResult = txResponse[0];
  const ttlResult = txResponse[1];
  if (!getResult || !ttlResult || getResult[0] || ttlResult[0]) return null;

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

const logRedisFallback = (): void => {
  if (redisFallbackLogged) return;
  redisFallbackLogged = true;
  getLogger().warn('[RateLimiter] Redis mode unavailable, falling back to in-memory mode');
};

/**
 * Built-in strategy: in-memory counters with optional Redis backing for
 * multi-instance deployments. Mode is controlled by
 * `projectConfig.rateLimiting.store` (`'memory'` or `'redis'`). When `redis`
 * mode fails (e.g. Redis disconnect), the strategy silently degrades to
 * in-memory and logs a one-shot warning.
 */
export const defaultRateLimitStrategy: RateLimitStrategy = {
  name: 'default-memory-redis',

  async check(params) {
    if (!isRateLimitingEnabled()) return buildAllowedResult(params.limit);

    if (isRedisMode()) {
      const redisResult = await checkRateLimitInRedis(params);
      if (redisResult) return redisResult;
      logRedisFallback();
    }

    return checkRateLimitInMemory(params);
  },

  async getStatus(key, limit) {
    if (!isRateLimitingEnabled()) return buildAllowedResult(limit);

    if (isRedisMode()) {
      const redisResult = await getRateLimitStatusInRedis(key, limit);
      if (redisResult) return redisResult;
      logRedisFallback();
    }

    return getRateLimitStatusInMemory(key, limit);
  },

  async clear(key) {
    if (isRedisMode()) {
      await tryCatch(async () => await redis.del(getRedisRateLimitKey(key)));
    }
    rateLimitStore.delete(key);
  },

  async clearAll() {
    if (isRedisMode()) {
      let cursor = '0';
      do {
        const [scanError, scanResponse] = await tryCatch(
          async () => await redis.scan(cursor, 'MATCH', `${getRedisPrefix()}:*`, 'COUNT', 100),
        );

        if (scanError || !scanResponse) break;

        cursor = scanResponse[0];
        const keys = scanResponse[1];

        if (keys.length > 0) {
          await tryCatch(async () => await redis.del(...keys));
        }
      } while (cursor !== '0');
    }

    rateLimitStore.clear();
  },
};

let activeStrategy: RateLimitStrategy = defaultRateLimitStrategy;

/**
 * Replace the active rate-limit backend. Pass a strategy that implements
 * `RateLimitStrategy`. Common use cases:
 *
 *  - Token-bucket / sliding-window algorithms for smoother burst handling.
 *  - Per-user tier limits (premium accounts get higher caps).
 *  - Cloudflare-Workers-KV or upstash-rest-backed counters for edge.
 *  - No-op strategy for test environments.
 *
 * Call this once at boot (typically from `luckystack/server/index.ts`)
 * BEFORE the first request lands. Subsequent calls overwrite the previous
 * registration (last-write-wins).
 */
export const registerRateLimitStrategy = (strategy: RateLimitStrategy): void => {
  activeStrategy = strategy;
  getLogger().debug(`[RateLimiter] active strategy → ${strategy.name}`);
};

/** Read the currently-active strategy (defaults to the built-in). */
export const getRateLimitStrategy = (): RateLimitStrategy => activeStrategy;

/**
 * Check if a request is allowed under rate limiting rules.
 * Increments the counter for the key if allowed.
 */
export const checkRateLimit = async (params: CheckRateLimitParams): Promise<RateLimitResult> =>
  activeStrategy.check(params);

/**
 * Get current rate limit status without incrementing counter.
 * Useful for rate limit headers in responses.
 */
export const getRateLimitStatus = async (key: string, limit: number): Promise<RateLimitResult> =>
  activeStrategy.getStatus(key, limit);

/**
 * Clear rate limit for a specific key.
 * Useful for admin overrides or testing.
 */
export const clearRateLimit = async (key: string): Promise<void> => activeStrategy.clear(key);

/**
 * Clear all rate limits.
 * Useful for testing or server restart.
 */
export const clearAllRateLimits = async (): Promise<void> => activeStrategy.clearAll();

//? Cleanup expired entries from the in-memory store on a configurable
//? interval. Only relevant for the default strategy; custom strategies
//? handle their own cleanup. Restart-aware: we schedule recursively so the
//? interval picks up `projectConfig.rateLimiting.cleanupIntervalMs` whenever
//? it changes (e.g. after `registerProjectConfig`).
const scheduleCleanup = (): void => {
  const intervalMs = getProjectConfig().rateLimiting.cleanupIntervalMs;
  const timer = setTimeout(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of rateLimitStore) {
      if (entry.resetAt < now) {
        rateLimitStore.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      getLogger().debug(`[RateLimiter] Cleaned ${String(cleaned)} expired entries`);
    }
    scheduleCleanup();
  }, intervalMs);
  timer.unref();
};

scheduleCleanup();
