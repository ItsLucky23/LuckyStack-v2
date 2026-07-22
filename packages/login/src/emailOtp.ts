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
//? Issue and consume are each one Redis Lua transaction. This is stronger than
//? a final DEL winner check: GET-old → SET-new → DEL used to let an in-flight
//? verifier authenticate with the superseded hash and delete the newly issued
//? code. Linearizing SET+counter-reset and compare+attempt+DEL means every
//? issue/verify race has one unambiguous generation order.

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

const ISSUE_CODE_SCRIPT = `
redis.call('set', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('del', KEYS[2])
return 1
`;

//? Return codes: 0 expired, 1 invalid, 2 valid, 3 locked. The comparison is
//? between fixed-length SHA-256 hex strings inside Redis; raw low-entropy codes
//? never enter Redis and are never used as keys.
const VERIFY_CODE_SCRIPT = `
local stored = redis.call('get', KEYS[1])
if not stored then return 0 end
local attempts = redis.call('incr', KEYS[2])
local remaining = redis.call('ttl', KEYS[1])
redis.call('expire', KEYS[2], remaining > 0 and remaining or 600)
if attempts > tonumber(ARGV[2]) then
  redis.call('del', KEYS[1])
  redis.call('del', KEYS[2])
  return 3
end
if stored ~= ARGV[1] then return 1 end
redis.call('del', KEYS[1])
redis.call('del', KEYS[2])
return 2
`;

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
  await redis.eval(
    ISSUE_CODE_SCRIPT,
    2,
    codeKey(purpose, identity),
    attemptsKey(purpose, identity),
    hashCode(code),
    String(ttlSeconds),
  );
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
  const result = Number(await redis.eval(
    VERIFY_CODE_SCRIPT,
    2,
    codeKey(purpose, identity),
    attemptsKey(purpose, identity),
    hashCode(code.trim()),
    String(maxAttempts),
  ));
  if (result === 2) return 'valid';
  if (result === 1) return 'invalid';
  if (result === 3) return 'locked';
  return 'expired';
};

/** Drop any active code + counter for the slot (e.g. after a completed login). */
export const clearEmailCode = async (purpose: EmailOtpPurpose, identity: string): Promise<void> => {
  await redis.del(codeKey(purpose, identity));
  await redis.del(attemptsKey(purpose, identity));
};
