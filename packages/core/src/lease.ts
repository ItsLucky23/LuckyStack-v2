//? Redis lease primitive — a minimal single-writer / leader-ownership building
//? block (SET NX PX + owner-checked Lua release/renew). Lets a multi-instance
//? deployment elect ONE owner for a host-bound resource (orchestrator, serial
//? indexer, cron) without building fencing from scratch. Redis is already a
//? hard dependency.
//?
//? Scope: this is a single-Redis, best-effort lock (NOT Redlock / distributed
//? consensus). A client whose event loop stalls past the TTL can have its
//? lease expire and be handed to another owner — size the TTL accordingly and
//? renew well before expiry. For strict correctness across a Redis failover,
//? use a dedicated coordinator (etcd/Zookeeper). The lease is a PRIMITIVE; the
//? leader-election RUNTIME (the renew loop, what to do on loss) is app code.

import { randomBytes } from 'node:crypto';
import { redis } from './redis';
import tryCatch from './tryCatch';
import { formatKey } from './redisKeyFormatter';

const leaseKey = (name: string): string => formatKey('lease', name);

//? Owner-checked compare-and-pexpire: only the current holder may extend.
const RENEW_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
else
  return 0
end
`;

//? Owner-checked compare-and-delete: releasing someone else's lease is a no-op,
//? so a stale holder can't free a lease another owner has already taken.
const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
`;

/**
 * Acquire an exclusive lease named `name` for `ttlMs` milliseconds. Returns an
 * opaque owner token on success, or `null` when another owner already holds it.
 * `SET key token PX ttl NX` is atomic, so concurrent acquirers race safely.
 * Keep the returned token to `renewLease` / `releaseLease`.
 */
export const acquireLease = async (name: string, ttlMs: number): Promise<string | null> => {
  const token = randomBytes(16).toString('hex');
  const [error, result] = await tryCatch(async () =>
    redis.set(leaseKey(name), token, 'PX', ttlMs, 'NX'),
  );
  if (error) return null;
  return result === 'OK' ? token : null;
};

/**
 * Extend a held lease by `ttlMs` (sliding ownership). Returns true when the
 * supplied `token` still owns the lease and the TTL was applied, false
 * otherwise (lost ownership, expired, or Redis error).
 */
export const renewLease = async (name: string, token: string, ttlMs: number): Promise<boolean> => {
  const [error, result] = await tryCatch(async () =>
    redis.eval(RENEW_SCRIPT, 1, leaseKey(name), token, String(ttlMs)),
  );
  if (error) return false;
  return result === 1;
};

/**
 * Release a held lease. Owner-checked: only succeeds (returns true) when
 * `token` is the current holder. Returns false on mismatch or Redis error.
 */
export const releaseLease = async (name: string, token: string): Promise<boolean> => {
  const [error, result] = await tryCatch(async () =>
    redis.eval(RELEASE_SCRIPT, 1, leaseKey(name), token),
  );
  if (error) return false;
  return result === 1;
};
