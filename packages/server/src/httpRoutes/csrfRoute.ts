import { randomBytes } from 'node:crypto';
import { getCsrfConfig, readSession, type CsrfCookieOptions } from '@luckystack/core';
import { capabilities } from '../capabilities';
import type { HttpRouteHandler } from './types';

//? Serialize the configured CSRF cookie options into a Set-Cookie string. Only
//? used on the login-ABSENT double-submit path; the login-present path delivers
//? the token in the JSON body (session-bound, no cookie write here).
const serializeCsrfCookie = (name: string, value: string, opts: CsrfCookieOptions): string => {
  const parts = [`${name}=${value}`];
  if (opts.httpOnly) parts.push('HttpOnly');
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite.charAt(0).toUpperCase()}${opts.sameSite.slice(1)}`);
  if (opts.secure) parts.push('Secure');
  parts.push(`Path=${opts.path ?? '/'}`);
  if (typeof opts.maxAgeMs === 'number') parts.push(`Max-Age=${String(Math.floor(opts.maxAgeMs / 1000))}`);
  return parts.join('; ');
};

export const handleCsrfRoute: HttpRouteHandler = async ({ res, routePath, token }) => {
  if (routePath !== '/auth/csrf') return false;

  const csrfConfig = getCsrfConfig();

  //? Login-ABSENT (unauthenticated app): there is no per-session CSRF token, so
  //? issue a stateless DOUBLE-SUBMIT token — set it as the csrf cookie AND return
  //? it in the body. `enforceCsrfOnStateChangingRequest` later compares the cookie
  //? value against the `x-csrf-token` header (no session read). A cross-site
  //? attacker can neither read the body (CORS) nor forge the header to match the
  //? victim's cookie, so this blocks cross-site state changes without login.
  if (!capabilities.login) {
    //? Stateless double-submit: the SAME random value is set as the CSRF cookie
    //? and echoed in the JSON body. `enforceCsrfOnStateChangingRequest` later
    //? compares the cookie against the `x-csrf-token` request header. The cookie
    //? is deliberately NOT HttpOnly (the client JS must read it to echo it as the
    //? header); cross-site protection rests on SameSite + same-origin/CORS — an
    //? attacker on another origin can neither read the cookie nor the JSON body,
    //? so they cannot forge a matching header.
    //?
    //? KNOWN LIMITATION: without HMAC binding to a server secret this token
    //? cannot survive a subdomain compromise (an attacker on sub.example.com
    //? can set a cookie on .example.com). This is accepted in the login-absent
    //? posture; add `registerCsrfConfig({ sign: true })` to enable HMAC signing
    //? when that threat model applies.
    const doubleSubmit = randomBytes(csrfConfig.tokenLength).toString('hex');
    res.statusCode = 200;
    //? Resolve `Secure` per-environment (env SECURE) when the config leaves it
    //? unset — mirrors the session cookie so the double-submit cookie isn't
    //? dropped over plain HTTP in dev (which would 403 every POST). An explicit
    //? config `secure` (true/false) always wins.
    const cookieOptions: CsrfCookieOptions = {
      ...csrfConfig.cookieOptions,
      secure: csrfConfig.cookieOptions.secure ?? (process.env.SECURE === 'true'),
    };
    res.setHeader('Set-Cookie', serializeCsrfCookie(csrfConfig.cookieName, doubleSubmit, cookieOptions));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'success', csrfToken: doubleSubmit }));
    return true;
  }

  //? Login-PRESENT: session-bound CSRF token (unchanged behaviour).
  if (!token) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'error', errorCode: 'auth.unauthenticated' }));
    return true;
  }
  const csrfSession = await readSession(token);
  if (!csrfSession?.id) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'error', errorCode: 'auth.unauthenticated' }));
    return true;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    status: 'success',
    csrfToken: csrfSession.csrfToken ?? null,
  }));
  return true;
};
