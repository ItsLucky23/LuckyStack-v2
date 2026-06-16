import { describe, it, expect } from 'vitest';

import { redactToken, redactTokens } from './redactToken';

//? SYNC-17 — raw session tokens are bearer credentials and must be truncated
//? before they reach the error tracker (tryCatch context) or stream logs.
describe('redactToken', () => {
  it('truncates a long token to an 8-char prefix + ellipsis', () => {
    const token = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const redacted = redactToken(token);
    expect(redacted).toBe('abcdefgh…');
    //? The full token must NOT be recoverable from the redacted form.
    expect(redacted).not.toContain('ijkl');
    expect((redacted ?? '').length).toBeLessThan(token.length);
  });

  it('returns null/empty values unchanged (nothing to redact)', () => {
    expect(redactToken(null)).toBeNull();
    expect(redactToken('')).toBe('');
  });

  it('returns short tokens unchanged (already below the visible prefix)', () => {
    expect(redactToken('abc')).toBe('abc');
    expect(redactToken('abcdefgh')).toBe('abcdefgh');
  });

  it('redacts every token in a list (streamTo recipient list)', () => {
    const tokens = ['abcdefghijklmnop', 'qrstuvwxyz012345'];
    expect(redactTokens(tokens)).toEqual(['abcdefgh…', 'qrstuvwx…']);
  });
});
