import {
  checkRateLimit,
  dispatchHook,
  getLogger,
  getProjectConfig,
} from '@luckystack/core';
import { getLogin } from '../capabilities';
import type { HttpRouteHandler } from './types';

const parseSessionBasedTokenHeader = (headerValue: string | string[] | undefined): boolean | null => {
  if (headerValue === undefined) return null;
  const value = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return null;
};

export const handleAuthApiRoute: HttpRouteHandler = async ({
  req,
  res,
  routePath,
  token,
  params,
  sessionCookieOptions,
}) => {
  if (!routePath.startsWith('/auth/api')) return false;

  //? @luckystack/login is optional. Without it there is no auth surface, so every
  //? /auth/api/* route reports the disabled contract instead of crashing.
  const login = await getLogin();
  if (!login) {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ status: false, reason: 'auth.disabled' }));
    return true;
  }

  const config = getProjectConfig();
  const sessionCookieName = config.http.sessionCookieName;
  const shouldLogDev = config.logging.devLogs;

  const providerName = routePath.split('/')[3];
  const provider = login.getOAuthProviders().find((p) => p.name === providerName);
  if (!provider?.name) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: false, reason: 'login.providerNotFound' }));
    return true;
  }

  if (login.isFullOAuthProvider(provider)) {
    const oauthState = await login.createOAuthState(provider.name);
    if (!oauthState) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: false, reason: 'login.oauthStateInitFailed' }));
      return true;
    }

    const clientId = encodeURIComponent(provider.clientID);
    const callbackUrl = encodeURIComponent(provider.callbackURL);
    const scope = encodeURIComponent((provider.scope).join(' '));
    const state = encodeURIComponent(oauthState);

    res.writeHead(302, {
      Location: `${provider.authorizationURL}?client_id=${clientId}&redirect_uri=${callbackUrl}&scope=${scope}&response_type=code&prompt=select_account&state=${state}`,
    });
    res.end();
    return true;
  }

  const rateLimiting = config.rateLimiting;
  if (rateLimiting.defaultApiLimit !== false && rateLimiting.defaultApiLimit > 0) {
    const requesterIp = req.socket.remoteAddress ?? 'unknown';
    const { allowed, resetIn } = await checkRateLimit({
      key: `ip:${requesterIp}:auth:credentials`,
      limit: rateLimiting.defaultApiLimit,
      windowMs: rateLimiting.windowMs,
    });

    if (!allowed) {
      void dispatchHook('rateLimitExceeded', {
        scope: 'auth',
        key: `ip:${requesterIp}:auth:credentials`,
        limit: rateLimiting.defaultApiLimit,
        windowMs: rateLimiting.windowMs,
        count: rateLimiting.defaultApiLimit + 1,
        route: routePath,
        ip: requesterIp,
      });
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({
        status: false,
        reason: 'api.rateLimitExceeded',
        errorParams: [{ key: 'seconds', value: resetIn }],
      }));
      return true;
    }
  }

  //? Pass the requester's current session token as `supersedeToken` so that, on
  //? a re-login while already signed in, single-session enforcement does NOT kick
  //? this same browser's old session (which would log it straight back out).
  const result = (await login.loginWithCredentials(params, { supersedeToken: token })) as {
    status: boolean;
    reason: string;
    newToken: string | null;
    session: unknown;
  } | undefined;

  if (!result?.status) {
    const reasonKey =
      typeof result?.reason === 'string' && result.reason.length > 0
        ? result.reason
        : 'api.internalServerError';
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ status: false, reason: reasonKey }));
    return true;
  }

  if (result.newToken) {
    //? Old session was excluded from enforcement above (supersedeToken). Clean it
    //? up silently — `skipSocketLogout` prevents a `logout` emit to this same
    //? browser's live socket, which would bounce it to /login and null the new
    //? session before the success redirect runs.
    if (token) await login.deleteSession(token, { skipSocketLogout: true });

    const requestedSessionMode = parseSessionBasedTokenHeader(req.headers['x-session-based-token']);
    const useSessionBasedToken = requestedSessionMode ?? config.session.basedToken;

    if (shouldLogDev) getLogger().debug('http: setting cookie with new token');

    if (useSessionBasedToken) {
      res.setHeader('X-Session-Token', result.newToken);
    } else {
      res.setHeader('Set-Cookie', `${sessionCookieName}=${result.newToken}; ${sessionCookieOptions}`);
    }
  }

  res.end(JSON.stringify({
    status: result.status,
    reason: result.reason,
    session: result.session,
    authenticated: Boolean(result.newToken),
  }));
  return true;
};
