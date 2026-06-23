import { describe, it, expect, beforeEach } from 'vitest';

import {
  DEFAULT_CSRF_CONFIG,
  getCsrfConfig,
  registerCsrfConfig,
  resetCsrfConfigForTests,
} from './csrfConfig';

describe('csrfConfig', () => {
  beforeEach(() => {
    resetCsrfConfigForTests();
  });

  it('returns the defaults when nothing has been registered', () => {
    const config = getCsrfConfig();
    expect(config.cookieName).toBe('csrf-token');
    expect(config.headerName).toBe('x-csrf-token');
    expect(config.tokenLength).toBe(32);
    expect(config.cookieOptions.sameSite).toBe('lax');
    //? `secure` is intentionally UNSET in the default so it resolves per-env at
    //? serialize time (csrfRoute.ts) — emit Secure in prod, not over plain HTTP in
    //? dev (a hardcoded `true` made the browser drop the dev cookie → 403 on POST).
    expect(config.cookieOptions.secure).toBeUndefined();
    expect(config.cookieOptions.httpOnly).toBe(false);
    expect(config.cookieOptions.path).toBe('/');
  });

  it('exposes the same defaults via DEFAULT_CSRF_CONFIG', () => {
    expect(DEFAULT_CSRF_CONFIG.cookieName).toBe('csrf-token');
    expect(DEFAULT_CSRF_CONFIG.headerName).toBe('x-csrf-token');
    expect(DEFAULT_CSRF_CONFIG.tokenLength).toBe(32);
  });

  it('overrides top-level fields shallowly', () => {
    registerCsrfConfig({ headerName: 'x-my-csrf', tokenLength: 64 });
    const config = getCsrfConfig();
    expect(config.headerName).toBe('x-my-csrf');
    expect(config.tokenLength).toBe(64);
    // Untouched field keeps its default.
    expect(config.cookieName).toBe('csrf-token');
  });

  it('deep-merges cookieOptions so a partial override does not clobber siblings', () => {
    registerCsrfConfig({ cookieOptions: { sameSite: 'strict' } });
    const config = getCsrfConfig();
    expect(config.cookieOptions.sameSite).toBe('strict');
    // path + maxAgeMs survive the partial override.
    expect(config.cookieOptions.path).toBe('/');
    expect(config.cookieOptions.maxAgeMs).toBe(24 * 60 * 60 * 1000);
  });

  it('applies last-write-wins across multiple registrations', () => {
    registerCsrfConfig({ cookieName: 'first' });
    registerCsrfConfig({ cookieName: 'second' });
    expect(getCsrfConfig().cookieName).toBe('second');
  });

  it('accumulates cookieOptions across successive registrations', () => {
    registerCsrfConfig({ cookieOptions: { sameSite: 'none' } });
    registerCsrfConfig({ cookieOptions: { secure: false } });
    const config = getCsrfConfig();
    expect(config.cookieOptions.sameSite).toBe('none');
    expect(config.cookieOptions.secure).toBe(false);
  });

  it('resetCsrfConfigForTests restores the defaults', () => {
    registerCsrfConfig({ cookieName: 'changed' });
    expect(getCsrfConfig().cookieName).toBe('changed');
    resetCsrfConfigForTests();
    expect(getCsrfConfig().cookieName).toBe('csrf-token');
  });
});
