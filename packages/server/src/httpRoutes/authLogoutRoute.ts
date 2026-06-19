import { getLogger, getProjectConfig, tryCatch } from '@luckystack/core';
import { getLogin } from '../capabilities';
import { resolveCookieSecure } from './sessionCookie';
import type { HttpRouteHandler } from './types';

//? HTTP logout endpoint — POST /auth/logout.
//?
//? Logout must terminate over HTTP in cookie mode because only an HTTP
//? response can clear the HttpOnly session cookie — the socket transport the
//? rest of the logout flow uses cannot touch cookies. The route deletes the
//? session when the request still carries a live token (tolerating an
//? already-deleted one — the socket logout usually ran first) and ALWAYS
//? answers with an expiring Set-Cookie so the browser drops the stale
//? credential.
//?
//? CSRF: deliberately outside the `/auth/api` prefix the CSRF middleware
//? guards. The SameSite=Strict session cookie never rides on a cross-site
//? POST, so a forged request arrives token-less and clears nothing — same
//? reasoning as the credentials-bootstrap exemption in csrfMiddleware.ts.
export const handleAuthLogoutRoute: HttpRouteHandler = async ({ res, routePath, method, token }) => {
  if (routePath !== '/auth/logout') return false;

  if (method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'error', errorCode: 'api.methodNotAllowed' }));
    return true;
  }

  if (token) {
    const login = await getLogin();
    if (login) {
      //? deleteSession dispatches the session-delete hooks and reuses the
      //? socket logout for any still-connected sockets. A dead/unknown token
      //? no-ops; an adapter blip must not block the cookie clear below.
      const [deleteError] = await tryCatch(() => login.deleteSession(token));
      if (deleteError) {
        getLogger().warn('http logout: deleteSession failed — clearing cookie anyway', { err: deleteError });
      }
    }
  }

  //? Clearing cookie: identity = name + path (+ domain). Mirror the attributes
  //? of buildSessionCookieOptions in httpHandler.ts, with Max-Age=0 so the
  //? browser expires it immediately. setHeader (not append) intentionally
  //? overrides the sliding-expiration refresh that ran earlier this request.
  const http = getProjectConfig().http;
  //? SEC: /auth/logout relies on SameSite=Strict as its CSRF mitigation (the
  //? route is deliberately outside the CSRF middleware's candidate check — see
  //? csrfMiddleware.ts). Warn loudly in dev when the config weakens this
  //? assumption so operators know they must add explicit CSRF protection.
  if (http.sessionCookieSameSite !== 'Strict' && process.env.NODE_ENV !== 'production') {
    getLogger().warn(
      `/auth/logout is exempt from CSRF middleware and relies on SameSite=Strict. ` +
      `Current sessionCookieSameSite="${http.sessionCookieSameSite}" weakens this protection.`,
    );
  }
  const secure = resolveCookieSecure(http.sessionCookieSecure, process.env.SECURE);
  res.setHeader(
    'Set-Cookie',
    `${http.sessionCookieName}=; HttpOnly; SameSite=${http.sessionCookieSameSite}; Path=${http.sessionCookiePath}; Max-Age=0; ${secure ? 'Secure;' : ''}`,
  );
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ status: 'success', result: true }));
  return true;
};
