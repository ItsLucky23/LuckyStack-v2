import type { IncomingMessage, ServerResponse } from 'node:http';
import { dispatchHook, getCookieValue, getCsrfConfig, getProjectConfig, readSession } from '@luckystack/core';
import { capabilities } from '../capabilities';

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
  const isStateChanging = req.method !== 'GET' && req.method !== 'OPTIONS';
  const isCallbackPath = routePath.startsWith('/auth/callback');
  //? The credentials login/register endpoint is the session BOOTSTRAP. Requiring a
  //? pre-existing session's CSRF token to authenticate is circular, and it blocks
  //? legitimate same-site re-login / register while a (stale) session cookie is
  //? present. Cross-site abuse is already prevented by the SameSite=Strict session
  //? cookie — a cross-site POST never carries it, so `token` would be absent here
  //? and this guard wouldn't fire anyway. Exempting it removes no real protection.
  const isAuthBootstrap = routePath === '/auth/api/credentials';
  const looksLikeFrameworkRoute =
    routePath.startsWith('/api/')
    || routePath.startsWith('/sync/')
    || (routePath.startsWith('/auth/api/') && !isAuthBootstrap);

  //? CSRF only applies to cookie-mode, state-changing framework routes.
  if (!(isCookieMode && isStateChanging && looksLikeFrameworkRoute && !isCallbackPath)) {
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
    if (cookieValue && provided && provided === cookieValue) return false;

    void dispatchHook('csrfMismatch', {
      route: routePath,
      method: req.method,
      requestId,
      userId: null,
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

  if (provided && provided === csrfSession.csrfToken) return false;

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
