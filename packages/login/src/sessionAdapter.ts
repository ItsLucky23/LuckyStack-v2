//? Session storage DI surface. The default adapter persists session
//? records in Redis (same behaviour as before extraction). Consumers can
//? plug in DynamoDB / Memcached / Postgres-table / signed-JWT-stateless
//? adapters by implementing `SessionAdapter` and calling
//? `registerSessionAdapter(...)` at boot.
//?
//? The adapter owns ONLY storage primitives. Framework-level concerns
//? (CSRF minting, hook dispatch, socket emission, single-session
//? enforcement) stay in session.ts and call the adapter to read/write.

import { redis, tryCatch, formatKey } from '@luckystack/core';

export interface SessionAdapter {
  /** Human-readable identifier (used in logs/diagnostics). */
  name: string;

  /** Read the raw stored session string for `token`. Null when missing. */
  getRaw(token: string): Promise<string | null>;

  /**
   * Write the raw session string for `token` with a TTL. Implementations
   * MUST honour the TTL — sessions without one would never expire.
   */
  setRaw(token: string, value: string, ttlSeconds: number): Promise<void>;

  /** Delete the session record for `token`. Idempotent. */
  delete(token: string): Promise<void>;

  /**
   * Refresh the TTL on an existing session record (sliding-window
   * expiration). Returns true when the underlying record existed and the
   * TTL was applied, false otherwise. Implementations must not create a
   * record on miss.
   */
  expire(token: string, ttlSeconds: number): Promise<boolean>;

  /** Remaining TTL in seconds (or null when the record is missing). */
  ttl(token: string): Promise<number | null>;

  // ---- Active-tokens-per-user (for single-session enforcement and
  // revokeUserSessions). Implementations need a set-like structure keyed
  // by userId. Memcached/edge-KV adapters can serialise as a comma-list
  // if no native set type is available. ----

  trackActive(userId: string, token: string, ttlSeconds: number): Promise<void>;
  untrackActive(userId: string, token: string): Promise<void>;
  listActive(userId: string): Promise<string[]>;

  /**
   * Refresh the TTL on the active-tokens-per-user record WITHOUT adding a
   * token (sliding-window expiration parity with the session key). Called on
   * an authenticated read so a session kept alive purely by reads does not
   * outlive its activeUsers entry — which would otherwise let a stolen token
   * survive a sign-out-everywhere / password reset. Optional: backends whose
   * active-set entries do not expire independently (or that have no TTL
   * concept) can omit it. Must not create a record on miss.
   */
  touchActive?(userId: string, ttlSeconds: number): Promise<void>;

  /**
   * Admin walk: yield every active session record. Optional because
   * non-scannable backends (signed-JWT-stateless, log-only) cannot
   * enumerate. Callers fall back to a per-user listActive when omitted.
   */
  listAll?(): Promise<{ token: string; raw: string }[]>;
}

/**
 * Default adapter: Redis-backed. Key layout matches what the framework
 * has used since the first release, so registering this explicitly is
 * equivalent to not registering anything.
 *
 * Imports `redis` and `tryCatch` from `@luckystack/core`. Project name
 * + prefix are resolved at call time so projectConfig changes take
 * effect without reloading this module.
 */

const sessionKey = (token: string): string => formatKey('-session', token);
const activeUsersKey = (userId: string): string => formatKey('-activeUsers', userId);

export const redisSessionAdapter: SessionAdapter = {
  name: 'redis',

  async getRaw(token) {
    const [error, value] = await tryCatch(async () => await redis.get(sessionKey(token)));
    if (error) return null;
    return value ?? null;
  },

  async setRaw(token, value, ttlSeconds) {
    const key = sessionKey(token);
    await redis.set(key, value);
    await redis.expire(key, ttlSeconds);
  },

  async delete(token) {
    await redis.del(sessionKey(token));
  },

  async expire(token, ttlSeconds) {
    const result = await redis.expire(sessionKey(token), ttlSeconds);
    return result === 1;
  },

  async ttl(token) {
    const [error, value] = await tryCatch(async () => await redis.ttl(sessionKey(token)));
    if (error) return null;
    return typeof value === 'number' ? value : null;
  },

  async trackActive(userId, token, ttlSeconds) {
    const key = activeUsersKey(userId);
    await redis.sadd(key, token);
    await redis.expire(key, ttlSeconds);
  },

  async untrackActive(userId, token) {
    await redis.srem(activeUsersKey(userId), token);
  },

  async touchActive(userId, ttlSeconds) {
    //? `expire` only sets a TTL on an EXISTING key (returns 0 on miss), so this
    //? never resurrects an emptied active-set — it just keeps a live one's TTL
    //? in lock-step with the session key it is read alongside.
    await redis.expire(activeUsersKey(userId), ttlSeconds);
  },

  async listActive(userId) {
    const [error, value] = await tryCatch(async () => await redis.smembers(activeUsersKey(userId)));
    if (error || !Array.isArray(value)) return [];
    return value;
  },

  async listAll() {
    const pattern = `${formatKey('-session', '')}:*`;
    const collected: { token: string; raw: string }[] = [];
    let cursor = '0';

    do {
      const [scanError, scanResponse] = await tryCatch(
        async () => await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100),
      );
      if (scanError || !scanResponse) break;

      cursor = scanResponse[0];
      const keys = scanResponse[1];

      if (Array.isArray(keys) && keys.length > 0) {
        const values = await Promise.all(keys.map((k) => redis.get(k)));
        for (const [idx, k] of keys.entries()) {
          const raw = values[idx];
          if (raw) {
            collected.push({
              token: k.replace(`${formatKey('-session', '')}:`, ''),
              raw,
            });
          }
        }
      }
    } while (cursor !== '0');

    return collected;
  },
};

let activeAdapter: SessionAdapter = redisSessionAdapter;

/**
 * Replace the active session storage backend. Call once at boot from
 * `luckystack/server/index.ts`, BEFORE the first login request. Common
 * use cases:
 *
 *  - DynamoDB / Cosmos DB for serverless / edge deployments
 *  - Postgres `sessions` table when you already operate Postgres
 *  - signed-JWT-stateless (the adapter writes nothing, reads from the
 *    JWT, and stores activeUsers per token in a small Redis hash)
 *  - in-memory mock for integration tests
 *
 * Last-write-wins: subsequent calls overwrite the active adapter.
 */
export const registerSessionAdapter = (adapter: SessionAdapter): void => {
  activeAdapter = adapter;
};

/** Read the currently-active session adapter (defaults to Redis). */
export const getSessionAdapter = (): SessionAdapter => activeAdapter;
