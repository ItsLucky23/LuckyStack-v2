import { describe, it, expect, beforeEach } from 'vitest';

import {
  registerSessionSanitizer,
  getSessionSanitizer,
  applySessionSanitizer,
  resetSessionSanitizerForTests,
} from './sessionSanitizer';
import type { BaseSessionLayout } from './sessionLayout';

const baseSession = (): BaseSessionLayout => ({
  id: 'u1',
  token: 't1',
  csrfToken: 'csrf1',
  admin: true,
  name: 'Sam',
});

describe('session sanitizer registry', () => {
  beforeEach(() => {
    resetSessionSanitizerForTests();
  });

  it('is a no-op (identity) before any sanitizer is registered', () => {
    expect(getSessionSanitizer()).toBeNull();
    const session = baseSession();
    expect(applySessionSanitizer(session)).toBe(session);
  });

  it('applies the registered sanitizer to redact a sensitive field', () => {
    //? Strip `admin` (a representative internal flag) while preserving the
    //? structural session fields the client needs.
    registerSessionSanitizer(({ admin: _admin, ...safe }) => safe);

    const out = applySessionSanitizer(baseSession());

    expect(out.admin).toBeUndefined();
    expect(out.id).toBe('u1');
    expect(out.token).toBe('t1');
    expect(out.csrfToken).toBe('csrf1');
    expect(out.name).toBe('Sam');
  });

  it('last registration wins', () => {
    registerSessionSanitizer((s) => ({ ...s, name: 'first' }));
    registerSessionSanitizer((s) => ({ ...s, name: 'second' }));

    expect(applySessionSanitizer(baseSession()).name).toBe('second');
  });
});
