//? Email-OTP primitive: short numeric codes typed over from an email —
//? passwordless login ("email-code") and the 2FA email fallback both build on
//? this. It deliberately does NOT reuse the core one-time-token primitive:
//? that one is keyed BY sha256(token), which is only safe for high-entropy
//? (256-bit) tokens. A 6-digit code has 10^6 possibilities — hashing it as the
//? KEY would be brute-forceable from a Redis dump and unfindable at verify
//? time. So codes are keyed by PURPOSE + IDENTITY instead, with the code hash
//? in the VALUE, a server-side attempt counter, and at most ONE active code
//? per (purpose, identity): re-issuing overwrites the previous code.
//?
//? Consume is at-most-once: the final DEL doubles as the winner-take-all lock
//? (mirrors consumeOneTimeToken's atomic GET+DEL semantics for parallel
//? verifies with the correct code).

import crypto from 'node:crypto';
import { formatKey, redis } from '@luckystack/core';

export type EmailOtpPurpose = 'login' | '2fa';

//? Identity is an email (login) or userId (2fa). Normalize emails the same way
//? the lockout does so `Foo@Bar.com` and `foo@bar.com` share one code slot.
const normalizeIdentity = (identity: string): string => identity.trim().toLowerCase();

const codeKey = (purpose: EmailOtpPurpose, identity: string): string =>
  formatKey('-emailcode', `${purpose}:${normalizeIdentity(identity)}`);
const attemptsKey = (purpose: EmailOtpPurpose, identity: string): string =>
  formatKey('-emailcode-attempts', `${purpose}:${normalizeIdentity(identity)}`);

const hashCode = (code: string): string => crypto.createHash('sha256').update(code).digest('hex');

//? Uniform random numeric code. `crypto.randomInt` does rejection sampling
//? internally — NO modulo bias (a plain `randomBytes % 10^n` would skew low
//? digits), and unlike `hotp()` it is not derived from any counter/secret.
export const generateNumericCode = (digits: number): string =>
  String(crypto.randomInt(0, 10 ** digits)).padStart(digits, '0');

export interface IssueEmailCodeInput {
  purpose: EmailOtpPurpose;
  /** Email address (login) or userId (2fa). */
  identity: string;
  ttlSeconds: number;
  digits: number;
}

/**
 * Mint + store a fresh code for (purpose, identity). Any previously active
 * code for the same slot is replaced, and its attempt counter reset. Returns
 * the RAW code exactly once — the caller emails it; only sha256(code) is
 * stored (hash-at-rest, ADR 0010 spirit).
 */
export const issueEmailCode = async ({ purpose, identity, ttlSeconds, digits }: IssueEmailCodeInput): Promise<string> => {
  const code = generateNumericCode(digits);
  await redis.set(codeKey(purpose, identity), hashCode(code), 'EX', ttlSeconds);
  await redis.del(attemptsKey(purpose, identity));
  return code;
};

export type EmailCodeVerdict = 'valid' | 'invalid' | 'expired' | 'locked';

export interface VerifyEmailCodeInput {
  purpose: EmailOtpPurpose;
  identity: string;
  code: string;
  /** Wrong-code attempts before the code is burned (counter is server-side). */
  maxAttempts: number;
}

/**
 * Verify + consume. Verdicts: 'valid' (code matched, slot consumed),
 * 'invalid' (wrong code, attempt recorded), 'locked' (attempt budget spent —
 * the active code is burned so guessing can't continue), 'expired' (no active
 * code: TTL passed, never issued, or already consumed).
 */
export const verifyEmailCode = async ({ purpose, identity, code, maxAttempts }: VerifyEmailCodeInput): Promise<EmailCodeVerdict> => {
  const key = codeKey(purpose, identity);
  const storedHash = await redis.get(key);
  if (!storedHash) return 'expired';

  //? Count the attempt FIRST (INCR is atomic across parallel verifies), and
  //? give the counter the code's own remaining TTL so it can't outlive it.
  //? If the code expired between the GET above and this TTL read (`remaining`
  //? <= 0), still bound the counter with a short fallback so a just-INCR'd
  //? counter can never linger without a TTL.
  const counter = attemptsKey(purpose, identity);
  const attempts = await redis.incr(counter);
  const remaining = await redis.ttl(key);
  await redis.expire(counter, remaining > 0 ? remaining : 600);
  if (attempts > maxAttempts) {
    await redis.del(key);
    await redis.del(counter);
    return 'locked';
  }

  const submitted = Buffer.from(hashCode(code.trim()));
  const expected = Buffer.from(storedHash);
  const matches = submitted.length === expected.length && crypto.timingSafeEqual(submitted, expected);
  if (!matches) return 'invalid';

  //? Winner-take-all consume: DEL returns how many keys were removed — 0 means
  //? a parallel verify with the same correct code beat us to it.
  const deleted = await redis.del(key);
  await redis.del(counter);
  return deleted > 0 ? 'valid' : 'expired';
};

/** Drop any active code + counter for the slot (e.g. after a completed login). */
export const clearEmailCode = async (purpose: EmailOtpPurpose, identity: string): Promise<void> => {
  await redis.del(codeKey(purpose, identity));
  await redis.del(attemptsKey(purpose, identity));
};
