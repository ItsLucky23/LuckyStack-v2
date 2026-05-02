import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import {
  allowedOrigin,
  checkRateLimit,
  clearAllRateLimits,
  computeSynchronizedEnvHashes,
  extractTokenFromRequest,
  getParams,
  getProjectConfig,
  hasCookie,
  readBootUuid,
  resolveEnvKey,
  serveAvatar,
  serverRuntimeConfig,
} from '@luckystack/core';
import { handleHttpApiRequest } from '@luckystack/api';
import { handleHttpSyncRequest, type HttpSyncStreamEvent } from '@luckystack/sync';
import {
  createOAuthState,
  deleteSession,
  getSession,
  loginCallback,
  loginWithCredentials,
  oauthProviders,
} from '@luckystack/login';
import { initSseResponse, sendSseEvent, shouldUseHttpStream } from './sse';
import { sanitizeForLog } from './logSanitize';
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

const buildSessionCookieOptions = (sessionExpiryDays: number, secure: boolean): string =>
  `HttpOnly; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24 * sessionExpiryDays}; ${secure ? 'Secure;' : ''}`;

const setSecurityHeaders = (req: IncomingMessage, res: ServerResponse, origin: string) => {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Based-Token');
  res.setHeader('Access-Control-Expose-Headers', 'X-Session-Token');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('X-Content-Type-Options', 'nosniff');
};

export const handleHttpRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
  options: CreateLuckyStackServerOptions
): Promise<void> => {
  const config = getProjectConfig();
  const shouldLogDev = config.logging.devLogs;
  const sessionCookieName = serverRuntimeConfig.http.sessionCookieName;
  const sessionCookieOptions = buildSessionCookieOptions(
    config.session.expiryDays,
    process.env.SECURE === 'true'
  );

  const origin = req.headers.origin ?? req.headers.referer ?? req.headers.host ?? '';

  if (!allowedOrigin(origin)) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Forbidden');
    return;
  }

  setSecurityHeaders(req, res, origin);

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

  // ── /_health (router boot handshake) ─────────────────────────────────────
  if (routePath === '/_health') {
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
  if (routePath === '/_test/reset') {
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
    await clearAllRateLimits();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'success', cleared: ['rateLimits'] }));
    return;
  }

  // ── parse params (early, so logs and downstream handlers can use them) ──
  let params: object | null;
  params = await getParams({ method, req, res, queryString });

  if (res.writableEnded) return;

  if (params && typeof params === 'object' && Object.keys(params).length > 0) {
    if (shouldLogDev) {
      console.log(`method: ${method}, url: ${routePath}, params:`, sanitizeForLog(params));
    }
  } else {
    if (shouldLogDev) {
      console.log(`method: ${method}, url: ${routePath}`);
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
    const provider = oauthProviders.find((p) => p.name === providerName);
    if (!provider?.name) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: false, reason: 'login.providerNotFound' }));
      return;
    }

    if (provider.name !== 'credentials' && 'scope' in provider) {
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

      if (shouldLogDev) console.log('setting cookie with new token');

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
    const newToken = await loginCallback(routePath, req, res);

    if (!newToken) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Login failed');
      return;
    }

    if (token) await deleteSession(token);

    if (shouldLogDev) console.log('setting cookie or redirect with new token');

    const baseLocation = process.env.DNS ?? '/';
    if (config.session.basedToken) {
      res.writeHead(302, { Location: `${baseLocation}?token=${newToken}` });
    } else {
      res.setHeader('Set-Cookie', `${sessionCookieName}=${newToken}; ${sessionCookieOptions}`);
      res.writeHead(302, { Location: baseLocation });
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
      if (shouldLogDev) console.log('HTTP API error:', error);

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
      if (shouldLogDev) console.log('HTTP SYNC error:', error);

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
  if (options.customRoutes) {
    const handled = await options.customRoutes(req, res, {
      routePath,
      method,
      queryString,
      token,
    });
    if (handled || res.writableEnded) return;
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
