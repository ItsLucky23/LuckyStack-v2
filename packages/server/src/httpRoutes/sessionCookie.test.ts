import { describe, it, expect, vi, beforeEach } from 'vitest';

const { httpConfig } = vi.hoisted(() => ({ httpConfig: {} as Record<string, unknown> }));

vi.mock('@luckystack/core', async () => {
  const actual = await vi.importActual<typeof import('@luckystack/core')>('@luckystack/core');
  return {
    ...actual,
    getProjectConfig: () => ({ http: httpConfig }),
    //? Pin non-production so `Secure` comes only from the config under test.
    isProductionRuntime: () => false,
  };
});

import {
  buildClearedSessionCookie,
  buildSessionCookie,
  buildSessionCookieOptions,
  resolveCookieSecure,
  resolveSessionCookieName,
} from './sessionCookie';

//? WAVE4 regression: the session-token cookie and the OAuth state cookie must
//? derive `Secure` identically. The M2 fix had updated only the OAuth cookie,
//? leaving the security-critical session cookie ignoring `sessionCookieSecure`.
describe('resolveCookieSecure (WAVE4 — session/OAuth cookie Secure parity)', () => {
  it('falls back to the SECURE env flag when sessionCookieSecure is unset', () => {
    expect(resolveCookieSecure(undefined, 'true')).toBe(true);
    expect(resolveCookieSecure(undefined, 'false')).toBe(false);
    expect(resolveCookieSecure(undefined, undefined)).toBe(false);
  });

  it('honors the explicit override regardless of the env flag', () => {
    //? Force ON behind a TLS-terminating proxy where SECURE !== 'true'.
    expect(resolveCookieSecure(true, undefined)).toBe(true);
    expect(resolveCookieSecure(true, 'false')).toBe(true);
    //? Force OFF even when SECURE === 'true' (explicit opt-out).
    expect(resolveCookieSecure(false, 'true')).toBe(false);
  });
});

//? Finding 044: `http.sessionCookiePrefix` / `http.sessionCookieDomain` were
//? documented but never applied by any cookie writer.
describe('session cookie builder (finding 044)', () => {
  beforeEach(() => {
    for (const key of Object.keys(httpConfig)) delete httpConfig[key];
    Object.assign(httpConfig, { sessionCookieName: 'token', sessionCookieSameSite: 'Strict', sessionCookiePath: '/' });
  });

  it('keeps the unprefixed, host-only cookie byte-identical when neither key is set', () => {
    expect(buildSessionCookie('abc', buildSessionCookieOptions(60))).toBe('token=abc; HttpOnly; SameSite=Strict; Path=/; Max-Age=60; ');
  });

  it('__Host- prefixes the name, forces Secure and Path=/ and drops Domain', () => {
    Object.assign(httpConfig, { sessionCookiePrefix: '__Host-', sessionCookiePath: '/app', sessionCookieDomain: '.example.com' });
    expect(resolveSessionCookieName()).toBe('__Host-token');
    expect(buildSessionCookie('abc', buildSessionCookieOptions(60))).toBe('__Host-token=abc; HttpOnly; SameSite=Strict; Path=/; Max-Age=60; Secure;');
  });

  it('__Secure- prefixes the name, forces Secure and keeps Domain + Path', () => {
    Object.assign(httpConfig, { sessionCookiePrefix: '__Secure-', sessionCookiePath: '/app', sessionCookieDomain: '.example.com' });
    expect(buildSessionCookie('abc', buildSessionCookieOptions(60))).toBe('__Secure-token=abc; HttpOnly; SameSite=Strict; Path=/app; Max-Age=60; Domain=.example.com; Secure;');
  });

  it('applies sessionCookieDomain without a prefix and honours sessionCookieSecure', () => {
    Object.assign(httpConfig, { sessionCookieDomain: '.example.com', sessionCookieSecure: true });
    expect(buildSessionCookieOptions(60)).toBe('HttpOnly; SameSite=Strict; Path=/; Max-Age=60; Domain=.example.com; Secure;');
  });

  it('the clear cookie matches the set cookie name/Path/Domain with Max-Age=0', () => {
    Object.assign(httpConfig, { sessionCookiePrefix: '__Secure-', sessionCookieDomain: '.example.com' });
    expect(buildClearedSessionCookie()).toBe('__Secure-token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Domain=.example.com; Secure;');
  });
});
