//? Email-code login + 2FA HTTP routes (ADR 0024). These live in the framework
//? layer — NOT file-based `_api` routes — because completing a login must set
//? the HttpOnly session cookie, and only this layer can write `Set-Cookie`
//? (same seam as authApiRoute.ts). Registered BEFORE handleAuthApiRoute in
//? POST_PARAMS_ROUTES: that handler catch-alls `/auth/api/*` into
//? `login.providerNotFound`.
//?
//? Surface (all POST, JSON):
//?   /auth/api/email-code/request   { email }                    → { status: true }  (anti-enumeration)
//?   /auth/api/email-code/verify    { email, code }              → login envelope (may be a 2FA challenge)
//?   /auth/api/2fa                  { challengeToken, code, method? } → login envelope (completes the login)
//?   /auth/api/2fa/email-code       { challengeToken }           → send the fallback code for a challenge
//?   — authenticated (require a live session): —
//?   /auth/api/2fa/setup            {}                           → { secret, otpauthUri }
//?   /auth/api/2fa/enable           { code }                     → { recoveryCodes[] } (raw, exactly once)
//?   /auth/api/2fa/disable          { code }                     → { status }
//?   /auth/api/2fa/recovery-codes   { code }                     → { recoveryCodes[] } (fresh set)

import { checkRateLimit, getProjectConfig, resolveClientIp } from '@luckystack/core';
import { getLogin } from '../capabilities';
import type { HttpRouteContext, HttpRouteHandler } from './types';

type LoginModule = NonNullable<Awaited<ReturnType<typeof getLogin>>>;

const json = (ctx: HttpRouteContext, statusCode: number, body: unknown): true => {
  ctx.res.statusCode = statusCode;
  ctx.res.setHeader('content-type', 'application/json; charset=utf-8');
  ctx.res.end(JSON.stringify(body));
  return true;
};

const methodNotAllowed = (ctx: HttpRouteContext): true => {
  ctx.res.statusCode = 405;
  ctx.res.setHeader('Allow', 'POST');
  ctx.res.end();
  return true;
};

const requesterIpOf = (ctx: HttpRouteContext): string => {
  const config = getProjectConfig();
  return resolveClientIp({
    rawAddress: ctx.req.socket.remoteAddress,
    headers: ctx.req.headers,
    trustProxy: config.http.trustProxy,
    trustedProxyHopCount: config.http.trustedProxyHopCount,
  });
};

//? Per-IP shield in front of the login-package logic (which adds its own
//? per-email / per-challenge budgets). Fixed windows keep the bucket
//? meaningful even when the general API limiter is off.
const ipThrottled = async (ctx: HttpRouteContext, bucket: string, limit: number): Promise<boolean> => {
  const { allowed } = await checkRateLimit({
    key: `ip:${requesterIpOf(ctx)}:auth:${bucket}`,
    limit,
    windowMs: 15 * 60 * 1000,
  });
  return !allowed;
};

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

//? THE COOKIE SEAM (mirror of authApiRoute.ts): relay a CredentialsLoginResult
//? to the wire. Full success → session transport (header or cookie) + session
//? envelope; 2FA challenge → challenge envelope, NO transport; failure → reason.
const sendLoginResult = async (
  ctx: HttpRouteContext,
  login: LoginModule,
  result: { status: boolean; reason: string; newToken?: string; session?: unknown; requiresTwoFactor?: true; challengeToken?: string; twoFactorMethods?: string[] },
): Promise<true> => {
  if (!result.status) return json(ctx, 200, { status: false, reason: result.reason });

  if (result.requiresTwoFactor) {
    return json(ctx, 200, {
      status: true,
      reason: result.reason,
      requiresTwoFactor: true,
      challengeToken: result.challengeToken,
      twoFactorMethods: result.twoFactorMethods,
      authenticated: false,
    });
  }

  if (result.newToken) {
    //? Same supersede semantics as the credentials route: the old session was
    //? excluded from enforcement; clean it up without bouncing this browser.
    if (ctx.token) await login.deleteSession(ctx.token, { skipSocketLogout: true });
    const config = getProjectConfig();
    const headerValue = ctx.req.headers['x-session-based-token'];
    const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    const requestedSessionMode = raw === 'true' ? true : (raw === 'false' ? false : null);
    const useSessionBasedToken = requestedSessionMode ?? config.session.basedToken;
    if (useSessionBasedToken) {
      ctx.res.setHeader('X-Session-Token', result.newToken);
    } else {
      ctx.res.setHeader('Set-Cookie', `${config.http.sessionCookieName}=${result.newToken}; ${ctx.sessionCookieOptions}`);
    }
  }
  return json(ctx, 200, {
    status: true,
    reason: result.reason,
    session: result.session,
    authenticated: Boolean(result.newToken),
  });
};

//? Resolve the FRESH user record behind an authenticated request. The session
//? copy is sanitized (no totpSecret/recoveryCodes by design), so enrollment
//? routes re-read through the adapter.
const requireUser = async (ctx: HttpRouteContext, login: LoginModule) => {
  if (!ctx.token) return null;
  const session = await login.getSession(ctx.token);
  const userId = (session as { id?: string } | null)?.id;
  if (!userId) return null;
  return login.getUserAdapter().findById(userId);
};

export const handleAuthEmailCodeRoute: HttpRouteHandler = async (ctx) => {
  if (ctx.routePath !== '/auth/api/email-code/request' && ctx.routePath !== '/auth/api/email-code/verify') return false;
  if (ctx.method !== 'POST') return methodNotAllowed(ctx);

  const login = await getLogin();
  if (!login) return json(ctx, 200, { status: false, reason: 'auth.disabled' });

  const params = ctx.params as { email?: unknown; code?: unknown };
  const requesterIp = requesterIpOf(ctx);

  if (ctx.routePath === '/auth/api/email-code/request') {
    if (await ipThrottled(ctx, 'email-code-request', 10)) return json(ctx, 429, { status: false, reason: 'api.rateLimitExceeded' });
    const result = await login.requestEmailLoginCode({ email: str(params.email), requesterIp });
    //? Anti-enumeration is inside the login package; disabled-feature and
    //? send-failure reasons pass through (they are not account signals).
    return json(ctx, 200, result.ok ? { status: true } : { status: false, reason: result.reason });
  }

  if (await ipThrottled(ctx, 'email-code-verify', 20)) return json(ctx, 429, { status: false, reason: 'api.rateLimitExceeded' });
  const result = await login.verifyEmailLoginCode({
    email: str(params.email),
    code: str(params.code),
    supersedeToken: ctx.token ?? undefined,
    requesterIp,
  });
  return sendLoginResult(ctx, login, result);
};

export const handleAuthTwoFactorRoute: HttpRouteHandler = async (ctx) => {
  if (ctx.routePath !== '/auth/api/2fa' && !ctx.routePath.startsWith('/auth/api/2fa/')) return false;
  if (ctx.method !== 'POST') return methodNotAllowed(ctx);

  const login = await getLogin();
  if (!login) return json(ctx, 200, { status: false, reason: 'auth.disabled' });

  const params = ctx.params as { challengeToken?: unknown; code?: unknown; method?: unknown };
  const requesterIp = requesterIpOf(ctx);

  //? ── pre-login: complete a parked challenge ──
  if (ctx.routePath === '/auth/api/2fa') {
    if (await ipThrottled(ctx, '2fa-verify', 20)) return json(ctx, 429, { status: false, reason: 'api.rateLimitExceeded' });
    const method = str(params.method);
    const result = await login.verifyTwoFactorChallenge({
      challengeToken: str(params.challengeToken),
      code: str(params.code),
      method: method === 'email-code' || method === 'recovery-code' ? method : 'totp',
      supersedeToken: ctx.token ?? undefined,
      requesterIp,
    });
    return sendLoginResult(ctx, login, result);
  }

  if (ctx.routePath === '/auth/api/2fa/email-code') {
    if (await ipThrottled(ctx, '2fa-email-code', 5)) return json(ctx, 429, { status: false, reason: 'api.rateLimitExceeded' });
    const result = await login.requestTwoFactorEmailCode(str(params.challengeToken));
    return json(ctx, 200, result.ok ? { status: true } : { status: false, reason: result.reason });
  }

  //? ── authenticated: enrollment management ──
  //? Per-IP throttle on the code-checking management actions too — disable /
  //? recovery-codes verify a TOTP/recovery code and (unlike the login path)
  //? are not behind the per-challenge budget; without this a hijacked session
  //? could brute-force the current code unbounded.
  if (await ipThrottled(ctx, '2fa-manage', 15)) return json(ctx, 429, { status: false, reason: 'api.rateLimitExceeded' });
  const user = await requireUser(ctx, login);
  if (!user) return json(ctx, 401, { status: false, reason: 'api.unauthorized' });

  switch (ctx.routePath) {
    case '/auth/api/2fa/setup': {
      const start = await login.beginTotpEnrollment(user);
      return start.ok
        ? json(ctx, 200, { status: true, secret: start.secret, otpauthUri: start.otpauthUri })
        : json(ctx, 200, { status: false, reason: start.reason });
    }
    case '/auth/api/2fa/enable': {
      const confirmed = await login.confirmTotpEnrollment(user, str(params.code));
      return confirmed.ok
        ? json(ctx, 200, { status: true, recoveryCodes: confirmed.recoveryCodes })
        : json(ctx, 200, { status: false, reason: confirmed.reason });
    }
    case '/auth/api/2fa/disable': {
      const disabled = await login.disableTwoFactor(user, str(params.code));
      return json(ctx, 200, disabled.ok ? { status: true } : { status: false, reason: disabled.reason ?? 'login.twoFactorInvalidCode' });
    }
    case '/auth/api/2fa/recovery-codes': {
      const regenerated = await login.regenerateRecoveryCodes(user, str(params.code));
      return regenerated.ok
        ? json(ctx, 200, { status: true, recoveryCodes: regenerated.recoveryCodes })
        : json(ctx, 200, { status: false, reason: regenerated.reason });
    }
    default: {
      return json(ctx, 404, { status: false, reason: 'common.404' });
    }
  }
};
