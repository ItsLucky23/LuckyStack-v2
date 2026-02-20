/**
 * Shared validation utilities for API and Sync request handlers.
 * Extracted to avoid code duplication between handleApiRequest and handleSyncRequest.
 */

import type { SessionLayout, AuthProps } from '../../config';

/**
 * Check if a value is falsy (false, 0, 0n, '', null, undefined, or NaN)
 */
export const isFalsy = (value: unknown): boolean => {
  return (
    value === false ||
    value === 0 ||
    value === 0n ||
    value === '' ||
    value === null ||
    value === undefined ||
    (typeof value === 'number' && isNaN(value))
  );
};

export interface ValidationResult {
  status: 'success' | 'error';
  errorCode?: string;
  errorParams?: { key: string; value: string | number | boolean; }[];
  httpStatus?: number;
}

/**
 * Validate a request against authentication requirements.
 * 
 * @example Basic login check
 * ```typescript
 * const auth = { login: true };
 * const result = validateRequest({ auth, user });
 * ```
 * 
 * @example Additional field checks
 * ```typescript
 * const auth = { 
 *   login: true,
 *   additional: [
 *     { key: 'admin', value: true },           // Must be admin
 *     { key: 'email', type: 'string' },        // Email must be string
 *     { key: 'deletedAt', nullish: true },     // Must be null/undefined
 *     { key: 'isVerified', mustBeFalsy: false } // Must be truthy
 *   ]
 * };
 * ```
 */
export const validateRequest = ({
  auth,
  user
}: {
  auth: AuthProps;
  user: SessionLayout;
}): ValidationResult => {

  if (!auth.additional) {
    return { status: 'success' };
  }

  for (const condition of auth.additional) {
    // Validate condition has required key
    if (!condition.key) {
      return {
        status: 'error',
        errorCode: 'auth.invalidCondition',
        httpStatus: 500,
      };
    }

    // Check if key exists in user session
    if (!(condition.key in user)) {
      return {
        status: 'error',
        errorCode: 'auth.invalidCondition',
        errorParams: [{ key: 'key', value: String(condition.key) }],
        httpStatus: 500,
      };
    }

    const val = user[condition.key as keyof SessionLayout];

    // Check nullish constraint
    if (typeof condition.nullish === 'boolean') {
      const isNullish = val === null || val === undefined;
      if (condition.nullish && !isNullish) {
        return {
          status: 'error',
          errorCode: 'auth.forbidden',
          errorParams: [{ key: 'key', value: String(condition.key) }],
          httpStatus: 403,
        };
      }
      if (!condition.nullish && isNullish) {
        return {
          status: 'error',
          errorCode: 'auth.forbidden',
          errorParams: [{ key: 'key', value: String(condition.key) }],
          httpStatus: 403,
        };
      }
    }

    // Check type constraint (skip null or undefined values)
    if (condition.type && val != null) {
      if (typeof val !== condition.type) {
        return {
          status: 'error',
          errorCode: 'auth.forbidden',
          errorParams: [{ key: 'key', value: String(condition.key) }],
          httpStatus: 403,
        };
      }
    }

    // Check exact value constraint (strict equality)
    if ('value' in condition) {
      if (val !== condition.value) {
        return {
          status: 'error',
          errorCode: 'auth.forbidden',
          errorParams: [{ key: 'key', value: String(condition.key) }],
          httpStatus: 403,
        };
      }
    }

    // Check truthy/falsy constraint
    if (typeof condition.mustBeFalsy === 'boolean') {
      if (condition.mustBeFalsy && !isFalsy(val)) {
        return {
          status: 'error',
          errorCode: 'auth.forbidden',
          errorParams: [{ key: 'key', value: String(condition.key) }],
          httpStatus: 403,
        };
      }
      if (!condition.mustBeFalsy && isFalsy(val)) {
        return {
          status: 'error',
          errorCode: 'auth.forbidden',
          errorParams: [{ key: 'key', value: String(condition.key) }],
          httpStatus: 403,
        };
      }
    }
  }

  return { status: 'success' };
};
