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
import { createRegistry } from './createRegistry';
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

//? CORE-O7: cap the in-memory store so a key-varying flood (e.g. path-parameter
//? spray) can't grow the Map to OOM between cleanup ticks. When the cap is hit,
//? the oldest entry is evicted (Map preserves insertion order; the first key is
//? the oldest). Evicting the oldest is the least-harm choice: the victim can
//? retry (now capped to 1) while the attacker's own keys are the new ones,
//? making them the hardest to evict. In memory mode this is a single-instance
//? soft limit; for multi-instance deployments use Redis mode.
const MAX_MEMORY_STORE_SIZE = 50_000;
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

//? Re-armable warning latch: log at most once per `REDIS_FALLBACK_LOG_COOLDOWN_MS`
//? so a recurring Redis degradation stays visible (the old one-shot latch hid
//? every fallback after the first, so a flapping Redis looked healthy in logs).
const REDIS_FALLBACK_LOG_COOLDOWN_MS = 60_000;
let redisFallbackLastLoggedAt = 0;

const RATE_LIMIT_INCREMENT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { current, ttl }
`;

const normalizeWindowMs = (windowMs: number | undefined): number => {
  if (windowMs === undefined || !Number.isFinite(windowMs) || windowMs <= 0) {
    return getProjectConfig().rateLimiting.windowMs;
  }
  return windowMs;
};

const getRedisRateLimitKey = (key: string): string => `${getRedisPrefix()}:${key}`;

const checkRateLimitInMemory = ({
  key,
  limit,
  //? No default here — `normalizeWindowMs` reads `projectConfig.rateLimiting.windowMs`
  //? when `windowMs` is undefined or non-finite, so a hardcoded `60_000` would
  //? shadow the configured value (CORE-N6).
  windowMs,
}: CheckRateLimitParams): RateLimitResult => {
  const safeWindowMs = normalizeWindowMs(windowMs);
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || entry.resetAt < now) {
    //? CORE-O7: evict the oldest entry before inserting a new key to keep the
    //? store bounded. `Map` preserves insertion order so the first iterator key
    //? is the oldest. Only evict when we are at the cap AND the incoming key is
    //? genuinely new (i.e. not a refresh of an existing key checked above).
    if (rateLimitStore.size >= MAX_MEMORY_STORE_SIZE) {
      const oldest = rateLimitStore.keys().next().value;
      if (oldest !== undefined) rateLimitStore.delete(oldest);
    }
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
  //? No default — same reasoning as `checkRateLimitInMemory` (CORE-N6).
  windowMs,
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

const getOnStoreError = (): 'memory' | 'deny' =>
  getProjectConfig().rateLimiting.onStoreError;

const logRedisFallback = (): void => {
  const now = Date.now();
  if (now - redisFallbackLastLoggedAt < REDIS_FALLBACK_LOG_COOLDOWN_MS) return;
  redisFallbackLastLoggedAt = now;
  getLogger().warn(
    getOnStoreError() === 'deny'
      ? '[RateLimiter] Redis mode unavailable — denying request (onStoreError=deny)'
      : '[RateLimiter] Redis mode unavailable, falling back to in-memory mode (onStoreError=memory)',
  );
};

//? When `onStoreError: 'deny'` we fail closed: a Redis outage must NOT silently
//? relax the limit. Returns a not-allowed result with the full window as the
//? reset hint so callers surface a sane `Retry-After`.
const buildDeniedResult = (): RateLimitResult => ({
  allowed: false,
  remaining: 0,
  resetIn: Math.ceil(getProjectConfig().rateLimiting.windowMs / 1000),
});

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
      if (getOnStoreError() === 'deny') return buildDeniedResult();
    }

    return checkRateLimitInMemory(params);
  },

  async getStatus(key, limit) {
    if (!isRateLimitingEnabled()) return buildAllowedResult(limit);

    if (isRedisMode()) {
      const redisResult = await getRateLimitStatusInRedis(key, limit);
      if (redisResult) return redisResult;
      logRedisFallback();
      if (getOnStoreError() === 'deny') return buildDeniedResult();
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

const strategyRegistry = createRegistry<RateLimitStrategy>(defaultRateLimitStrategy, {
  onRegister: (strategy) => {
    getLogger().debug(`[RateLimiter] active strategy → ${strategy.name}`);
  },
});

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
  strategyRegistry.register(strategy);
};

/** Read the currently-active strategy (defaults to the built-in). */
export const getRateLimitStrategy = (): RateLimitStrategy => strategyRegistry.get();

/**
 * Check if a request is allowed under rate limiting rules.
 * Increments the counter for the key if allowed.
 */
export const checkRateLimit = async (params: CheckRateLimitParams): Promise<RateLimitResult> => {
  ensureCleanupScheduled();
  return strategyRegistry.get().check(params);
};

/**
 * Get current rate limit status without incrementing counter.
 * Useful for rate limit headers in responses.
 */
export const getRateLimitStatus = async (key: string, limit: number): Promise<RateLimitResult> => {
  ensureCleanupScheduled();
  return strategyRegistry.get().getStatus(key, limit);
};

/**
 * Clear rate limit for a specific key.
 * Useful for admin overrides or testing.
 */
export const clearRateLimit = async (key: string): Promise<void> => strategyRegistry.get().clear(key);

/**
 * Clear all rate limits.
 * Intended for testing or dev-mode server reset only.
 * CORE-O8: throws in production to prevent accidental global counter wipe across
 * all tenants. If you need a production-safe reset, pass a scoped key to
 * `clearRateLimit` or implement a tenant-namespaced strategy.
 */
export const clearAllRateLimits = async (): Promise<void> => {
  if (process.env.NODE_ENV === 'production') {
    getLogger().warn('[RateLimiter] clearAllRateLimits() called in production — ignored. Use clearRateLimit(key) for scoped resets.');
    return;
  }
  return strategyRegistry.get().clearAll();
};

//? Cleanup expired entries from the in-memory store on a configurable
//? interval. Only relevant for the default strategy; custom strategies
//? handle their own cleanup. Restart-aware: we schedule recursively so the
//? interval picks up `projectConfig.rateLimiting.cleanupIntervalMs` whenever
//? it changes (e.g. after `registerProjectConfig`).
//?
//? Lazy-started on the first `checkRateLimit`/`getRateLimitStatus` call rather
//? than at module load, so any tool/CLI/test that merely type-imports core does
//? NOT inherit a recurring timer it never asked for (the package's "no import-
//? time side effects" doctrine).
let cleanupStarted = false;
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

const ensureCleanupScheduled = (): void => {
  if (cleanupStarted) return;
  cleanupStarted = true;
  //? CORE-O6: warn once at the first request if `onStoreError:'deny'` is set
  //? in non-Redis mode. In memory mode there is no "store error" path to honor,
  //? so the setting is a silent no-op — log it so operators aren't surprised.
  if (!isRedisMode() && getOnStoreError() === 'deny') {
    getLogger().warn(
      '[RateLimiter] onStoreError="deny" has no effect in memory mode (only Redis mode has a fallback path). Switch to store:"redis" or remove the setting.',
    );
  }
  scheduleCleanup();
};
