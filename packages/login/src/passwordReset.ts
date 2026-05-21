//? Password-reset primitives. Used by the framework's own forgot-password
//? flow when `ProjectConfig.auth.forgotPassword === 'framework'`, AND
//? exported as building blocks for consumers who picked `'custom'` and want
//? to wire their own UI / email layer without re-implementing crypto + Redis.
//?
//? Token format: 32 random bytes hex-encoded → 64-char URL-safe string.
//? Storage: `<projectName>-pwreset:<token> → userId` with a configurable TTL
//? (`auth.passwordResetTtlSeconds`, default 3600 = 1 hour).

import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

import { getProjectConfig, getProjectName, redis } from '@luckystack/core';

import { validatePassword } from './passwordPolicy';
import { getUserAdapter } from './userAdapter';

//? Resolve at call time via the shared `getProjectName()` helper (single
//? source of truth — see also session.ts, rateLimiter.ts, login.ts). Avoids
//? the module-load capture bug where dotenv timing could put tokens under
//? the wrong namespace.
const tokenKey = (token: string): string => `${getProjectName()}-pwreset:${token}`;

/**
 * Create a one-time password-reset token bound to a user id. Stored in Redis
 * with the configured TTL. Returns the token string — caller emails it to
 * the user (typically embedded in a URL).
 */
export const createPasswordResetToken = async (userId: string): Promise<string> => {
  const token = randomBytes(32).toString('hex');
  const ttl = getProjectConfig().auth.passwordResetTtlSeconds;
  await redis.set(tokenKey(token), userId, 'EX', ttl);
  return token;
};

/**
 * Validate and consume a password-reset token. Returns the bound userId on
 * success and removes the token (one-time use). Returns null when the token
 * is missing, expired, or malformed.
 */
export const consumePasswordResetToken = async (token: string): Promise<string | null> => {
  if (!token || typeof token !== 'string') return null;
  const key = tokenKey(token);
  const txResult = await redis.multi().get(key).del(key).exec();
  if (!txResult || txResult.length < 1) return null;
  const [getErr, value] = txResult[0];
  if (getErr) return null;
  return typeof value === 'string' && value.length > 0 ? value : null;
};

/**
 * Bcrypt-hash a plaintext password and write it to the user record via the
 * registered user adapter. Used by the reset flow and by the settings
 * password-change flow. Validates against the active password policy
 * (`projectConfig.auth.passwordPolicy`) before hashing — throws a `PasswordPolicyError`
 * when the plaintext fails policy. Catch and surface the error code to the
 * client; framework-mode reset/change flows already do this.
 */
export const updatePasswordHash = async (userId: string, plaintext: string): Promise<void> => {
  const reason = validatePassword(plaintext);
  if (reason) {
    throw new PasswordPolicyError(reason);
  }
  const salt = await bcrypt.genSalt(getProjectConfig().auth.bcryptRounds);
  const hashedPassword = await bcrypt.hash(plaintext, salt);
  await getUserAdapter().update(userId, { password: hashedPassword } as never);
};

/**
 * Thrown by `updatePasswordHash` when the supplied plaintext violates the
 * active password policy. `errorCode` matches the i18n reason key the rest
 * of the login flow uses (e.g. `login.passwordRequiresUppercase`).
 */
export class PasswordPolicyError extends Error {
  readonly errorCode: string;
  constructor(errorCode: string) {
    super(`Password policy violation: ${errorCode}`);
    this.name = 'PasswordPolicyError';
    this.errorCode = errorCode;
  }
}

/** Verify a plaintext password against a stored bcrypt hash. */
export const verifyPassword = async (plaintext: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(plaintext, hash);
};
