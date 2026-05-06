import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  allowedOrigin,
  checkRateLimit,
  clearAllHooks,
  clearAllRateLimits,
  computeSynchronizedEnvHashes,
  dispatchHook,
  extractTokenFromRequest,
  getLogger,
  getParams,
  getProjectConfig,
  hasCookie,
  prisma,
  readBootUuid,
  redis,
  resolveEnvKey,
  serveAvatar,
} from '@luckystack/core';
import { captureException } from '@luckystack/core';
import { handleHttpApiRequest } from '@luckystack/api';
import { handleHttpSyncRequest, type HttpSyncStreamEvent } from '@luckystack/sync';
import {
  createOAuthState,
  deleteSession,
  getSession,
  loginCallback,
  loginWithCredentials,
  getOAuthProviders,
  isFullOAuthProvider,
} from '@luckystack/login';
import { initSseResponse, sendSseEvent, shouldUseHttpStream } from './sse';
import { sanitizeForLog } from './logSanitize';
import { getCustomRoutes } from './customRoutesRegistry';
import type { CreateLuckyStackServerOptions } from './types';

interface NormalizedHttpSyncParams {
  data: Record<string, unknown>;
  receiver: string;
  ignoreSelf?: boolean;
  cb?: string;
}

const parseSessionBasedTokenHeader = (headerValue: string | string[] | undefined): boolean | null => {
  if (headerValue === undefined) return null;
  const value = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return null;
};

const normalizeHttpSyncParams = (params: object | null): NormalizedHttpSyncParams => {
  const source = (params ?? {}) as Record<string, unknown>;
  const data = (source.data && typeof source.data === 'object'
    ? (source.data as Record<string, unknown>)
    : {});
  return {
    data,
    receiver: typeof source.receiver === 'string' ? source.receiver : '',
    ignoreSelf: typeof source.ignoreSelf === 'boolean' ? source.ignoreSelf : undefined,
    cb: typeof source.cb === 'string' ? source.cb : undefined,
  };
};

const buildSessionCookieOptions = (
  sessionExpiryDays: number,
  secure: boolean,
  http: ReturnType<typeof getProjectConfig>['http'],
): string =>
  `HttpOnly; SameSite=${http.sessionCookieSameSite}; Path=${http.sessionCookiePath}; Max-Age=${60 * 60 * 24 * sessionExpiryDays}; ${secure ? 'Secure;' : ''}`;

const setSecurityHeaders = (_req: IncomingMessage, res: ServerResponse, origin: string) => {
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
};

export const handleHttpRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
  options: CreateLuckyStackServerOptions
): Promise<void> => {
  const config = getProjectConfig();
  const shouldLogDev = config.logging.devLogs;
  const sessionCookieName = config.http.sessionCookieName;
  const sessionCookieOptions = buildSessionCookieOptions(
    config.session.expiryDays,
    process.env.SECURE === 'true',
    config.http,
  );

  const origin = req.headers.origin ?? req.headers.referer ?? req.headers.host ?? '';

  if (!allowedOrigin(origin)) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Forbidden');
    return;
  }

  setSecurityHeaders(req, res, origin);

  //? Honor an incoming x-request-id (idempotent for proxies/retries) or
  //? generate a fresh UUID. Echo back as a response header so client-side
  //? logs and Sentry can correlate.
  const incomingRequestId = req.headers['x-request-id'];
  const requestId = (Array.isArray(incomingRequestId) ? incomingRequestId[0] : incomingRequestId) || randomUUID();
  res.setHeader('X-Request-Id', requestId);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const method = req.method;
  const url = req.url || '/';
  const [routePath, queryString] = url.split('?');

  if (method !== 'GET' && method !== 'POST' && method !== 'PUT' && method !== 'DELETE') {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end(`method: ${String(method)} not supported, use one of: GET, POST, PUT, DELETE`);
    return;
  }

  const token = extractTokenFromRequest(req);
  const hasTokenCookie = hasCookie(req.headers.cookie, sessionCookieName);

  if (hasTokenCookie && token) {
    const currentSession = await getSession(token);
    if (currentSession?.id) {
      //? Sliding expiration in cookie mode: keep browser token lifetime
      //? aligned with Redis TTL.
      res.setHeader('Set-Cookie', `${sessionCookieName}=${token}; ${sessionCookieOptions}`);
    }
  }

  // ── /auth/csrf — fetch the session's CSRF token (cookie mode) ────────────
  //? Returns the CSRF token bound to the current session. The client must
  //? send it as `x-csrf-token` on subsequent state-changing HTTP requests.
  //? In token mode this endpoint still works but the token is unused (token
  //? mode is CSRF-immune because cross-origin POSTs don't auto-attach the
  //? sessionStorage value).
  if (routePath === '/auth/csrf') {
    if (!token) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'error', errorCode: 'auth.unauthenticated' }));
      return;
    }
    const csrfSession = await getSession(token);
    if (!csrfSession?.id) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'error', errorCode: 'auth.unauthenticated' }));
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      status: 'success',
      csrfToken: csrfSession.csrfToken ?? null,
    }));
    return;
  }

  // ── CSRF validation on state-changing cookie-mode requests ───────────────
  //? Skipped when:
  //?   - The request is GET / OPTIONS (read-only).
  //?   - The session is token-mode (sessionStorage; cross-origin POSTs
  //?     don't auto-attach the value, so CSRF is structurally impossible).
  //?   - There is no session yet (initial credentials login, OAuth start).
  //?   - The path is `/auth/callback/*` (OAuth `state` param protects it).
  //?   - The path is `/auth/api/credentials` for first-time login (no
  //?     prior session) — but we still validate when a session exists, so
  //?     a logged-in user can't be tricked into switching accounts.
  const isCookieMode = !config.session.basedToken;
  const isStateChanging = req.method !== 'GET' && req.method !== 'OPTIONS';
  const isCallbackPath = routePath.startsWith('/auth/callback');
  const looksLikeFrameworkRoute =
    routePath.startsWith('/api/')
    || routePath.startsWith('/sync/')
    || routePath.startsWith('/auth/api/');

  if (isCookieMode && isStateChanging && looksLikeFrameworkRoute && !isCallbackPath && token) {
    const csrfSession = await getSession(token);
    if (csrfSession?.id) {
      const headerValue = req.headers['x-csrf-token'];
      const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;
      if (!provided || provided !== csrfSession.csrfToken) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          status: 'error',
          errorCode: 'auth.csrfMismatch',
          message: 'CSRF token missing or invalid. Fetch /auth/csrf first.',
        }));
        return;
      }
    }
  }

  // ── /favicon.ico ─────────────────────────────────────────────────────────
  if (routePath === '/favicon.ico') {
    if (options.serveFavicon) {
      await options.serveFavicon(res);
      return;
    }
    res.writeHead(404);
    res.end();
    return;
  }

  // ── /livez (Kubernetes liveness probe) ───────────────────────────────────
  if (routePath === config.http.liveEndpoint) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'live' }));
    return;
  }

  // ── /readyz (Kubernetes readiness probe) ─────────────────────────────────
  if (routePath === config.http.readyEndpoint) {
    const bootUuid = await readBootUuid();
    let redisOk = false;
    let prismaOk = false;
    try {
      const pong = await (redis as any).ping();
      redisOk = pong === 'PONG' || pong === 'pong' || Boolean(pong);
    } catch {
      redisOk = false;
    }
    try {
      await (prisma as any).$queryRaw`SELECT 1`;
      prismaOk = true;
    } catch {
      prismaOk = false;
    }

    const ready = Boolean(bootUuid) && redisOk && prismaOk;
    res.statusCode = ready ? 200 : 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      status: ready ? 'ready' : 'not-ready',
      checks: { bootUuid: Boolean(bootUuid), redis: redisOk, prisma: prismaOk },
    }));
    return;
  }

  // ── /_health (router boot handshake) ─────────────────────────────────────
  if (routePath === config.http.healthEndpoint) {
    const bootUuid = await readBootUuid();
    const synchronizedHashes = computeSynchronizedEnvHashes();
    res.statusCode = bootUuid ? 200 : 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        status: bootUuid ? 'ok' : 'degraded',
        bootUuid,
        envKey: resolveEnvKey(),
        synchronizedHashes,
      })
    );
    return;
  }

  // ── /_test/reset (dev-only state reset) ──────────────────────────────────
  if (routePath === config.http.testResetEndpoint) {
    if (process.env.NODE_ENV === 'production') {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'error', errorCode: 'notFound' }));
      return;
    }
    const requiredToken = process.env.TEST_RESET_TOKEN;
    if (requiredToken && req.headers['x-test-reset-token'] !== requiredToken) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'error', errorCode: 'auth.forbidden' }));
      return;
    }

    const cleared: string[] = [];
    await clearAllRateLimits();
    cleared.push('rateLimits');

    //? Flush sessions + activeUsers Redis keys so integration tests start
    //? from a clean slate.
    const projectName = process.env.PROJECT_NAME || 'luckystack';
    const sessionPattern = `${projectName}-session:*`;
    const activeUsersPattern = `${projectName}-activeUsers:*`;

    const scanAndDelete = async (pattern: string, label: string): Promise<number> => {
      try {
        let cursor = '0';
        let deleted = 0;
        do {
          const [next, keys] = await (redis as any).scan(cursor, 'MATCH', pattern, 'COUNT', 200);
          cursor = next;
          if (Array.isArray(keys) && keys.length > 0) {
            await (redis as any).del(...keys);
            deleted += keys.length;
          }
        } while (cursor !== '0');
        if (deleted > 0) cleared.push(label);
        return deleted;
      } catch {
        return 0;
      }
    };

    await scanAndDelete(sessionPattern, 'sessions');
    await scanAndDelete(activeUsersPattern, 'activeUsers');

    //? Opt-in hook clear via `?include=hooks` because clearing all hooks
    //? would also drop framework-internal handlers (e.g. presence postLogout).
    const includeFlag = (() => {
      try {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        return url.searchParams.get('include') ?? '';
      } catch {
        return '';
      }
    })();
    if (includeFlag.split(',').map((s) => s.trim()).includes('hooks')) {
      clearAllHooks();
      cleared.push('hooks');
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'success', cleared }));
    return;
  }

  // ── parse params (early, so logs and downstream handlers can use them) ──
  let params: object | null;
  params = await getParams({ method, req, res, queryString });

  if (res.writableEnded) return;

  if (params && typeof params === 'object' && Object.keys(params).length > 0) {
    if (shouldLogDev) {
      getLogger().debug(`[${requestId}] ${method} ${routePath}`, { params: sanitizeForLog(params) as Record<string, unknown> });
    }
  } else {
    if (shouldLogDev) {
      getLogger().debug(`[${requestId}] ${method} ${routePath}`);
    }
    params = {};
  }

  // ── /uploads/* ───────────────────────────────────────────────────────────
  if (routePath.startsWith('/uploads/')) {
    await serveAvatar({ routePath, res });
    return;
  }

  // ── /auth/api/* — login / register / OAuth-redirect ──────────────────────
  if (routePath.startsWith('/auth/api')) {
    const providerName = routePath.split('/')[3];
    const provider = getOAuthProviders().find((p) => p.name === providerName);
    if (!provider?.name) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: false, reason: 'login.providerNotFound' }));
      return;
    }

    if (isFullOAuthProvider(provider)) {
      const oauthState = await createOAuthState(provider.name);
      if (!oauthState) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: false, reason: 'login.oauthStateInitFailed' }));
        return;
      }

      const clientId = encodeURIComponent(provider.clientID);
      const callbackUrl = encodeURIComponent(provider.callbackURL);
      const scope = encodeURIComponent((provider.scope as string[]).join(' '));
      const state = encodeURIComponent(oauthState);

      res.writeHead(302, {
        Location: `${provider.authorizationURL}?client_id=${clientId}&redirect_uri=${callbackUrl}&scope=${scope}&response_type=code&prompt=select_account&state=${state}`,
      });
      res.end();
      return;
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
        res.end(
          JSON.stringify({
            status: false,
            reason: 'api.rateLimitExceeded',
            errorParams: [{ key: 'seconds', value: resetIn }],
          })
        );
        return;
      }
    }

    const result = (await loginWithCredentials(params as Record<string, string>)) as {
      status: boolean;
      reason: string;
      newToken: string | null;
      session: unknown;
    } | undefined;

    if (!result || !result.status) {
      const reasonKey =
        typeof result?.reason === 'string' && result.reason.length > 0
          ? result.reason
          : 'api.internalServerError';
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ status: false, reason: reasonKey }));
      return;
    }

    if (result.newToken) {
      if (token) await deleteSession(token);

      const requestedSessionMode = parseSessionBasedTokenHeader(req.headers['x-session-based-token']);
      const useSessionBasedToken = requestedSessionMode ?? config.session.basedToken;

      if (shouldLogDev) getLogger().debug('http: setting cookie with new token');

      if (!useSessionBasedToken) {
        res.setHeader('Set-Cookie', `${sessionCookieName}=${result.newToken}; ${sessionCookieOptions}`);
      } else {
        res.setHeader('X-Session-Token', result.newToken);
      }
    }

    res.end(
      JSON.stringify({
        status: result.status,
        reason: result.reason,
        session: result.session,
        authenticated: Boolean(result.newToken),
      })
    );
    return;
  }

  // ── /auth/callback/* — OAuth redirect target ─────────────────────────────
  if (routePath.startsWith('/auth/callback')) {
    const baseLocation = process.env.DNS ?? '/';
    const callbackResult = await loginCallback(routePath, req, res, {
      defaultRedirectUrl: baseLocation,
    });

    if (!callbackResult) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Login failed');
      return;
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
    return;
  }

  // ── /api/* — HTTP API request (with optional SSE streaming) ──────────────
  if (routePath.startsWith('/api/')) {
    let useHttpStream = false;
    let streamClosed = false;
    try {
      const httpToken = extractTokenFromRequest(req);
      useHttpStream = shouldUseHttpStream({ acceptHeader: req.headers.accept, queryString });

      if (useHttpStream) {
        initSseResponse(res);
        req.on('close', () => {
          streamClosed = true;
        });
      }

      const apiName = routePath.slice(5); // strip "/api/"

      if (!apiName) {
        const response = {
          status: 'error' as const,
          httpStatus: 400,
          message: 'api.invalidName',
          errorCode: 'api.invalidName',
        };
        if (useHttpStream) {
          if (!streamClosed) sendSseEvent({ res, event: 'final', data: response });
          res.end();
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(400);
        res.end(JSON.stringify(response));
        return;
      }

      const apiData = params && typeof params === 'object'
        ? { ...(params as Record<string, unknown>) }
        : {};
      delete (apiData as Record<string, unknown>).stream;

      const result = await handleHttpApiRequest({
        name: apiName,
        data: apiData,
        token: httpToken,
        requesterIp: req.socket.remoteAddress ?? undefined,
        xLanguageHeader: req.headers['x-language'],
        acceptLanguageHeader: req.headers['accept-language'],
        method: method,
        stream: useHttpStream
          ? (payload) => {
              if (streamClosed || res.writableEnded) return;
              sendSseEvent({ res, event: 'stream', data: payload });
            }
          : undefined,
      });

      if (useHttpStream) {
        if (!streamClosed) sendSseEvent({ res, event: 'final', data: result });
        res.end();
        return;
      }

      res.setHeader('Content-Type', 'application/json');
      res.writeHead(result.httpStatus);
      res.end(JSON.stringify(result));
      return;
    } catch (error) {
      getLogger().error('http-api: top-level handler threw', error, { routePath, method, requestId });
      captureException(error, { routePath, method, requestId, source: 'httpHandler.api' });
      void dispatchHook('apiError', {
        route: routePath,
        method,
        requestId,
        error: error instanceof Error ? error : new Error(String(error)),
      });

      const errResponse = {
        status: 'error' as const,
        httpStatus: 500,
        message: 'api.invalidRequestFormat',
        errorCode: 'api.invalidRequestFormat',
      };

      if (useHttpStream) {
        if (!res.writableEnded) sendSseEvent({ res, event: 'error', data: errResponse });
        res.end();
        return;
      }

      res.setHeader('Content-Type', 'application/json');
      res.writeHead(500);
      res.end(JSON.stringify(errResponse));
      return;
    }
  }

  // ── /sync/* — HTTP sync request ──────────────────────────────────────────
  if (routePath.startsWith('/sync/')) {
    let useHttpStream = false;
    let streamClosed = false;
    try {
      useHttpStream = shouldUseHttpStream({ acceptHeader: req.headers.accept, queryString });

      if (useHttpStream) {
        initSseResponse(res);
        req.on('close', () => {
          streamClosed = true;
        });
      }

      if (method !== 'POST') {
        const response = {
          status: 'error' as const,
          message: 'sync.methodNotAllowed',
          errorCode: 'sync.methodNotAllowed',
        };
        if (useHttpStream) {
          if (!streamClosed) sendSseEvent({ res, event: 'final', data: response });
          res.end();
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(405);
        res.end(JSON.stringify(response));
        return;
      }

      const httpToken = extractTokenFromRequest(req);
      const syncName = routePath.slice(6); // strip "/sync/"

      if (!syncName) {
        const response = {
          status: 'error' as const,
          message: 'sync.invalidName',
          errorCode: 'sync.invalidName',
        };
        if (useHttpStream) {
          if (!streamClosed) sendSseEvent({ res, event: 'final', data: response });
          res.end();
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(400);
        res.end(JSON.stringify(response));
        return;
      }

      const syncParams = normalizeHttpSyncParams(params);

      const result = await handleHttpSyncRequest({
        name: `sync/${syncName}`,
        cb: syncParams.cb,
        data: syncParams.data,
        receiver: syncParams.receiver,
        ignoreSelf: syncParams.ignoreSelf,
        token: httpToken,
        requesterIp: req.socket.remoteAddress ?? undefined,
        xLanguageHeader: req.headers['x-language'],
        acceptLanguageHeader: req.headers['accept-language'],
        stream: useHttpStream
          ? (payload: HttpSyncStreamEvent) => {
              if (streamClosed || res.writableEnded) return;
              sendSseEvent({ res, event: 'stream', data: payload });
            }
          : undefined,
      });

      if (useHttpStream) {
        if (!streamClosed) sendSseEvent({ res, event: 'final', data: result });
        res.end();
        return;
      }

      res.setHeader('Content-Type', 'application/json');
      res.writeHead(result.status === 'success' ? 200 : 400);
      res.end(JSON.stringify(result));
      return;
    } catch (error) {
      getLogger().error('http-sync: top-level handler threw', error, { routePath, method, requestId });
      captureException(error, { routePath, method, requestId, source: 'httpHandler.sync' });
      void dispatchHook('syncError', {
        route: routePath,
        method,
        requestId,
        error: error instanceof Error ? error : new Error(String(error)),
      });

      const errResponse = {
        status: 'error' as const,
        message: 'sync.invalidRequestFormat',
        errorCode: 'sync.invalidRequestFormat',
      };

      if (useHttpStream) {
        if (!res.writableEnded) sendSseEvent({ res, event: 'error', data: errResponse });
        res.end();
        return;
      }

      res.setHeader('Content-Type', 'application/json');
      res.writeHead(500);
      res.end(JSON.stringify(errResponse));
      return;
    }
  }

  // ── project-side custom routes (last chance before static fallback) ─────
  //? Two sources, evaluated in order: (1) handlers registered via
  //? `registerCustomRoute(...)` from overlay packages (`@luckystack/docs-ui`,
  //? etc.); (2) the legacy `customRoutes` option on
  //? `CreateLuckyStackServerOptions`. First one to return `true` (or end
  //? the response) wins.
  const ctx = { routePath, method, queryString, token };
  for (const handler of getCustomRoutes()) {
    try {
      const handled = await handler(req, res, ctx);
      if (handled || res.writableEnded) return;
    } catch (handlerError) {
      //? Custom route handlers come from third-party overlay packages — one
      //? misbehaving handler must not crash the request loop or leak the
      //? error to the client. Surface to logger + Sentry, then fall through
      //? to the next handler / 404 path.
      getLogger().error('custom route handler threw', handlerError, { routePath, method });
      captureException(handlerError, { routePath, method, source: 'customRoutesRegistry' });
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', errorCode: 'server.customRouteFailed' }));
      }
      return;
    }
  }
  if (options.customRoutes) {
    try {
      const handled = await options.customRoutes(req, res, ctx);
      if (handled || res.writableEnded) return;
    } catch (handlerError) {
      getLogger().error('options.customRoutes threw', handlerError, { routePath, method });
      captureException(handlerError, { routePath, method, source: 'createServer.customRoutes' });
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', errorCode: 'server.customRouteFailed' }));
      }
      return;
    }
  }

  // ── /assets/* — static assets ────────────────────────────────────────────
  if (routePath.includes('/assets/')) {
    if (!options.serveFile) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const assetPath = routePath.slice(routePath.indexOf('/assets/'));
    (req as IncomingMessage & { url?: string }).url = assetPath;
    await options.serveFile(req, res);
    return;
  }

  // ── *.{png,jpg,...} — known static file extensions ──────────────────────
  if (
    /^\/(assets\/[a-zA-Z0-9_\-/]+|[a-zA-Z0-9_\-]+)\.(png|jpg|jpeg|gif|svg|html|css|js)$/.test(
      routePath
    )
  ) {
    if (!options.serveFile) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    await options.serveFile(req, res);
    return;
  }

  // ── path with extension we don't recognize — 404 ─────────────────────────
  if (path.extname(routePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  // ── catch-all (index.html for SPA routing) ──────────────────────────────
  if (!options.serveFile) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  (req as IncomingMessage & { url?: string }).url = '/';
  await options.serveFile(req, res);
};
