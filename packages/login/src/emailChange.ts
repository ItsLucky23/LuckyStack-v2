//? Email-change token primitives. Mirrors `passwordReset.ts` for the
//? confirm-via-email-link flow: user submits a new address, framework mails
//? a tokenized URL to the NEW address, click-through confirms and updates
//? `User.email` + revokes all sessions.
//?
//? Token format: 32 random bytes hex-encoded -> 64-char URL-safe string.
//? Storage: `<projectName>-email-change:<sha256(token)>` -> JSON payload
//?   `{ userId: string; newEmail: string }`
//? TTL: `auth.emailChangeTtlSeconds` (default 3600 = 1 hour).
//?
//? HASHED AT REST (0.2.0): only `sha256(token)` is persisted (the Redis key)
//? via the `@luckystack/core` one-time-token primitive, so a leaked Redis
//? keyspace can't be replayed to confirm an email change. The raw token is
//? returned to the caller exactly once for the emailed URL.

import { getProjectConfig, issueOneTimeToken, consumeOneTimeTokenJson, formatKey, redis, oneTimeTokenKey } from '@luckystack/core';

const EMAIL_CHANGE_NAMESPACE = '-email-change';

//? Per-user pointer key for prior-token invalidation (LOGIN-F16), mirroring the
//? same pattern used for password-reset tokens. Stored as a formatted key so the
//? multi-tenant key formatter applies uniformly.
const emailChangeUserKey = (userId: string): string => formatKey('-email-change-user', userId);

export interface EmailChangePayload {
  userId: string;
  newEmail: string;
}

/**
 * Create a one-time email-change token bound to a user id + the new email
 * address. Any previously issued (but not yet consumed) token for the same
 * user is invalidated first (LOGIN-F16) so at most one confirmation link per
 * user is redeemable. Stored in Redis with the configured TTL — only
 * `sha256(token)` is persisted (hash-at-rest). Returns the raw token string —
 * caller emails the token (embedded in a URL) to the NEW address so the
 * confirmation click proves ownership of the new mailbox.
 */
export const createEmailChangeToken = async (userId: string, newEmail: string): Promise<string> => {
  const ttl = getProjectConfig().auth.emailChangeTtlSeconds;

  //? Invalidate the prior active email-change token (LOGIN-F16). Without this,
  //? multiple links could be outstanding concurrently — a link sent to an
  //? attacker-controlled address (via a race or a compromised session) would
  //? remain redeemable even after the user re-requests the flow.
  const priorKey = await redis.get(emailChangeUserKey(userId));
  if (priorKey) {
    await redis.del(priorKey);
  }

  const handle = issueOneTimeToken(
    EMAIL_CHANGE_NAMESPACE,
    ttl,
    { userId, newEmail } satisfies EmailChangePayload,
  );
  await handle.store();

  //? Record the new hash-key so the NEXT issue can invalidate this one.
  const newHashKey = oneTimeTokenKey(EMAIL_CHANGE_NAMESPACE, handle.token);
  await redis.set(emailChangeUserKey(userId), newHashKey, 'EX', ttl);

  return handle.token;
};

/**
 * Validate and consume an email-change token. Returns the bound
 * `{ userId, newEmail }` on success and removes the token (one-time use, atomic
 * GET+DEL). Returns null when the token is missing, expired, malformed, or
 * already consumed.
 */
export const consumeEmailChangeToken = async (token: string): Promise<EmailChangePayload | null> => {
  const parsed = await consumeOneTimeTokenJson<EmailChangePayload>(EMAIL_CHANGE_NAMESPACE, token);
  if (
    !parsed
    || typeof parsed !== 'object'
    || typeof parsed.userId !== 'string'
    || typeof parsed.newEmail !== 'string'
  ) {
    return null;
  }
  return parsed;
};
