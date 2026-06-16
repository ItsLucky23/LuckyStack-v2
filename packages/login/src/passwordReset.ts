//? Password-reset primitives. Used by the framework's own forgot-password
//? flow when `ProjectConfig.auth.forgotPassword === 'framework'`, AND
//? exported as building blocks for consumers who picked `'custom'` and want
//? to wire their own UI / email layer without re-implementing crypto + Redis.
//?
//? Token format: 32 random bytes hex-encoded → 64-char URL-safe string.
//? Storage: `<projectName>-pwreset:<sha256(token)> → userId` with a configurable
//? TTL (`auth.passwordResetTtlSeconds`, default 3600 = 1 hour).
//?
//? HASHED AT REST (0.2.0): the raw token is NEVER stored — we persist only
//? `sha256(token)` (the Redis key) via the `@luckystack/core` one-time-token
//? primitive, so a leaked Redis keyspace can't be replayed to mint a reset.
//? The raw token is returned to the caller exactly once for the emailed URL.

// eslint-disable-next-line import-x/no-named-as-default -- bcryptjs ships both a default and namespace export; using the default mirrors its README
import bcrypt from 'bcryptjs';
/* eslint-disable import-x/no-named-as-default-member -- accessing genSalt/hash/compare via the default import is the documented pattern */

import { getProjectConfig, issueOneTimeToken, consumeOneTimeToken } from '@luckystack/core';

import { validatePassword } from './passwordPolicy';
import { getUserAdapter } from './userAdapter';

//? Shared key namespace for the one-time-token primitive. `formatKey('-pwreset',
//? sha256(token))` is applied inside the primitive, so the project-name prefix /
//? multi-tenant formatter still apply — only the SUFFIX is now the hash, not the
//? raw token (the historical `<projectName>-pwreset:<token>` shape becomes
//? `<projectName>-pwreset:<sha256(token)>`).
const PWRESET_NAMESPACE = '-pwreset';

/**
 * Create a one-time password-reset token bound to a user id. Stored in Redis
 * with the configured TTL — only `sha256(token)` is persisted (hash-at-rest).
 * Returns the raw token string — caller emails it to the user (typically
 * embedded in a URL).
 */
export const createPasswordResetToken = async (userId: string): Promise<string> => {
  const ttl = getProjectConfig().auth.passwordResetTtlSeconds;
  const handle = issueOneTimeToken(PWRESET_NAMESPACE, ttl, userId);
  await handle.store();
  return handle.token;
};

/**
 * Validate and consume a password-reset token. Returns the bound userId on
 * success and removes the token (one-time use, atomic GET+DEL). Returns null
 * when the token is missing, expired, malformed, or already consumed.
 */
export const consumePasswordResetToken = async (token: string): Promise<string | null> => {
  return consumeOneTimeToken(PWRESET_NAMESPACE, token);
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
  const patch: Record<string, unknown> = { password: hashedPassword };
  await getUserAdapter().update(userId, patch);
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
