import type { IncomingMessage, ServerResponse } from 'node:http';
import { dispatchHook, getCookieValue, getCsrfConfig, getProjectConfig, readSession } from '@luckystack/core';
import { capabilities } from '../capabilities';
import { isOriginExemptPath } from '../originExemptRegistry';
import { timingSafeStringEqual } from './timingSafeEqual';

//? Returns true when the request was rejected (CSRF mismatch) and the response
//? has been ended. Caller should bail out of the request loop.
export const enforceCsrfOnStateChangingRequest = async ({
  req,
  res,
  routePath,
  token,
  requestId,
}: {
  req: IncomingMessage;
  res: ServerResponse;
  routePath: string;
  token: string | null;
  requestId?: string;
}): Promise<boolean> => {
  const config = getProjectConfig();
  const isCookieMode = !config.session.basedToken;
  //? HEAD is read-only and excluded from `enforceOriginPolicy`; mirror that
  //? here so the two state-changing predicates agree (HEAD is 404'd at the
  //? method gate before this runs, so this is parity, not a behavior change).
  const isStateChanging = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
  const isCallbackPath = routePath.startsWith('/auth/callback');
  //? The credentials login/register endpoint is the session BOOTSTRAP. Requiring a
  //? pre-existing session's CSRF token to authenticate is circular, and it blocks
  //? legitimate same-site re-login / register while a (stale) session cookie is
  //? present. Cross-site abuse is already prevented by the SameSite=Strict session
  //? cookie — a cross-site POST never carries it, so `token` would be absent here
  //? and this guard wouldn't fire anyway. Exempting it removes no real protection.
  //? ADR 0024: the email-code + 2FA LOGIN routes share the credentials-route
  //? bootstrap semantics — they authenticate via their own factor (code /
  //? challenge token), may run while a stale session cookie is present, and a
  //? cross-site POST never carries the SameSite=Strict cookie anyway. The
  //? authenticated 2FA ENROLLMENT routes (/auth/api/2fa/setup|enable|disable|
  //? recovery-codes) are deliberately NOT exempt — they are state-changing
  //? actions on a live session.
  const AUTH_BOOTSTRAP_PATHS = new Set([
    '/auth/api/credentials',
    '/auth/api/email-code/request',
    '/auth/api/email-code/verify',
    '/auth/api/2fa',
    '/auth/api/2fa/email-code',
  ]);
  const isAuthBootstrap = AUTH_BOOTSTRAP_PATHS.has(routePath);
  //? CSRF covers all framework routes (/api/, /sync/, /auth/api/) AND
  //? state-changing custom routes registered via `registerCustomRoute` that
  //? are not marked origin-exempt (those authenticate via HMAC/signature, not
  //? the session cookie, so the double-submit check is irrelevant there).
  //?
  //? IMPORTANT: `registerOriginExemptPath({ pathPrefix })` exempts ALL routes
  //? whose path starts with the given prefix from BOTH the origin gate AND CSRF.
  //? Register only the narrowest prefix needed (prefer ending with `/` — e.g.
  //? `/webhooks/` — to avoid accidentally exempting `/webhooksAdmin`).
  const isExemptFromCsrf =
    isAuthBootstrap
    || isCallbackPath
    || isOriginExemptPath(routePath);
  const isCsrfCandidate =
    routePath.startsWith('/api/')
    || routePath.startsWith('/sync/')
    || routePath.startsWith('/auth/api/')
    || (!routePath.startsWith('/auth/') && !routePath.startsWith('/assets/'));

  //? CSRF only applies to cookie-mode, state-changing routes not already
  //? exempted by another auth mechanism (origin-exempt webhooks, bootstrap).
  if (!(isCookieMode && isStateChanging && isCsrfCandidate && !isExemptFromCsrf)) {
    return false;
  }

  //? Read the active CSRF header name from the registry so consumers
  //? can rename it (e.g. legacy `x-xsrf-token`, custom `x-app-csrf`).
  const csrfConfig = getCsrfConfig();
  const headerKey = csrfConfig.headerName.toLowerCase();
  const headerValue = req.headers[headerKey];
  const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  //? Login-ABSENT path: stateless DOUBLE-SUBMIT. The session-bound token store
  //? lives in @luckystack/login; without it we compare the csrf COOKIE value
  //? against the x-csrf-token HEADER (both seeded by GET /auth/csrf). No session
  //? read. A cross-site POST can't read the cookie value to forge the header.
  if (!capabilities.login) {
    const cookieValue = getCookieValue(req.headers.cookie, csrfConfig.cookieName);
    if (cookieValue && provided && timingSafeStringEqual(provided, cookieValue)) return false;

    void dispatchHook('csrfMismatch', {
      route: routePath,
      method: req.method,
      requestId,
      userId: undefined,
      providedToken: Boolean(provided),
    });

    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      status: 'error',
      errorCode: 'auth.csrfMismatch',
      message: 'CSRF token missing or invalid. Fetch /auth/csrf first.',
    }));
    return true;
  }

  //? Login-PRESENT path: session-bound CSRF (unchanged). Requires a session
  //? token — without one there is no session to protect, so do not enforce.
  if (!token) return false;

  const csrfSession = await readSession(token);
  if (!csrfSession?.id) return false;

  if (provided && csrfSession.csrfToken && timingSafeStringEqual(provided, csrfSession.csrfToken)) return false;

  void dispatchHook('csrfMismatch', {
    route: routePath,
    method: req.method,
    requestId,
    userId: csrfSession.id,
    providedToken: Boolean(provided),
  });

  res.statusCode = 403;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    status: 'error',
    errorCode: 'auth.csrfMismatch',
    message: 'CSRF token missing or invalid. Fetch /auth/csrf first.',
  }));
  return true;
};
