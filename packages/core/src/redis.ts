/* eslint-disable @typescript-eslint/no-misused-promises, @typescript-eslint/require-await */

import Redis from 'ioredis';
import type { Redis as RedisClient } from 'ioredis';
import { env } from './env';
import { getRedisClient, setDefaultRedisResolver, registerRedisClient, isRedisClientRegistered } from './clients';
import { getLogger } from './loggerRegistry';
import { applyStrayKeyPrefix } from './redisKeyFormatter';
import { registerSecretsResolvedListener } from './secretsResolved';

let cachedDefault: RedisClient | null = null;

//? Stop reconnecting after this many consecutive failures so a permanently
//? unreachable / misconfigured Redis (bad creds, wrong host) doesn't hammer
//? forever. With the capped backoff below the default 50 is ~1 minute of
//? attempts — long enough to ride out a transient blip, short enough to surface
//? a real outage. Managed-Redis maintenance windows can exceed a minute, so
//? both the attempt cap and the backoff ceiling are overridable via env
//? (read at client-build time, so dotenv timing doesn't capture a stale value):
//?   LUCKYSTACK_REDIS_MAX_RECONNECTS  — attempt cap (default 50)
//?   LUCKYSTACK_REDIS_MAX_BACKOFF_MS  — per-attempt backoff ceiling (default 2000)
const DEFAULT_MAX_REDIS_RECONNECT_ATTEMPTS = 50;
const DEFAULT_MAX_REDIS_BACKOFF_MS = 2000;

const readPositiveIntEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

//? Build a fresh ioredis client from the CURRENT env (read at call time so
//? dotenv / secret-manager timing doesn't capture a stale value). Password +
//? username come from `process.env`; host/port from the frozen `env` snapshot.
const constructRedisClient = (): RedisClient => {
  const maxReconnectAttempts = readPositiveIntEnv('LUCKYSTACK_REDIS_MAX_RECONNECTS', DEFAULT_MAX_REDIS_RECONNECT_ATTEMPTS);
  const maxBackoffMs = readPositiveIntEnv('LUCKYSTACK_REDIS_MAX_BACKOFF_MS', DEFAULT_MAX_REDIS_BACKOFF_MS);

  const client = new Redis({
    host: env.REDIS_HOST,
    port: Number.parseInt(env.REDIS_PORT, 10),
    ...(process.env.REDIS_USER && { username: process.env.REDIS_USER }),
    ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),

    retryStrategy(times) {
      if (times > maxReconnectAttempts) {
        getLogger().error(
          `Redis unreachable after ${String(maxReconnectAttempts)} reconnect attempts; giving up. Check REDIS_HOST / REDIS_PORT / credentials and that Redis is reachable. Raise LUCKYSTACK_REDIS_MAX_RECONNECTS for longer outage tolerance.`,
        );
        return null;
      }
      return Math.min(times * 50, maxBackoffMs);
    },
  });

  //? `ready` (not `connect`): `connect` fires on TCP connect BEFORE the AUTH
  //? handshake, so logging there reports success even when credentials are
  //? wrong. `ready` fires only after AUTH succeeds.
  client.on('ready', async () => {
    getLogger().info('Connected to Redis');
  });

  client.on('error', (err) => {
    //? CORE-1: a very common, cryptic failure is an auth error whose password
    //? is still a @luckystack/secret-manager POINTER (e.g. `REDIS_PASSWORD_V1`)
    //? because the default client was constructed — and cached — during an
    //? early import-scan, BEFORE secret-manager init resolved the pointer. Turn
    //? the raw `WRONGPASS` into an actionable message instead.
    const message = String((err as { message?: string } | undefined)?.message ?? err);
    const password = process.env.REDIS_PASSWORD ?? '';
    if (/WRONGPASS|NOAUTH|invalid username-password/i.test(message) && /_V\d+$/i.test(password)) {
      getLogger().error(
        `Redis auth failed and REDIS_PASSWORD ("${password}") looks like an UNRESOLVED secret-manager pointer. ` +
        'The default Redis client was likely built before secret-manager init ran. The framework now EAGERLY REBUILDS + ' +
        'registers a fresh client automatically when `config.secretManager.url` is set (server boot) and when ' +
        '`initSecretManager` is wired with `onApplied: notifySecretsResolved`; if you resolve secrets by other means, ' +
        'call `rebuildDefaultRedisClient()` (or `registerRedisClient(new Redis(getRedisConnectionOptions()))`) after ' +
        'resolution. Also confirm `REDIS_PASSWORD` is listed in the secret-manager `envNames` allowlist (unset resolves ' +
        'nothing). See docs/luckystack/ARCHITECTURE_SECRET_MANAGER.md.',
        err,
      );
      return;
    }
    getLogger().error('Error connecting to Redis', err);
  });

  return client;
};

const buildDefaultRedisClient = (): RedisClient => {
  if (cachedDefault) return cachedDefault;
  cachedDefault = constructRedisClient();
  return cachedDefault;
};

//? Drop (and disconnect) the cached default Redis client so the NEXT resolve
//? rebuilds it. Kept for consumers that resolve secrets by other means, but note
//? it is INSUFFICIENT on its own for the secret-manager pointer case: it only
//? nulls `cachedDefault` and DEFERS the rebuild, so a stale value can resurface.
//? Prefer `rebuildDefaultRedisClient()` (eager replace) — the framework uses it.
export const resetDefaultRedisClient = (): void => {
  if (!cachedDefault) return;
  const previous = cachedDefault;
  cachedDefault = null;
  try {
    previous.disconnect();
  } catch {
    //? Best-effort — a client that never connected can throw on disconnect.
  }
};

//? EAGER REPLACE (the secret-manager pointer fix): build a fresh default client
//? from the CURRENT (resolved) env and REGISTER it into the default slot so it
//? wins over the lazy resolver. This is what `resetDefaultRedisClient()` alone
//? could not do — a plain reset defers the rebuild (a stale/pointer value can
//? resurface by the time it's lazily rebuilt) and never overrides a client that
//? was already registered. Capturing the resolved secret NOW, into a registered
//? client, is immune to that. Disconnects the previous default first so rotation
//? doesn't leak a connection. The framework calls this on the secrets-resolved
//? hook and at the server boot when a secret-manager URL is configured.
export const rebuildDefaultRedisClient = (): RedisClient => {
  const previousRegistered = isRedisClientRegistered() ? getRedisClient() : null;
  resetDefaultRedisClient();
  const client = constructRedisClient();
  registerRedisClient(client);
  if (previousRegistered && previousRegistered !== client) {
    try {
      previousRegistered.disconnect();
    } catch {
      //? Best-effort — a client that never connected can throw on disconnect.
    }
  }
  return client;
};

setDefaultRedisResolver(buildDefaultRedisClient);

//? CORE-1 (decoupled hook): when a secret resolver reports that secrets were
//? (re)resolved — e.g. `@luckystack/secret-manager` wiring `onApplied` to
//? `notifySecretsResolved` — EAGERLY REBUILD + REGISTER the default client from
//? the now-resolved env if a `REDIS_` credential changed. Registering (not
//? resetting) is what lets a project run Redis auth via a secret-manager POINTER
//? with zero consumer code: the resolved secret is captured immediately into a
//? registered client that wins over the resolver. `undefined` (caller doesn't
//? know which keys changed) rebuilds defensively.
registerSecretsResolvedListener((changedKeys) => {
  if (changedKeys === undefined || changedKeys.some((key) => /^REDIS_/i.test(key))) {
    rebuildDefaultRedisClient();
  }
});

//? Single source of truth for Redis connection params. Used by
//? `@luckystack/router`'s bootHandshake (which opens its own short-lived
//? connections for cross-env probes) so a config rename touches only this
//? file. Reads env at call time so dotenv timing doesn't capture a stale
//? value.
export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export const getRedisConnectionOptions = (): RedisConnectionOptions => ({
  host: env.REDIS_HOST,
  port: Number.parseInt(env.REDIS_PORT, 10),
  ...(process.env.REDIS_USER ? { username: process.env.REDIS_USER } : {}),
  ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
});

//? Single-key commands whose FIRST argument is the key. The proxy runs that
//? argument through `applyStrayKeyPrefix` as a best-effort namespace net for
//? raw app keys; already-namespaced keys (anything containing `:`, which is
//? every framework key) pass through untouched, so framework behavior is
//? unchanged. Variadic / non-arg0-key commands (`del`, `scan`, `eval`,
//? `multi`, `mget`, ...) are deliberately excluded — their key positions can't
//? be inferred safely; those call sites use `formatKey()` explicitly.
const STRAY_PREFIX_COMMANDS = new Set<string>([
  'get', 'set', 'setex', 'psetex', 'setnx', 'getset', 'getdel', 'append', 'strlen',
  'expire', 'pexpire', 'expireat', 'pexpireat', 'persist', 'ttl', 'pttl', 'type',
  'incr', 'incrby', 'incrbyfloat', 'decr', 'decrby',
  'sadd', 'srem', 'smembers', 'scard', 'sismember', 'spop', 'srandmember',
  'hget', 'hset', 'hdel', 'hgetall', 'hkeys', 'hvals', 'hexists', 'hincrby', 'hmget', 'hmset',
  'lpush', 'rpush', 'lpop', 'rpop', 'llen', 'lrange', 'lrem',
  'zadd', 'zrem', 'zscore', 'zrange', 'zrank', 'zcard',
  'getbit', 'setbit', 'bitcount',
]);

//? Variadic commands whose EVERY string argument is a key (`del('a','b')`,
//? `mget('a','b')`). The single-key `STRAY_PREFIX_COMMANDS` set only prefixes
//? arg0, which left these asymmetric: `redis.set('flag', v)` wrote
//? `<project>:flag` while `redis.del('flag')` targeted the unprefixed `flag`
//? and silently no-op'd. Prefixing every string arg here closes that footgun
//? for revocation-style stray keys. (`eval`/`scan`/`multi` stay excluded —
//? their key positions can't be inferred and framework call sites already use
//? `formatKey()` there.)
const ALL_ARGS_ARE_KEYS_COMMANDS = new Set<string>([
  'del', 'unlink', 'exists', 'touch', 'mget',
]);

//? Extend the set of single-key, arg0-is-key commands the `redis` proxy runs
//? through `applyStrayKeyPrefix`. Additive — the built-in set above is always
//? retained — so a consumer using a Redis command the framework's default
//? list doesn't cover (a newer/module command whose first argument is the
//? key) can opt it into the multi-tenant stray-prefix net without forking.
//? Command names are matched case-insensitively, mirroring the proxy lookup.
//? Variadic / non-arg0-key commands must NOT be registered here — their key
//? positions can't be inferred safely; use `formatKey()` explicitly instead.
export const registerStrayPrefixCommand = (...commands: string[]): void => {
  for (const command of commands) {
    STRAY_PREFIX_COMMANDS.add(command.toLowerCase());
  }
};

//? Proxy: same pattern as `prisma`. Defers resolution until call time so
//? `registerRedisClient(...)` can still win after this module is loaded.
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Proxy target placeholder
const redisProxy = new Proxy({} as RedisClient, {
  get: (_target, prop, _receiver) => {
    const real = getRedisClient() as object;
    //? Pass `real` as receiver (CORE-N9) — see the same fix in `db.ts`.
    const value: unknown = Reflect.get(real, prop, real);
    if (typeof value !== 'function') return value;
    const fn = value as (...args: unknown[]) => unknown;
    const command = typeof prop === 'string' ? prop.toLowerCase() : '';
    if (command && ALL_ARGS_ARE_KEYS_COMMANDS.has(command)) {
      return (...args: unknown[]): unknown => {
        const prefixed = args.map((arg) => (typeof arg === 'string' ? applyStrayKeyPrefix(arg) : arg));
        return fn.apply(real, prefixed);
      };
    }
    if (command && STRAY_PREFIX_COMMANDS.has(command)) {
      return (...args: unknown[]): unknown => {
        if (args.length > 0 && typeof args[0] === 'string') {
          args[0] = applyStrayKeyPrefix(args[0]);
        }
        return fn.apply(real, args);
      };
    }
    return fn.bind(real);
  },
  has: (_target, prop) => Reflect.has(getRedisClient(), prop),
});

export const redis = redisProxy;
export default redisProxy;
