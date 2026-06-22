/**
 * Shared validation utilities for API and Sync request handlers.
 * Extracted to avoid code duplication between handleApiRequest and handleSyncRequest.
 */

import type { AuthProps, BaseSessionLayout } from './sessionTypes';

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
 *
 * Multiple constraints on a single `additional` entry are AND'd: every
 * specified field (`nullish`, `type`, `value`, `mustBeFalsy`) must pass
 * for that entry to validate. Each entry across the array is also AND'd:
 * the request must pass every entry to succeed.
 *
 * Constraint semantics:
 *   - `nullish: true`     — `val` must be `null` or `undefined`.
 *   - `nullish: false`    — `val` must NOT be `null` or `undefined`.
 *   - `type: 'string'`    — `typeof val === 'string'` (skipped when val is null/undefined).
 *   - `value: <x>`        — strict equality `val === x`. Omit the field entirely if you
 *                           don't want this check; setting `value: undefined`
 *                           explicitly means "val must be undefined".
 *   - `mustBeFalsy: true`  — `isFalsy(val)`.
 *   - `mustBeFalsy: false` — `!isFalsy(val)`.
 *
 * **SECURITY CONTRACT**: this function does NOT check `auth.login`. Login
 * enforcement is the responsibility of the surrounding API/sync handler — it
 * must verify the session exists before calling `validateRequest`. Callers
 * that omit the login check will allow unauthenticated requests through the
 * `additional[]` predicates even when `auth.login: true` is declared, because
 * `validateRequest` short-circuits to success when `additional` is empty.
 * The expected call pattern is:
 *   1. Check session exists (enforce `auth.login`).
 *   2. Call `validateRequest({ auth, user })` to enforce `auth.additional[]`.
 */
export const validateRequest = ({
  auth,
  user
}: {
  auth: AuthProps;
  //? Null-safe (api F4 / SYNC-02-root): unauth / additional-only routes used to
  //? pass a non-null assertion (`user!`) here even when no session existed,
  //? which crashed once `additional[]` was present (the `condition.key in user`
  //? check throws on null/undefined). `user` is now optional; when it is
  //? absent we forbid any `additional[]` predicate (an unauthenticated request
  //? can't satisfy a session-field constraint) instead of throwing. A route with
  //? no `additional` still succeeds regardless of `user` (login itself is
  //? enforced by the surrounding handler, not here).
  user?: BaseSessionLayout | null;
}): ValidationResult => {

  //? No predicates to evaluate — succeed regardless of `user`. This MUST treat
  //? an empty array the same as an absent one: the prod/generated auth map
  //? normalizes every `auth` to include `additional: []`, so a non-empty-array
  //? guard alone would forbid every PUBLIC route (login:false) for anonymous
  //? callers once the null-user branch below runs.
  if (!auth.additional || auth.additional.length === 0) {
    return { status: 'success' };
  }

  const forbid = (key: string): ValidationResult => ({
    status: 'error',
    errorCode: 'auth.forbidden',
    errorParams: [{ key: 'key', value: key }],
    httpStatus: 403,
  });

  //? No session but the route declares `additional[]` predicates: an
  //? unauthenticated request cannot satisfy any session-field constraint, so
  //? forbid the first one rather than dereferencing a null `user`.
  if (user === null || user === undefined) {
    return forbid(auth.additional[0]?.key ?? '');
  }

  for (const condition of auth.additional) {
    // Key must exist in user session — that's a setup error, not a runtime auth fail.
    if (!(condition.key in user)) {
      return {
        status: 'error',
        errorCode: 'auth.invalidCondition',
        errorParams: [{ key: 'key', value: condition.key }],
        httpStatus: 500,
      };
    }

    const val = user[condition.key];
    const isNullish = val === null || val === undefined;

    if (typeof condition.nullish === 'boolean' && condition.nullish !== isNullish) {
      return forbid(condition.key);
    }

    if (condition.type && !isNullish && typeof val !== condition.type) {
      return forbid(condition.key);
    }

    //? Use `'value' in condition` so an explicit `value: undefined` still
    //? participates (caller saying "val must be undefined"), distinct from
    //? the omitted case (no exact-value constraint).
    if ('value' in condition && val !== condition.value) {
      return forbid(condition.key);
    }

    if (typeof condition.mustBeFalsy === 'boolean' && condition.mustBeFalsy !== isFalsy(val)) {
      return forbid(condition.key);
    }
  }

  return { status: 'success' };
};
