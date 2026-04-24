/**
 * Shared validation utilities for API and Sync request handlers.
 * Extracted to avoid code duplication between handleApiRequest and handleSyncRequest.
 */

import type { AuthProps, BaseSessionLayout } from '@luckystack/login';

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
    (typeof value === 'number' && Number.isNaN(value))
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
 */
export const validateRequest = ({
  auth,
  user
}: {
  auth: AuthProps;
  user: BaseSessionLayout;
}): ValidationResult => {

  if (!auth.additional) {
    return { status: 'success' };
  }

  for (const condition of auth.additional) {
    // Check if key exists in user session
    if (!(condition.key in user)) {
      return {
        status: 'error',
        errorCode: 'auth.invalidCondition',
        errorParams: [{ key: 'key', value: condition.key }],
        httpStatus: 500,
      };
    }

    const val = user[condition.key];

    // Check nullish constraint
    if (typeof condition.nullish === 'boolean') {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      const isNullish = val === null || val === undefined;
      if (condition.nullish && !isNullish) {
        return {
          status: 'error',
          errorCode: 'auth.forbidden',
          errorParams: [{ key: 'key', value: condition.key }],
          httpStatus: 403,
        };
      }
      if (!condition.nullish && isNullish) {
        return {
          status: 'error',
          errorCode: 'auth.forbidden',
          errorParams: [{ key: 'key', value: condition.key }],
          httpStatus: 403,
        };
      }
    }

    // Check type constraint (skip null or undefined values)
    if (condition.type && val != null && typeof val !== condition.type) {
        return {
          status: 'error',
          errorCode: 'auth.forbidden',
          errorParams: [{ key: 'key', value: condition.key }],
          httpStatus: 403,
        };
      }

    // Check exact value constraint (strict equality)
    if ('value' in condition && val !== condition.value) {
        return {
          status: 'error',
          errorCode: 'auth.forbidden',
          errorParams: [{ key: 'key', value: condition.key }],
          httpStatus: 403,
        };
      }

    // Check truthy/falsy constraint
    if (typeof condition.mustBeFalsy === 'boolean') {
      if (condition.mustBeFalsy && !isFalsy(val)) {
        return {
          status: 'error',
          errorCode: 'auth.forbidden',
          errorParams: [{ key: 'key', value: condition.key }],
          httpStatus: 403,
        };
      }
      if (!condition.mustBeFalsy && isFalsy(val)) {
        return {
          status: 'error',
          errorCode: 'auth.forbidden',
          errorParams: [{ key: 'key', value: condition.key }],
          httpStatus: 403,
        };
      }
    }
  }

  return { status: 'success' };
};
