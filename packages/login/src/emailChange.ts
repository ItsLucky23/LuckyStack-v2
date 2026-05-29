//? Email-change token primitives. Mirrors `passwordReset.ts` for the
//? confirm-via-email-link flow: user submits a new address, framework mails
//? a tokenized URL to the NEW address, click-through confirms and updates
//? `User.email` + revokes all sessions.
//?
//? Token format: 32 random bytes hex-encoded -> 64-char URL-safe string.
//? Storage: `<projectName>-email-change:<token>` -> JSON payload
//?   `{ userId: string; newEmail: string }`
//? TTL: `auth.emailChangeTtlSeconds` (default 3600 = 1 hour).

import { randomBytes } from 'node:crypto';

import { getProjectConfig, getProjectName, redis } from '@luckystack/core';

const tokenKey = (token: string): string => `${getProjectName()}-email-change:${token}`;

export interface EmailChangePayload {
  userId: string;
  newEmail: string;
}

/**
 * Create a one-time email-change token bound to a user id + the new email
 * address. Stored in Redis with the configured TTL. Returns the token string
 * — caller emails the token (embedded in a URL) to the NEW address so the
 * confirmation click proves ownership of the new mailbox.
 */
export const createEmailChangeToken = async (userId: string, newEmail: string): Promise<string> => {
  const token = randomBytes(32).toString('hex');
  const ttl = getProjectConfig().auth.emailChangeTtlSeconds;
  const payload = JSON.stringify({ userId, newEmail } satisfies EmailChangePayload);
  await redis.set(tokenKey(token), payload, 'EX', ttl);
  return token;
};

/**
 * Validate and consume an email-change token. Returns the bound
 * `{ userId, newEmail }` on success and removes the token (one-time use).
 * Returns null when the token is missing, expired, or malformed.
 */
export const consumeEmailChangeToken = async (token: string): Promise<EmailChangePayload | null> => {
  if (!token || typeof token !== 'string') return null;
  const key = tokenKey(token);
  const txResult = await redis.multi().get(key).del(key).exec();
  if (!txResult || txResult.length === 0) return null;
  const first = txResult[0];
  if (!first) return null;
  const [getErr, value] = first;
  if (getErr) return null;
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      !parsed
      || typeof parsed !== 'object'
      || typeof (parsed as EmailChangePayload).userId !== 'string'
      || typeof (parsed as EmailChangePayload).newEmail !== 'string'
    ) {
      return null;
    }
    return parsed as EmailChangePayload;
  } catch {
    return null;
  }
};
