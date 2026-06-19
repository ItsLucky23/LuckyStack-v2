import { describe, it, expect } from 'vitest';

import { redactToken, redactTokens } from './redactToken';

//? SYNC-17 — raw session tokens are bearer credentials and must be truncated
//? before they reach the error tracker (tryCatch context) or stream logs.
describe('redactToken', () => {
  it('truncates a long token to a 4-char prefix + ellipsis', () => {
    const token = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const redacted = redactToken(token);
    expect(redacted).toBe('abcd…');
    //? The full token must NOT be recoverable from the redacted form.
    expect(redacted).not.toContain('efgh');
    expect((redacted ?? '').length).toBeLessThan(token.length);
  });

  it('returns null/empty values unchanged (nothing to redact)', () => {
    expect(redactToken(null)).toBeNull();
    expect(redactToken('')).toBe('');
  });

  it('returns short tokens unchanged (already below the visible prefix)', () => {
    expect(redactToken('abc')).toBe('abc');
    expect(redactToken('abcd')).toBe('abcd');
  });

  it('redacts every token in a list (streamTo recipient list)', () => {
    const tokens = ['abcdefghijklmnop', 'qrstuvwxyz012345'];
    expect(redactTokens(tokens)).toEqual(['abcd…', 'qrst…']);
  });
});
