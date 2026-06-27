import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  allowedOrigin,
  dispatchHook,
  extractTokenFromRequest,
  getLogger,
  getParams,
  getProjectConfig,
  hasCookie,
  normalizeOrigin,
  readSession,
  tryCatch,
  tryCatchSync,
} from '@luckystack/core';
import { sanitizeForLog } from './logSanitize';
import { getSecurityHeadersBuilder } from './securityHeadersRegistry';
import type { CreateLuckyStackServerOptions } from './types';
import { enforceCsrfOnStateChangingRequest } from './httpRoutes/csrfMiddleware';
import { handleCsrfRoute } from './httpRoutes/csrfRoute';
import { handleFaviconRoute } from './httpRoutes/faviconRoute';
import { handleHealthRoute, handleLivezRoute, handleReadyzRoute } from './httpRoutes/healthRoutes';
import { handleTestResetRoute } from './httpRoutes/testResetRoute';
import { handleUploadsRoute } from './httpRoutes/uploadsRoute';
import { handleAuthApiRoute } from './httpRoutes/authApiRoute';
import { handleAuthLogoutRoute } from './httpRoutes/authLogoutRoute';
import { handleAuthProvidersRoute } from './httpRoutes/authProvidersRoute';
import { handleAuthCallbackRoute } from './httpRoutes/authCallbackRoute';
import { handleApiRoute } from './httpRoutes/apiRoute';
import { handleSyncRoute } from './httpRoutes/syncRoute';
import { handleCustomRoutes, handlePreParamsCustomRoutes } from './httpRoutes/customRoutes';
import { handleStaticAndSpaFallback } from './httpRoutes/staticRoutes';
import { isOriginExemptPath } from './originExemptRegistry';
import { resolveCookieSecure } from './httpRoutes/sessionCookie';
import type { HttpRouteContext, HttpRouteHandler } from './httpRoutes/types';

const buildSessionCookieOptions = (
  sessionExpiryDays: number,
  secure: boolean,
  http: ReturnType<typeof getProjectConfig>['http'],
): string =>
  `HttpOnly; SameSite=${http.sessionCookieSameSite}; Path=${http.sessionCookiePath}; Max-Age=${60 * 60 * 24 * sessionExpiryDays}; ${secure ? 'Secure;' : ''}`;

const setSecurityHeaders = (req: IncomingMessage, res: ServerResponse, origin: string) => {
  const { cors, securityHeaders } = getProjectConfig().http;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', cors.allowedMethods);
  res.setHeader('Access-Control-Allow-Headers', cors.allowedHeaders);
  res.setHeader('Access-Control-Expose-Headers', cors.exposedHeaders);
  if (cors.credentials) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Referrer-Policy', securityHeaders.referrerPolicy);
  res.setHeader('X-Frame-Options', securityHeaders.frameOptions);
  res.setHeader('X-XSS-Protection', securityHeaders.xssProtection);
  res.setHeader('X-Content-Type-Options', securityHeaders.contentTypeOptions);

  //? Consumer-registered builder runs AFTER framework defaults so it can
  //? override (CSP, HSTS, Permissions-Policy) or extend. Errors fall
  //? through to defaults so a buggy builder can't kill response delivery.
  const builder = getSecurityHeadersBuilder();
  if (builder) {
    //? Wrap both the builder call AND the header writes so a buggy builder (or
    //? an invalid header name/value it returns) can't kill response delivery —
    //? same guarded scope as the original raw try/catch, just via tryCatchSync.
    const [error] = tryCatchSync(() => {
      const custom = builder(req);
      if (custom) {
        for (const [name, value] of Object.entries(custom)) {
          res.setHeader(name, value);
        }
      }
    });
    if (error) {
      getLogger().warn('securityHeadersBuilder threw — falling back to defaults', { err: error });
    }
  }
};

//? Routes that run BEFORE params parsing — they don't need (and shouldn't
//? consume) the request body. The framework fast-paths run first; consumer
//? `'pre-params'` custom routes (webhooks / streaming uploads) run last, after
//? the probes but before `getParams` drains the body.
const PRE_PARAMS_ROUTES: HttpRouteHandler[] = [
  handleCsrfRoute,
  handleFaviconRoute,
  handleLivezRoute,
  handleReadyzRoute,
  handleHealthRoute,
  handleTestResetRoute,
  handleAuthProvidersRoute,
  handleAuthLogoutRoute,
  handlePreParamsCustomRoutes,
];

//? Routes that run AFTER params parsing.
const POST_PARAMS_ROUTES: HttpRouteHandler[] = [
  handleUploadsRoute,
  handleAuthApiRoute,
  handleAuthCallbackRoute,
  handleApiRoute,
  handleSyncRoute,
  handleCustomRoutes,
  handleStaticAndSpaFallback,
];

const dispatchRoutes = async (handlers: HttpRouteHandler[], ctx: HttpRouteContext): Promise<boolean> => {
  for (const handler of handlers) {
    const handled = await handler(ctx);
    if (handled || ctx.res.writableEnded) return true;
  }
  return false;
};

const enforceOriginPolicy = (
  req: IncomingMessage,
  res: ServerResponse,
  routePath: string,
): { origin: string; rejected: boolean } => {
  //? Do NOT fall back to `req.headers.host` — host always equals the bound
  //? origin so non-browser callers (curl, native apps) would silently bypass
  //? `allowedOrigin()`. Only browsers attach Origin/Referer.
  //? Normalize at the source: a Referer fallback is a FULL URL (with path/query),
  //? so reduce it to scheme+host before it's both allowlist-checked AND reflected
  //? into `Access-Control-Allow-Origin`. A raw referer would otherwise produce an
  //? invalid ACAO (containing a path) that the browser rejects — silently breaking
  //? credentialed cross-origin clients that send Referer but no Origin header.
  const origin = normalizeOrigin({
    value: req.headers.origin ?? req.headers.referer ?? '',
    secure: process.env.SECURE === 'true',
  });
  const isStateChangingMethod = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';

  //? Registered webhook / server-to-server prefixes opt out of the browser
  //? origin gate — they authenticate via signature/HMAC in the handler, not via
  //? Origin (which they never send). Empty by default; opt-in only. The handler
  //? is still responsible for verifying the caller. See originExemptRegistry.
  if (isOriginExemptPath(routePath)) {
    return { origin, rejected: false };
  }

  if (!origin) {
    //? No browser-attributable origin: fail-close on state-changing methods,
    //? allow read-only (GET/HEAD/OPTIONS) so health probes and asset fetches
    //? from non-browser tooling continue to work.
    if (isStateChangingMethod) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Forbidden');
      return { origin, rejected: true };
    }
  } else if (!allowedOrigin(origin)) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Forbidden');
    return { origin, rejected: true };
  }
  return { origin, rejected: false };
};

const refreshSessionCookieIfPresent = async ({
  req,
  res,
  token,
  sessionCookieName,
  sessionCookieOptions,
}: {
  req: IncomingMessage;
  res: ServerResponse;
  token: string | null;
  sessionCookieName: string;
  sessionCookieOptions: string;
}) => {
  const hasTokenCookie = hasCookie(req.headers.cookie, sessionCookieName);
  if (!hasTokenCookie || !token) return;
  const currentSession = await readSession(token);
  if (currentSession?.id) {
    //? Sliding expiration in cookie mode: keep browser token lifetime
    //? aligned with Redis TTL.
    res.setHeader('Set-Cookie', `${sessionCookieName}=${token}; ${sessionCookieOptions}`);
  }
};

const parseRequestParams = async ({
  req,
  res,
  method,
  routePath,
  queryString,
  requestId,
  shouldLogDev,
}: {
  req: IncomingMessage;
  res: ServerResponse;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  routePath: string;
  queryString: string | undefined;
  requestId: string;
  shouldLogDev: boolean;
}): Promise<object | null> => {
  let params: object | null = await getParams({ method, req, res, queryString });
  if (res.writableEnded) return null;

  if (params && typeof params === 'object' && Object.keys(params).length > 0) {
    if (shouldLogDev) {
      getLogger().debug(`[${requestId}] ${method} ${routePath}`, {
        params: sanitizeForLog(params) as Record<string, unknown>,
      });
    }
  } else {
    if (shouldLogDev) {
      getLogger().debug(`[${requestId}] ${method} ${routePath}`);
    }
    params = {};
  }
  return params;
};

const handleHttpRequestInner = async (
  req: IncomingMessage,
  res: ServerResponse,
  options: CreateLuckyStackServerOptions
): Promise<void> => {
  const config = getProjectConfig();
  const shouldLogDev = config.logging.devLogs;
  const sessionCookieName = config.http.sessionCookieName;
  const sessionCookieOptions = buildSessionCookieOptions(
    config.session.expiryDays,
    //? Honor the explicit `http.sessionCookieSecure` override (CORE-39), else the
    //? `SECURE` env flag — shared with the OAuth state cookie via
    //? `resolveCookieSecure` so the two can never drift (WAVE4).
    resolveCookieSecure(config.http.sessionCookieSecure, process.env.SECURE),
    config.http,
  );

  //? Parse the path up-front so the origin gate can consult the exempt-path
  //? registry (registered webhooks) before it would otherwise 403 a
  //? header-less, state-changing request.
  //? SEC: decode percent-encoded characters so that e.g. `/auth%2Flogout` cannot
  //? bypass route guards that compare against plain `/auth/logout`. Malformed
  //? encoding returns 400 so the request does not silently fall through.
  const url = req.url ?? '/';
  const [routePathRaw, queryStringRaw] = url.split('?');
  const [decodeError, decodedPath] = tryCatchSync(() => decodeURIComponent(routePathRaw ?? '/'));
  if (decodeError || decodedPath === null) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Bad Request');
    return;
  }
  const routePath = decodedPath;
  const queryString = queryStringRaw ?? '';

  const { origin, rejected } = enforceOriginPolicy(req, res, routePath);
  if (rejected) return;

  setSecurityHeaders(req, res, origin);

  //? Honor an incoming x-request-id (idempotent for proxies/retries) or
  //? generate a fresh UUID. Echo back as a response header so client-side
  //? logs and Sentry can correlate.
  //? SEC: validate before reflecting — only alphanumeric + hyphens, max 128 chars,
  //? to prevent header-injection via a crafted x-request-id value.
  const incomingRequestId = req.headers['x-request-id'];
  const rawRequestId = Array.isArray(incomingRequestId) ? incomingRequestId[0] : incomingRequestId;
  const requestId = (rawRequestId && /^[a-zA-Z0-9-]{1,128}$/.test(rawRequestId)) ? rawRequestId : randomUUID();
  res.setHeader('X-Request-Id', requestId);

  //? `preHttpRequest` fires before any route dispatch. Use to instrument
  //? requests (latency timer, audit log), enforce IP allow-lists, or stop
  //? specific paths with a custom error. Header subset excludes auth/cookie.
  const safeHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (k === 'authorization' || k === 'cookie' || k === 'set-cookie' || k === 'x-csrf-token' || k === 'x-test-reset-token' || k === 'x-session-based-token') continue;
    safeHeaders[k] = Array.isArray(v) ? v.join(', ') : (v ?? '');
  }
  const preHttpResult = await dispatchHook('preHttpRequest', {
    method: req.method?.toUpperCase() ?? 'GET',
    url: req.url ?? '/',
    requestId,
    origin,
    headers: safeHeaders,
  });
  if (preHttpResult.stopped) {
    res.statusCode = preHttpResult.signal.httpStatus ?? 403;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'error', errorCode: preHttpResult.signal.errorCode }));
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const method = req.method;

  if (method !== 'GET' && method !== 'POST' && method !== 'PUT' && method !== 'DELETE') {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end(`method: ${String(method)} not supported, use one of: GET, POST, PUT, DELETE`);
    return;
  }

  const token = extractTokenFromRequest(req);
  await refreshSessionCookieIfPresent({ req, res, token, sessionCookieName, sessionCookieOptions });

  const csrfRejected = await enforceCsrfOnStateChangingRequest({ req, res, routePath, token, requestId });
  if (csrfRejected) return;

  const baseCtx: Omit<HttpRouteContext, 'params'> = {
    req,
    res,
    options,
    routePath,
    queryString,
    method,
    token,
    requestId,
    sessionCookieOptions,
  };

  //? Route /auth/csrf, health probes, _test/reset, favicon — all fast paths
  //? that should not consume the request body.
  if (await dispatchRoutes(PRE_PARAMS_ROUTES, { ...baseCtx, params: {} })) return;

  const params = await parseRequestParams({
    req, res, method, routePath, queryString, requestId, shouldLogDev,
  });
  if (params === null) return;

  await dispatchRoutes(POST_PARAMS_ROUTES, { ...baseCtx, params });
};

export const handleHttpRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
  options: CreateLuckyStackServerOptions
): Promise<void> => {
  //? Top-level error boundary: catches any unhandled throw that escapes route
  //? handlers and prevents it from propagating into the Node.js
  //? unhandled-rejection handler (which would crash the process in Node ≥15).
  //? Returns 500 so the client gets a defined response instead of a hang.
  const [error] = await tryCatch(() => handleHttpRequestInner(req, res, options));
  if (error && !res.writableEnded) {
    getLogger().error('handleHttpRequest: unhandled error', { err: error });
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'error', errorCode: 'server.internalError' }));
  }
};
