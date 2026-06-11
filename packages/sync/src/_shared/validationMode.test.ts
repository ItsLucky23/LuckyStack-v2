import { describe, it, expect } from 'vitest';

import { resolveSyncValidationMode } from './validationMode';

describe('resolveSyncValidationMode', () => {
  it('defaults to strict when no validation export is present', () => {
    expect(resolveSyncValidationMode(undefined)).toBe('strict');
  });

  it('honours the string form "strict"', () => {
    expect(resolveSyncValidationMode('strict')).toBe('strict');
  });

  it('honours the string form "relaxed" (skips validation)', () => {
    expect(resolveSyncValidationMode('relaxed')).toBe('relaxed');
  });

  it('treats { input: "skip" } as relaxed (the documented webhook escape hatch)', () => {
    expect(resolveSyncValidationMode({ input: 'skip' })).toBe('relaxed');
  });

  it('treats { input: "strict" } as strict', () => {
    expect(resolveSyncValidationMode({ input: 'strict' })).toBe('strict');
  });
});
