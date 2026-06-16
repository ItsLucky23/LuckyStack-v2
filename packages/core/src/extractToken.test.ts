import { describe, it, expect, beforeEach } from 'vitest';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'socket.io';

import { extractTokenFromRequest } from './extractTokenFromRequest';
import { extractTokenFromSocket } from './extractToken';
import { registerProjectConfig } from './projectConfig';

//? Both extractors read `session.basedToken` + `http.acceptBearerInCookieMode`
//? from the real project-config registry, driven here via registerProjectConfig.
const setMode = (basedToken: boolean, acceptBearerInCookieMode?: boolean): void => {
  registerProjectConfig({ session: { basedToken }, http: { acceptBearerInCookieMode } });
};

const makeRequest = (cookie: string | undefined, bearer: string | undefined): IncomingMessage =>
  ({ headers: { cookie, authorization: bearer ? `Bearer ${bearer}` : undefined } } as unknown as IncomingMessage);

const makeSocket = (cookie: string | undefined, authToken: string | undefined): Pick<Socket, 'handshake'> =>
  ({ handshake: { headers: { cookie }, auth: authToken ? { token: authToken } : {} } } as unknown as Pick<Socket, 'handshake'>);

beforeEach(() => {
  //? Reset to defaults before each case; the registry rebuilds from
  //? DEFAULT_PROJECT_CONFIG on every register call.
  setMode(false);
});

describe('extractTokenFromRequest — cookie-mode bearer fallback (CORE-O10)', () => {
  it('cookie-mode default: ignores the bearer fallback (only the cookie is accepted)', () => {
    setMode(false);
    const req = makeRequest('token=cookieval', 'stolenbearer');
    expect(extractTokenFromRequest(req)).toBe('cookieval');
  });

  it('cookie-mode default: returns null when only a bearer token is present (no fallback)', () => {
    setMode(false);
    const req = makeRequest(undefined, 'stolenbearer');
    expect(extractTokenFromRequest(req)).toBeNull();
  });

  it('cookie-mode + acceptBearerInCookieMode:true: preserves the legacy cookie-then-bearer fallback', () => {
    setMode(false, true);
    expect(extractTokenFromRequest(makeRequest('token=cookieval', 'bearerval'))).toBe('cookieval');
    expect(extractTokenFromRequest(makeRequest(undefined, 'bearerval'))).toBe('bearerval');
  });

  it('token-mode (basedToken:true) is unaffected: bearer is canonical, cookie is fallback', () => {
    setMode(true);
    expect(extractTokenFromRequest(makeRequest('token=cookieval', 'bearerval'))).toBe('bearerval');
    expect(extractTokenFromRequest(makeRequest('token=cookieval', undefined))).toBe('cookieval');
  });
});

describe('extractTokenFromSocket — cookie-mode handshake-auth fallback (CORE-O10)', () => {
  it('cookie-mode default: ignores the handshake.auth.token fallback (only the cookie is accepted)', () => {
    setMode(false);
    const socket = makeSocket('token=cookieval', 'stolenauth');
    expect(extractTokenFromSocket(socket)).toBe('cookieval');
  });

  it('cookie-mode default: returns null when only a handshake-auth token is present (no fallback)', () => {
    setMode(false);
    const socket = makeSocket(undefined, 'stolenauth');
    expect(extractTokenFromSocket(socket)).toBeNull();
  });

  it('cookie-mode + acceptBearerInCookieMode:true: preserves the legacy cookie-then-auth fallback', () => {
    setMode(false, true);
    expect(extractTokenFromSocket(makeSocket('token=cookieval', 'authval'))).toBe('cookieval');
    expect(extractTokenFromSocket(makeSocket(undefined, 'authval'))).toBe('authval');
  });

  it('token-mode (basedToken:true) is unaffected: handshake-auth is canonical, cookie is fallback', () => {
    setMode(true);
    expect(extractTokenFromSocket(makeSocket('token=cookieval', 'authval'))).toBe('authval');
    expect(extractTokenFromSocket(makeSocket('token=cookieval', undefined))).toBe('cookieval');
  });
});
