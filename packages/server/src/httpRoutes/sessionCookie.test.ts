import { describe, it, expect } from 'vitest';
import { resolveCookieSecure } from './sessionCookie';

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
