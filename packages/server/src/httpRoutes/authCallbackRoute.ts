import { getLogger, getProjectConfig } from '@luckystack/core';
import { deleteSession, loginCallback } from '@luckystack/login';
import type { HttpRouteHandler } from './types';

export const handleAuthCallbackRoute: HttpRouteHandler = async ({
  req,
  res,
  routePath,
  token,
  sessionCookieOptions,
}) => {
  if (!routePath.startsWith('/auth/callback')) return false;

  const config = getProjectConfig();
  const sessionCookieName = config.http.sessionCookieName;
  const shouldLogDev = config.logging.devLogs;

  //? Fallback redirect target when no `postLoginRedirect` resolver returns a URL.
  //? `projectConfig.app.publicUrl` is the public origin where users browse (also
  //? used for transactional email links) — dev: the frontend dev server, prod:
  //? your domain. After an OAuth callback (handled on the BACKEND origin) we must
  //? send the browser back to this public origin, not the backend. `||` so an
  //? empty publicUrl falls through to '/'.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty string must fall through
  const baseLocation = config.app.publicUrl || '/';
  const callbackResult = await loginCallback(routePath, req, res, {
    defaultRedirectUrl: baseLocation,
  });

  if (!callbackResult) {
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    res.end('Login failed');
    return true;
  }

  if (token) await deleteSession(token);

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
