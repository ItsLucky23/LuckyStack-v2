import {
  checkRateLimit,
  dispatchHook,
  getLogger,
  getProjectConfig,
  resolveClientIp,
  resolveDevCallbackUrl,
} from '@luckystack/core';
import { getLogin } from '../capabilities';
import { resolveCookieSecure } from './sessionCookie';
import type { HttpRouteHandler } from './types';

const parseSessionBasedTokenHeader = (headerValue: string | string[] | undefined): boolean | null => {
  if (headerValue === undefined) return null;
  const value = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return null;
};

//? Reserved OAuth authorize-query params owned by the framework — a provider's
//? `extraAuthorizationParams` (CFG-21) can override any OTHER key (e.g. `prompt`,
//? `access_type`, `login_hint`) but never these, so a consumer config can't break
//? the state / PKCE / redirect-URI binding the callback relies on.
const RESERVED_OAUTH_PARAMS = new Set([
  'client_id',
  'redirect_uri',
  'scope',
  'response_type',
  'state',
  'code_challenge',
  'code_challenge_method',
]);

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
    //? Throttle OAuth-init BEFORE the Redis state write (M4). This branch runs on
    //? a plain unauthenticated GET navigation and calls `createOAuthState` (a Redis
    //? write) on every hit; the origin gate does not stop a header-less GET, so
    //? without a per-IP cap an anonymous caller can loop it for Redis write-
    //? amplification. Same limit derivation as the credentials branch below (own
    //? `oauth-init` bucket) so it degrades to a no-op unless a limit is configured.
    const oauthRateLimiting = config.rateLimiting;
    const oauthRequesterIp = resolveClientIp({
      rawAddress: req.socket.remoteAddress,
      headers: req.headers,
      trustProxy: config.http.trustProxy,
      trustedProxyHopCount: config.http.trustedProxyHopCount,
    });
    const oauthInitLimit =
      oauthRateLimiting.defaultApiLimit !== false && oauthRateLimiting.defaultApiLimit > 0
        ? oauthRateLimiting.defaultApiLimit
        : (oauthRateLimiting.auth.enabled && oauthRateLimiting.auth.maxAttempts > 0
          ? oauthRateLimiting.auth.maxAttempts
          : null);
    if (oauthInitLimit !== null) {
      //? L4: derive the window from the SAME "is the general limit active?" test
      //? as the count above (`!== false && > 0`), so `defaultApiLimit: 0` doesn't
      //? pair the auth COUNT with the general WINDOW (an inconsistent bucket).
      const oauthInitWindowMs =
        oauthRateLimiting.defaultApiLimit !== false && oauthRateLimiting.defaultApiLimit > 0
          ? oauthRateLimiting.windowMs
          : oauthRateLimiting.auth.windowMs;
      const { allowed, resetIn } = await checkRateLimit({
        key: `ip:${oauthRequesterIp}:auth:oauth-init`,
        limit: oauthInitLimit,
        windowMs: oauthInitWindowMs,
      });
      if (!allowed) {
        void dispatchHook('rateLimitExceeded', {
          scope: 'auth',
          key: `ip:${oauthRequesterIp}:auth:oauth-init`,
          limit: oauthInitLimit,
          windowMs: oauthInitWindowMs,
          count: oauthInitLimit + 1,
          route: routePath,
          ip: oauthRequesterIp,
        });
        res.writeHead(429, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          status: false,
          reason: 'api.rateLimitExceeded',
          errorParams: [{ key: 'seconds', value: resetIn }],
        }));
        return true;
      }
    }

    //? Read the optional `return_url` query param set by the frontend when it
    //? initiates the OAuth flow. The value is the full URL the browser should
    //? land on AFTER the callback (e.g. http://localhost:5174/playground).
    //? Stored server-side in Redis alongside the state — NOT echoed from the
    //? client at callback time — so it cannot be tampered with mid-flight.
    //? Validation against allowedOrigins + allowLocalhost happens in loginCallback
    //? before the redirect is issued (isAllowedRedirectUrl gate in login.ts).
    const reqUrl = new URL(req.url ?? '/', 'http://placeholder');
    const returnUrl = reqUrl.searchParams.get('return_url') ?? undefined;

    const oauthState = await login.createOAuthState(provider.name, { usePkce: provider.usePkce, returnUrl });
    if (!oauthState) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: false, reason: 'login.oauthStateInitFailed' }));
      return true;
    }

    //? Bind the OAuth flow to THIS browser: the callback only accepts the flow
    //? when the same browser presents back the nonce we stash in the
    //? short-lived state cookie. Same Secure derivation as the session-token
    //? cookie (`resolveCookieSecure`, shared seam) so the binding cookie isn't
    //? sent over plaintext when the deployment is HTTPS.
    const stateTtl = config.auth.oauthStateTtlSeconds;
    const secureFlag = resolveCookieSecure(config.http.sessionCookieSecure, process.env.SECURE) ? ' Secure;' : '';
    res.setHeader(
      'Set-Cookie',
      `${login.OAUTH_STATE_COOKIE_NAME}=${oauthState.stateCookie}; Path=/; HttpOnly;${secureFlag} SameSite=Lax; Max-Age=${stateTtl}`,
    );

    //? Build the authorize-redirect query via URLSearchParams so a provider's
    //? `extraAuthorizationParams` (CFG-21) merges OVER the framework defaults —
    //? e.g. `access_type=offline` for Google refresh tokens, `login_hint`, or
    //? overriding the default `prompt=select_account`. Reserved OAuth params are
    //? framework-owned (skipped in the merge); `state` + the PKCE S256 challenge
    //? are set LAST so a consumer key can never clobber the browser binding.
    const authParams = new URLSearchParams({
      client_id: provider.clientID,
      //? In dev, target the port the server ACTUALLY bound (auto-increment may
      //? have moved it off the frozen `oauthCallbackBase` port). The token
      //? exchange applies the SAME rewrite, so the two redirect_uri values stay
      //? byte-identical as OAuth requires. Prod / non-localhost: unchanged.
      redirect_uri: resolveDevCallbackUrl(provider.callbackURL),
      scope: provider.scope.join(' '),
      response_type: 'code',
      prompt: 'select_account',
    });
    for (const [key, value] of Object.entries(provider.extraAuthorizationParams ?? {})) {
      if (RESERVED_OAUTH_PARAMS.has(key)) continue;
      authParams.set(key, value);
    }
    authParams.set('state', oauthState.state);
    if (oauthState.codeChallenge) {
      authParams.set('code_challenge', oauthState.codeChallenge);
      authParams.set('code_challenge_method', 'S256');
    }

    res.writeHead(302, {
      Location: `${provider.authorizationURL}?${authParams.toString()}`,
    });
    res.end();
    return true;
  }

  const rateLimiting = config.rateLimiting;
  //? DD-LOGIN-F5: resolve the client IP once, unconditionally, so it can be
  //? threaded into `loginWithCredentials` for the IP+account composite lockout
  //? key even when the per-IP rate-limit gate is disabled. When trustProxy is
  //? false this returns the raw socket address (sentinel `'unknown'` when absent).
  const requesterIp = resolveClientIp({
    rawAddress: req.socket.remoteAddress,
    headers: req.headers,
    trustProxy: config.http.trustProxy,
    trustedProxyHopCount: config.http.trustedProxyHopCount,
  });

  //? Derive the per-IP limit for this credentials endpoint. When the global
  //? `defaultApiLimit` is disabled (set to `false`), fall back to the auth-
  //? specific `rateLimiting.auth` slot so an IP spraying across accounts is
  //? still throttled — even when consumers explicitly disable the general limit
  //? for performance reasons. The auth slot defaults to `{ enabled: false }`,
  //? so the fallback is also a no-op unless the consumer opts in.
  const ipLimitCount =
    rateLimiting.defaultApiLimit !== false && rateLimiting.defaultApiLimit > 0
      ? rateLimiting.defaultApiLimit
      : (rateLimiting.auth.enabled && rateLimiting.auth.maxAttempts > 0
        ? rateLimiting.auth.maxAttempts
        : null);
  if (ipLimitCount !== null) {
    //? L4: window derived from the SAME predicate as `ipLimitCount` so
    //? `defaultApiLimit: 0` doesn't mix the auth count with the general window.
    const ipWindowMs =
      rateLimiting.defaultApiLimit !== false && rateLimiting.defaultApiLimit > 0
        ? rateLimiting.windowMs
        : rateLimiting.auth.windowMs;
    const { allowed, resetIn } = await checkRateLimit({
      key: `ip:${requesterIp}:auth:credentials`,
      limit: ipLimitCount,
      windowMs: ipWindowMs,
    });

    if (!allowed) {
      void dispatchHook('rateLimitExceeded', {
        scope: 'auth',
        key: `ip:${requesterIp}:auth:credentials`,
        limit: ipLimitCount,
        windowMs: ipWindowMs,
        count: ipLimitCount + 1,
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

  //? Pass the requester's current session token as `supersedeToken` and the
  //? resolved `requesterIp` (DD-LOGIN-F5 composite lockout key) so that on
  //? a re-login while already signed in, single-session enforcement does NOT
  //? kick this same browser's old session.
  const result = (await login.loginWithCredentials(params, { supersedeToken: token ?? undefined, requesterIp })) as {
    status: boolean;
    reason: string;
    newToken: string | null;
    session: unknown;
    //? ADR 0024: 2FA half-way state — first factor OK, no session minted yet.
    requiresTwoFactor?: true;
    challengeToken?: string;
    twoFactorMethods?: string[];
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

  //? 2FA challenge (ADR 0024): relay the parked-login envelope. NO session
  //? transport is set — `/auth/api/2fa` completes the login and mints it.
  if (result.requiresTwoFactor) {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      status: true,
      reason: result.reason,
      requiresTwoFactor: true,
      challengeToken: result.challengeToken,
      twoFactorMethods: result.twoFactorMethods,
      authenticated: false,
    }));
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

  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    status: result.status,
    reason: result.reason,
    session: result.session,
    authenticated: Boolean(result.newToken),
  }));
  return true;
};
