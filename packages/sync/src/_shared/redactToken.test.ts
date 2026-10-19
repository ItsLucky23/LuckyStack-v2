import { describe, it, expect } from 'vitest';

import { redactToken, redactTokenRoom, redactTokens } from './redactToken';

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

//? 067 — a token room's name IS the bearer token, so a `receiver` equal to a
//? known session token must be redacted before it reaches the error tracker.
describe('redactTokenRoom', () => {
  const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789';

  it('redacts a receiver that equals one of the known tokens', () => {
    expect(redactTokenRoom(TOKEN, [null, TOKEN])).toBe('abcd…');
  });

  it('leaves an ordinary room code readable', () => {
    expect(redactTokenRoom('chat-room', [TOKEN])).toBe('chat-room');
  });

  it('never matches on a missing token (anonymous caller)', () => {
    expect(redactTokenRoom('', [null, undefined, ''])).toBe('');
  });
});
