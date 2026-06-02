import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  registerSecurityHeaders,
  getSecurityHeadersBuilder,
  type SecurityHeadersBuilder,
} from './securityHeadersRegistry';

//? The framework "defaults" themselves (Referrer-Policy, X-Frame-Options, ...)
//? are read from `projectConfig.http.securityHeaders` and applied inside the
//? module-private `setSecurityHeaders` in `httpHandler.ts`, which is not
//? exported and depends on the live config + login session infra. The only
//? purely-testable server-side surface for security headers is this registry
//? seam: register / read / unregister + last-write-wins.

//? A real (but inert) IncomingMessage the builder receives. Only the identity
//? matters here — the registry never reads request fields, it just forwards
//? `req` to the builder. Building a genuine instance over an unconnected
//? Socket keeps the type honest without any casts; a fresh one per call lets
//? us assert the exact instance was passed through.
const makeRequest = (): IncomingMessage => new IncomingMessage(new Socket());

//? Builders are hoisted to module scope (they close over nothing) so the
//? identity assertions compare against stable references.
const cspBuilder: SecurityHeadersBuilder = () => ({ 'Content-Security-Policy': "default-src 'self'" });
const firstBuilder: SecurityHeadersBuilder = () => ({ 'X-First': 'a' });
const secondBuilder: SecurityHeadersBuilder = () => ({ 'X-Second': 'b' });
const nullReturningBuilder: SecurityHeadersBuilder = () => null;
const undefinedReturningBuilder: SecurityHeadersBuilder = () => {
  //? The "defaults only" opt-out: produce an explicit `undefined` of the
  //? builder's declared return type. A bare `() => {}` would be `() => void`,
  //? which the `SecurityHeadersBuilder` contract does not accept.
  let headers: Record<string, string> | undefined;
  return headers;
};

describe('securityHeadersRegistry', () => {
  beforeEach(() => {
    //? Module-level slot persists across tests in the same file — reset to the
    //? unregistered baseline so each case starts clean.
    registerSecurityHeaders(null);
  });

  it('returns null when no builder has been registered', () => {
    expect(getSecurityHeadersBuilder()).toBeNull();
  });

  it('returns the builder that was registered', () => {
    registerSecurityHeaders(cspBuilder);
    expect(getSecurityHeadersBuilder()).toBe(cspBuilder);
  });

  it('forwards the request object to the registered builder unchanged', () => {
    const builder = vi.fn<SecurityHeadersBuilder>(() => ({ 'X-Test': '1' }));
    registerSecurityHeaders(builder);

    const req = makeRequest();
    const active = getSecurityHeadersBuilder();
    expect(active).toBe(builder);
    const result = active?.(req);

    expect(builder).toHaveBeenCalledTimes(1);
    expect(builder).toHaveBeenCalledWith(req);
    expect(result).toEqual({ 'X-Test': '1' });
  });

  it('applies last-write-wins on repeated registration', () => {
    registerSecurityHeaders(firstBuilder);
    registerSecurityHeaders(secondBuilder);
    expect(getSecurityHeadersBuilder()).toBe(secondBuilder);
  });

  it('unregisters the active builder when passed null', () => {
    registerSecurityHeaders(cspBuilder);
    expect(getSecurityHeadersBuilder()).not.toBeNull();
    registerSecurityHeaders(null);
    expect(getSecurityHeadersBuilder()).toBeNull();
  });

  it('supports a builder that opts into defaults-only via a nullish return', () => {
    //? The httpHandler treats a null/undefined builder return as "defaults
    //? only". The registry itself just stores and returns such a builder; we
    //? assert the nullish return value round-trips.
    registerSecurityHeaders(nullReturningBuilder);
    expect(getSecurityHeadersBuilder()?.(makeRequest())).toBeNull();

    registerSecurityHeaders(undefinedReturningBuilder);
    expect(getSecurityHeadersBuilder()?.(makeRequest())).toBeUndefined();
  });
});
