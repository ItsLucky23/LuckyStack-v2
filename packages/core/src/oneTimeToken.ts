//? One-time-token primitive (CORE-OTT). A namespaced, single-use, Redis-backed
//? token suitable for password-reset and email-change confirmation links — the
//? two flows `@luckystack/login` previously hand-rolled with the RAW token as
//? the Redis key.
//?
//? SECURITY — hashing at rest. The raw token is NEVER stored. We persist
//? `sha256(token)` (hex) as the Redis key, so a dump / read of the Redis
//? keyspace (a backup leak, an over-broad `KEYS` from another service, an
//? attacker with read-only Redis) does NOT yield usable tokens: an attacker
//? would have to brute-force a 256-bit preimage to mint a redemption. The raw
//? token is returned to the caller exactly once (to embed in the emailed URL)
//? and otherwise only ever exists in transit.
//?
//? CONSUME is atomic. Redemption is a single `MULTI` `GET`+`DEL`, so a token
//? can be redeemed AT MOST once even under concurrent clicks — the second
//? caller sees an empty `GET` and is rejected. A wrong / expired / malformed
//? token also fails closed (returns null).
//?
//? The key namespace is routed through `formatKey(namespace, hash)` so the
//? multi-tenant key formatter (and project-name prefixing) applies uniformly,
//? identical to every other framework key-site.

import { createHash, randomBytes } from 'node:crypto';

import { formatKey } from './redisKeyFormatter';
// eslint-disable-next-line import-x/no-named-as-default -- redis.ts ships both a default and a `redis` named export; the default is the proxy, matching every other framework key-site
import redis from './redis';
import tryCatchSync from './tryCatchSync';

//? 32 random bytes -> 64-char hex token (same entropy as the legacy
//? login reset/email-change tokens, so existing URL shapes are unchanged).
const TOKEN_BYTES = 32;

/** sha256(token) hex — the value actually used as the Redis key suffix. */
const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** Build the namespaced Redis key for a token's HASH (never the raw token). */
const tokenKey = (namespace: string, token: string): string =>
  formatKey(namespace, hashToken(token));

/**
 * Handle returned by {@link issueOneTimeToken}. `token` is the RAW token to hand
 * to the caller (embed in the emailed URL); call `store()` to persist its hash
 * to Redis with the configured TTL. Persisting is a separate step so the caller
 * can run veto logic (hooks, validation) between minting and committing without
 * leaving an orphan Redis key.
 */
export interface OneTimeTokenHandle {
  /** The raw, single-use token. Returned exactly once; never stored verbatim. */
  token: string;
  /** Persist `sha256(token)` -> `payload` in Redis with the issue TTL. */
  store(): Promise<void>;
}

/**
 * Mint a one-time token in `namespace` carrying `payload`, redeemable for `ttl`
 * seconds. Returns the raw token plus a `store()` committer. The payload is
 * serialised to a string (objects via JSON); on redemption it is returned as a
 * string and the caller parses it (or use {@link consumeOneTimeTokenJson}).
 *
 * @param namespace Key namespace (e.g. `'-pwreset'`, `'-email-change'`) — routed
 *   through `formatKey` so the active key formatter / project prefix applies.
 * @param ttlSeconds Time-to-live in seconds for the stored hash.
 * @param payload   Value bound to the token. A string is stored verbatim; any
 *   other value is `JSON.stringify`-d.
 */
export const issueOneTimeToken = (
  namespace: string,
  ttlSeconds: number,
  payload: string | Record<string, unknown>,
): OneTimeTokenHandle => {
  const token = randomBytes(TOKEN_BYTES).toString('hex');
  const value = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return {
    token,
    store: async (): Promise<void> => {
      await redis.set(tokenKey(namespace, token), value, 'EX', ttlSeconds);
    },
  };
};

/**
 * Atomically validate + consume a one-time token from `namespace`. Returns the
 * stored payload STRING on success (and deletes the entry, so it can never be
 * reused), or `null` when the token is missing / expired / malformed / already
 * consumed. A single `MULTI` `GET`+`DEL` guarantees at-most-once redemption.
 */
export const consumeOneTimeToken = async (
  namespace: string,
  token: string,
): Promise<string | null> => {
  if (!token || typeof token !== 'string') return null;
  const key = tokenKey(namespace, token);
  const txResult = await redis.multi().get(key).del(key).exec();
  if (!txResult || txResult.length < 2) return null;
  const first = txResult[0];
  if (!first) return null;
  const [getErr, value] = first;
  if (getErr) return null;
  //? Verify the DEL also succeeded (txResult[1][0] is the per-command error slot).
  //? If DEL failed the key was not consumed — return null (fail-closed) so the
  //? token is not considered redeemed and cannot be replayed.
  const second = txResult[1];
  if (!second || second[0]) return null;
  return typeof value === 'string' && value.length > 0 ? value : null;
};

/**
 * Convenience wrapper over {@link consumeOneTimeToken} that JSON-parses the
 * stored payload into `T`. Returns `null` on miss OR on a malformed JSON
 * payload. Use when the token was issued with an object payload.
 */
export const consumeOneTimeTokenJson = async <T>(
  namespace: string,
  token: string,
): Promise<T | null> => {
  const raw = await consumeOneTimeToken(namespace, token);
  if (raw === null) return null;
  const [parseErr, parsed] = tryCatchSync(() => JSON.parse(raw) as T);
  if (parseErr) return null;
  return parsed;
};

//? Exported for tests + any consumer that needs to derive the stored key shape
//? (e.g. an admin tool listing/expiring outstanding tokens) WITHOUT possessing
//? the raw token is impossible by design — this helper requires the raw token,
//? matching the at-rest guarantee.
export const oneTimeTokenKey = tokenKey;
