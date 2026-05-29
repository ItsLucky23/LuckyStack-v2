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

  //? Fallback redirect target when no `postLoginRedirect` resolver returns a
  //? URL. Prefer `projectConfig.app.publicUrl` (the public origin also used
  //? in transactional email links). The legacy `DNS` env var is kept as an
  //? override-on-top so existing deployments don't break, but new installs
  //? should set `app.publicUrl`.
  //? `process.env.DNS` is coerced to '' by the env layer when unset, so `??`
  //? would treat empty as set and shadow `app.publicUrl`. Use `||` so an empty
  //? DNS falls through to `app.publicUrl`, then `/` as last resort.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- see comment above
  const baseLocation = (process.env.DNS || config.app.publicUrl) || '/';
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
