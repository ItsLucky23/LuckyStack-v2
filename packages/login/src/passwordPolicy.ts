//? Password-policy enforcement for credentials auth. Read by
//? `registerWithCredentials` and `updatePasswordHash` to validate plaintext
//? passwords against the consumer-tunable `projectConfig.auth.passwordPolicy`.
//?
//? Returns null when the password passes every check, or a reason-key
//? (i18n-style errorCode) describing the first failure. Callers surface
//? the reason to the client; the framework's i18n layer handles
//? translation.

import { getProjectConfig } from '@luckystack/core';

import { COMMON_PASSWORDS } from './data/commonPasswords';

const UPPERCASE_REGEX = /[A-Z]/;
const LOWERCASE_REGEX = /[a-z]/;
const NUMBER_REGEX = /\d/;
const SPECIAL_REGEX = /[^A-Za-z0-9]/;

/**
 * Validate `password` against the active project's password policy.
 * Returns null on success, a string reason-key on the first failure.
 *
 * The policy lives in `projectConfig.auth.passwordPolicy` and is read at
 * call time, so consumers can override defaults via `registerProjectConfig`.
 */
export const validatePassword = (password: string): string | null => {
  const policy = getProjectConfig().auth.passwordPolicy;

  if (password.length < policy.minLength) return 'login.passwordCharacterMinimum';
  if (password.length > policy.maxLength) return 'login.passwordCharacterLimit';
  if (policy.requireUppercase && !UPPERCASE_REGEX.test(password)) return 'login.passwordRequiresUppercase';
  if (policy.requireLowercase && !LOWERCASE_REGEX.test(password)) return 'login.passwordRequiresLowercase';
  if (policy.requireNumber && !NUMBER_REGEX.test(password)) return 'login.passwordRequiresNumber';
  if (policy.requireSpecial && !SPECIAL_REGEX.test(password)) return 'login.passwordRequiresSpecial';
  if (policy.forbidCommon && COMMON_PASSWORDS.has(password.toLowerCase())) return 'login.passwordTooCommon';
  if (policy.customValidator) {
    const customReason = policy.customValidator(password);
    if (customReason) return customReason;
  }

  return null;
};
