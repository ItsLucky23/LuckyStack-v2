import { describe, it, expect } from 'vitest';

import { timingSafeStringEqual } from './timingSafeEqual';

describe('timingSafeStringEqual', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeStringEqual('a1b2c3', 'a1b2c3')).toBe(true);
  });

  it('returns false for different strings of equal length', () => {
    expect(timingSafeStringEqual('a1b2c3', 'a1b2c4')).toBe(false);
  });

  it('returns false for different-length strings (without throwing)', () => {
    //? crypto.timingSafeEqual throws on length mismatch; the helper must
    //? length-check first and return false instead of throwing.
    expect(timingSafeStringEqual('short', 'a-much-longer-token')).toBe(false);
  });

  it('returns true for two empty strings', () => {
    expect(timingSafeStringEqual('', '')).toBe(true);
  });

  it('handles multi-byte UTF-8 content', () => {
    expect(timingSafeStringEqual('café', 'café')).toBe(true);
    expect(timingSafeStringEqual('café', 'cafe')).toBe(false);
  });
});
