import { getLogger, getProjectConfig } from '@luckystack/core';
import { getLogin } from '../capabilities';
import type { HttpRouteHandler } from './types';

export const handleAuthCallbackRoute: HttpRouteHandler = async ({
  req,
  res,
  routePath,
  token,
  sessionCookieOptions,
}) => {
  if (!routePath.startsWith('/auth/callback')) return false;

  //? @luckystack/login optional — no auth package means no OAuth callback.
  const login = await getLogin();
  if (!login) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Auth is not enabled');
    return true;
  }

  const config = getProjectConfig();
  const sessionCookieName = config.http.sessionCookieName;
  const shouldLogDev = config.logging.devLogs;

  //? Fallback redirect target when no `postLoginRedirect` resolver returns a URL.
  //? `projectConfig.app.publicUrl` is the public origin where users browse (also
  //? used for transactional email links) — dev: the frontend dev server, prod:
  //? your domain. After an OAuth callback (handled on the BACKEND origin) we must
  //? send the browser back to this public origin, not the backend.
  //?
  //? `loginRedirectUrl` is the configured post-login PATH (e.g. '/dashboard') and
  //? lives on the public origin, so we join it onto `publicUrl` to land the user
  //? where credentials login also lands them — not the bare public root. An
  //? already-absolute `loginRedirectUrl` is used as-is; an empty result falls
  //? through to '/'.
  const publicOrigin = (config.app.publicUrl || '').replace(/\/+$/, '');
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty string must fall through
  const loginRedirect = config.loginRedirectUrl || '/';
  const baseLocation = /^https?:\/\//i.test(loginRedirect)
    ? loginRedirect
    : `${publicOrigin}${loginRedirect.startsWith('/') ? loginRedirect : `/${loginRedirect}`}` || '/';
  const callbackResult = await login.loginCallback(routePath, req, res, {
    defaultRedirectUrl: baseLocation,
    supersedeToken: token,
  });

  if (!callbackResult) {
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    res.end('Login failed');
    return true;
  }

  //? Re-login while already signed in: the new session was just created with
  //? `supersedeToken` so single-session enforcement did NOT kick this browser's
  //? old token. Clean the old session up silently — `skipSocketLogout` avoids
  //? emitting a `logout` to this same browser's live socket, which would
  //? otherwise bounce the user back to the login page and null their session.
  if (token) await login.deleteSession(token, { skipSocketLogout: true });

  if (shouldLogDev) getLogger().debug('http: setting cookie or redirect with new token');

  const { token: newToken, redirectUrl } = callbackResult;
  if (config.session.basedToken) {
    const separator = redirectUrl.includes('?') ? '&' : '?';
    res.writeHead(302, { Location: `${redirectUrl}${separator}token=${newToken}` });
  } else {
    res.setHeader('Set-Cookie', `${sessionCookieName}=${newToken}; ${sessionCookieOptions}`);
    res.writeHead(302, { Location: redirectUrl });
  }
  res.end();
  return true;
};
