/**
 * In-Memory Rate Limiter
 * 
 * Simple rate limiter using in-memory Map storage.
 * Suitable for single-server deployments.
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

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

interface CheckRateLimitParams {
  /** Unique key for rate limiting (e.g., "user:123:api:getData") */
  key: string;
  /** Maximum requests allowed in window */
  limit: number;
  /** Time window in milliseconds (default: 60000 = 1 minute) */
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

/**
 * Check if a request is allowed under rate limiting rules.
 * Increments the counter for the key if allowed.
 */
export const checkRateLimit = ({
  key,
  limit,
  windowMs = 60000
}: CheckRateLimitParams): RateLimitResult => {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  // No entry or expired - create new window
  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + windowMs
    });
    return {
      allowed: true,
      remaining: limit - 1,
      resetIn: Math.ceil(windowMs / 1000)
    };
  }

  // Increment counter
  entry.count++;

  const resetIn = Math.ceil((entry.resetAt - now) / 1000);

  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    resetIn
  };
};

/**
 * Get current rate limit status without incrementing counter.
 * Useful for rate limit headers in responses.
 */
export const getRateLimitStatus = (key: string, limit: number): RateLimitResult => {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || entry.resetAt < now) {
    return { allowed: true, remaining: limit, resetIn: 0 };
  }

  return {
    allowed: entry.count < limit,
    remaining: Math.max(0, limit - entry.count),
    resetIn: Math.ceil((entry.resetAt - now) / 1000)
  };
};

/**
 * Clear rate limit for a specific key.
 * Useful for admin overrides or testing.
 */
export const clearRateLimit = (key: string): void => {
  rateLimitStore.delete(key);
};

/**
 * Clear all rate limits.
 * Useful for testing or server restart.
 */
export const clearAllRateLimits = (): void => {
  rateLimitStore.clear();
};

// Cleanup expired entries every minute
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, entry] of rateLimitStore) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`[RateLimiter] Cleaned ${cleaned} expired entries`, 'gray');
  }
}, 60000);
