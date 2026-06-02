import { describe, it, expect } from 'vitest';

import {
  INVALID_ERROR_RESPONSE_CODE,
  isErrorParamArray,
  normalizeErrorResponseCore,
  defaultHttpStatusForResponse,
} from './responseNormalizer';

describe('isErrorParamArray', () => {
  it('accepts an array of {key, value} with string/number/boolean values', () => {
    expect(
      isErrorParamArray([
        { key: 'a', value: 'text' },
        { key: 'b', value: 7 },
        { key: 'c', value: true },
      ]),
    ).toBe(true);
  });

  it('accepts an empty array', () => {
    expect(isErrorParamArray([])).toBe(true);
  });

  it('rejects a non-array', () => {
    expect(isErrorParamArray('not-an-array')).toBe(false);
    expect(isErrorParamArray(null)).toBe(false);
    expect(isErrorParamArray(42)).toBe(false);
  });

  it('rejects entries whose key is not a string', () => {
    expect(isErrorParamArray([{ key: 5, value: 'x' }])).toBe(false);
  });

  it('rejects entries whose value is not string/number/boolean', () => {
    expect(isErrorParamArray([{ key: 'a', value: { nested: true } }])).toBe(false);
    expect(isErrorParamArray([{ key: 'a', value: null }])).toBe(false);
  });

  it('rejects falsy / non-object items inside the array', () => {
    expect(isErrorParamArray([null])).toBe(false);
    expect(isErrorParamArray([0])).toBe(false);
  });
});

describe('normalizeErrorResponseCore', () => {
  it('uses a trimmed errorCode and defaults the message to the errorCode when no resolver is given', () => {
    const result = normalizeErrorResponseCore({
      response: { errorCode: '  auth.required  ' },
    });

    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('auth.required');
    expect(result.message).toBe('auth.required');
  });

  it('falls back to INVALID_ERROR_RESPONSE_CODE when errorCode is empty/missing', () => {
    const result = normalizeErrorResponseCore({ response: {} });

    expect(result.errorCode).toBe(INVALID_ERROR_RESPONSE_CODE);
    expect(result.message).toBe(INVALID_ERROR_RESPONSE_CODE);
  });

  it('uses the supplied fallbackErrorCode over the invalid-response default', () => {
    const result = normalizeErrorResponseCore({
      response: { errorCode: '   ' },
      fallbackErrorCode: 'custom.fallback',
    });

    expect(result.errorCode).toBe('custom.fallback');
  });

  it('passes valid errorParams through and drops malformed ones', () => {
    const valid = normalizeErrorResponseCore({
      response: { errorCode: 'x', errorParams: [{ key: 'k', value: 1 }] },
    });
    expect(valid.errorParams).toEqual([{ key: 'k', value: 1 }]);

    const invalid = normalizeErrorResponseCore({
      response: { errorCode: 'x', errorParams: 'nope' },
    });
    expect(invalid.errorParams).toBeUndefined();
  });

  it('invokes resolveMessage with the resolved errorCode + params', () => {
    const result = normalizeErrorResponseCore({
      response: { errorCode: 'greet.hello', errorParams: [{ key: 'name', value: 'Sam' }] },
      resolveMessage: ({ errorCode, errorParams }) =>
        `${errorCode}:${String(errorParams?.[0]?.value)}`,
    });

    expect(result.message).toBe('greet.hello:Sam');
  });

  it('prefers an explicit numeric httpStatus over the fallback', () => {
    const result = normalizeErrorResponseCore({
      response: { errorCode: 'x', httpStatus: 418 },
      fallbackHttpStatus: 400,
    });

    expect(result.httpStatus).toBe(418);
  });

  it('uses fallbackHttpStatus when response.httpStatus is not a number', () => {
    const result = normalizeErrorResponseCore({
      response: { errorCode: 'x', httpStatus: 'not-a-number' },
      fallbackHttpStatus: 422,
    });

    expect(result.httpStatus).toBe(422);
  });
});

describe('defaultHttpStatusForResponse', () => {
  it('returns the explicit httpStatus when provided', () => {
    expect(
      defaultHttpStatusForResponse({ status: 'error', explicitHttpStatus: 401 }),
    ).toBe(401);
  });

  it('returns 200 for success without an explicit status', () => {
    expect(defaultHttpStatusForResponse({ status: 'success' })).toBe(200);
  });

  it('returns 400 for error by default', () => {
    expect(defaultHttpStatusForResponse({ status: 'error' })).toBe(400);
  });

  it('honours a custom fallbackErrorStatus for the error path', () => {
    expect(
      defaultHttpStatusForResponse({ status: 'error', fallbackErrorStatus: 503 }),
    ).toBe(503);
  });
});
