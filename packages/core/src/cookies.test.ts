import { describe, it, expect } from 'vitest';

import { getCookieValue, hasCookie } from './cookies';

describe('getCookieValue', () => {
  it('reads a value for a cookie at the start of the header', () => {
    expect(getCookieValue('token=abc123; other=x', 'token')).toBe('abc123');
  });

  it('reads a value for a cookie in the middle of the header', () => {
    expect(getCookieValue('a=1; token=abc123; b=2', 'token')).toBe('abc123');
  });

  it('reads a value for a cookie at the end of the header', () => {
    expect(getCookieValue('a=1; token=abc123', 'token')).toBe('abc123');
  });

  it('returns null when the cookie is absent', () => {
    expect(getCookieValue('a=1; b=2', 'token')).toBeNull();
  });

  it('returns null for an undefined cookie header', () => {
    expect(getCookieValue(undefined, 'token')).toBeNull();
  });

  it('returns null for an empty cookie name', () => {
    expect(getCookieValue('token=abc', '')).toBeNull();
  });

  it('does not match a cookie whose name is a substring of another', () => {
    // `session` must not be matched by a request for `sess`.
    expect(getCookieValue('session=full', 'sess')).toBeNull();
  });

  it('URL-decodes the cookie value', () => {
    expect(getCookieValue('redirect=%2Fdashboard%3Fa%3D1', 'redirect')).toBe('/dashboard?a=1');
  });

  it('returns the raw value when decoding fails', () => {
    // A lone `%` is an invalid percent-encoding and throws inside decodeURIComponent.
    expect(getCookieValue('token=100%done', 'token')).toBe('100%done');
  });

  it('escapes regex-special characters in the cookie name', () => {
    // The dot must be treated literally, not as a regex wildcard.
    expect(getCookieValue('csrf.token=val; csrfXtoken=other', 'csrf.token')).toBe('val');
  });

  it('returns null when the cookie has an empty value', () => {
    // `([^;]*)` captures empty string -> falsy rawValue -> null.
    expect(getCookieValue('token=; other=x', 'token')).toBeNull();
  });
});

describe('hasCookie', () => {
  it('returns true when the cookie is present', () => {
    expect(hasCookie('token=abc; other=x', 'token')).toBe(true);
  });

  it('returns false when the cookie is absent', () => {
    expect(hasCookie('other=x', 'token')).toBe(false);
  });

  it('returns false for an undefined header', () => {
    expect(hasCookie(undefined, 'token')).toBe(false);
  });
});
