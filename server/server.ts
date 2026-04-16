/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
import { config as loadEnv } from 'dotenv';
import { initializeSentry } from './functions/sentry';
import path from 'node:path';

loadEnv({ path: '.env' });
loadEnv({ path: '.env.local', override: true });
initializeSentry();

import http from 'node:http';
import getParams from './utils/getParams';
import { loginWithCredentials, loginCallback, createOAuthState } from './auth/login';
import { serveFavicon, serveFile } from './prod/serveFile';
import loadSocket from './sockets/socket';
import { z } from 'zod';
import oauthProviders from "./auth/loginConfig";
import { deleteSession, getSession } from './functions/session';
import allowedOrigin from './auth/checkOrigin';
import { rateLimiting, sessionBasedToken, sessionExpiryDays, SessionLayout } from '../config';

import { serveAvatar } from './utils/serveAvatars';
import { extractTokenFromRequest } from './utils/extractTokenFromRequest';
import { handleHttpApiRequest } from './sockets/handleHttpApiRequest';
import handleHttpSyncRequest from './sockets/handleHttpSyncRequest';
import { checkRateLimit } from './utils/rateLimiter';
import { hasCookie } from './utils/cookies';
import { serverRuntimeConfig } from './config/runtimeConfig';

const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * (sessionExpiryDays ?? 7);
const SESSION_COOKIE_NAME = serverRuntimeConfig.http.sessionCookieName;
const SESSION_COOKIE_OPTIONS = `HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}; ${process.env.SECURE == 'true' ? "Secure;" : ""}`;

const REDACTED_LOG_KEYS = new Set([
  'password',
  'confirmPassword',
  'token',
  SESSION_COOKIE_NAME.toLowerCase(),
  'authorization',
  'cookie',
  'clientSecret',
  'access_token',
  'refresh_token',
]);

const sanitizeForLog = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sanitizeForLog);
  }

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      output[key] = REDACTED_LOG_KEYS.has(key) ? '[REDACTED]' : sanitizeForLog(val);
    }
    return output;
  }

  return value;
};

const parseSessionBasedTokenHeader = (headerValue: string | string[] | undefined): boolean | null => {
  if (typeof headerValue !== 'string') {
    return null;
  }

  const normalized = headerValue.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }

  return null;
};

const normalizeHeaderValue = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) {
    return value.join(',').toLowerCase();
  }

  if (typeof value === 'string') {
    return value.toLowerCase();
  }

  return '';
};

const shouldUseHttpStream = ({
  acceptHeader,
  queryString,
}: {
  acceptHeader: string | string[] | undefined;
  queryString: string | undefined;
}) => {
  const accept = normalizeHeaderValue(acceptHeader);
  if (accept.includes('text/event-stream')) {
    return true;
  }

  if (!queryString) {
    return false;
  }

  const params = new URLSearchParams(queryString);
  return params.get(serverRuntimeConfig.http.stream.queryParam) === serverRuntimeConfig.http.stream.enabledValue;
};

interface NormalizedHttpSyncParams {
  cb?: string;
  data: Record<string, unknown>;
  receiver: string;
  ignoreSelf?: boolean;
}

const normalizeHttpSyncParams = (params: object | null): NormalizedHttpSyncParams => {
  const parsed = params && typeof params === 'object'
    ? { ...(params as Record<string, unknown>) }
    : {};

  delete parsed.stream;

  const dataCandidate = parsed.data;

  return {
    cb: typeof parsed.cb === 'string' ? parsed.cb : undefined,
    data: dataCandidate && typeof dataCandidate === 'object'
      ? { ...(dataCandidate as Record<string, unknown>) }
      : {},
    receiver: typeof parsed.receiver === 'string' ? parsed.receiver : '',
    ignoreSelf: typeof parsed.ignoreSelf === 'boolean' ? parsed.ignoreSelf : undefined,
  };
};

const initSseResponse = (res: http.ServerResponse) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.writeHead(200);
  res.write(`${serverRuntimeConfig.http.stream.connectedComment}\n\n`);
};

const sendSseEvent = ({
  res,
  event,
  data,
}: {
  res: http.ServerResponse;
  event: string;
  data: unknown;
}) => {
  if (res.writableEnded) {
    return;
  }

  const serializedData = JSON.stringify(data);
  res.write(`event: ${event}\n`);
  res.write(`data: ${serializedData}\n\n`);
};

const ServerRequest = async (req: http.IncomingMessage, res: http.ServerResponse) => {

  const origin = req.headers.origin ?? req.headers.referer ?? req.headers.host ?? '';

  if (!allowedOrigin(origin)) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'text/plain');
    return res.end('Forbidden');
  }

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Session-Based-Token");
  res.setHeader("Access-Control-Expose-Headers", "X-Session-Token");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader('Referrer-Policy', 'no-referrer'); // prevents the browser from leaking sensative urls
  res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // only allows iframes to use this pages content if on the same domain
  res.setHeader('X-XSS-Protection', '1; mode=block'); // prevents some xss attacks
  res.setHeader('X-Content-Type-Options', 'nosniff'); // prevents mimetype sniffing, this means that when sending a txt file it will not try to execute it as ddl if the user requested this

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const method = req.method;
  const url = req.url || '/';
  const [routePath, queryString] = url.split('?');

  if (method !== 'GET' && method != 'POST' && method != 'PUT' && method != 'DELETE') {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain');
    return res.end(`method: ${method} not supported, use one of the following methods: GET, POST, PUT, DELETE`);
  }

  const token = extractTokenFromRequest(req);

  const hasTokenCookie = hasCookie(req.headers.cookie, SESSION_COOKIE_NAME);

  if (hasTokenCookie && token) {
    const currentSession = await getSession(token);
    if (currentSession?.id) {
      // Sliding expiration for cookie mode: keep browser token lifetime aligned with Redis TTL.
      res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=${token}; ${SESSION_COOKIE_OPTIONS}`);
    }
  }

  //? here we load the application icon
  if (z.literal('/favicon.ico').safeParse(routePath).success) {
    return serveFavicon(res);
  }

  //? here we get the params from the request
  let params: object | null;
  params = await getParams({ method, req, res, queryString });

  if (res.writableEnded) {
    return;
  }

  //? we log the request and if there are any params we log them with the request
  if (params && typeof params == 'object' && Object.keys(params).length > 0) {
    const safeParams = sanitizeForLog(params);
    console.log(`method: ${method}, url: ${routePath}, params: ${JSON.stringify(safeParams)}`, 'magenta')
  } else {
    console.log(`method: ${method}, url: ${routePath}`, 'magenta');
    params = {};
  }

  //? we dont use zod cause it doesnt allow you to pass in a id in the url
  if (routePath.startsWith('/uploads/')) {
    await serveAvatar({ routePath, res });
    return;
  }

  //? triggers when logging in
  //? when using the credentials provider all the logic happends here else we redirect to the oauth provider and all the logic happends in the auth/callback api
  if (z.string().startsWith('/auth/api').safeParse(routePath).success) {
    const providerName = routePath.split('/')[3]; // Extract the provider (google/github)
    const provider = oauthProviders.find(p => p.name === providerName);
    if (!provider?.name) { return { provider, status: false, reason: 'login.providerNotFound' }; }

    if (provider?.name != 'credentials' && 'scope' in provider) {
      const oauthState = await createOAuthState(provider.name);
      if (!oauthState) {
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({
          status: false,
          reason: 'login.oauthStateInitFailed',
        }));
      }

      const clientId = encodeURIComponent(provider.clientID);
      const callbackUrl = encodeURIComponent(provider.callbackURL);
      const scope = encodeURIComponent(provider.scope.join(' '));
      const state = encodeURIComponent(oauthState);

      res.writeHead(302, {
        'Location': `${provider.authorizationURL}?client_id=${clientId}&redirect_uri=${callbackUrl}&scope=${scope}&response_type=code&prompt=select_account&state=${state}`,
      });
      return res.end();
    }

    if (rateLimiting.defaultApiLimit !== false && rateLimiting.defaultApiLimit > 0) {
      const requesterIp = req.socket.remoteAddress ?? 'unknown';
      const { allowed, resetIn } = await checkRateLimit({
        key: `ip:${requesterIp}:auth:credentials`,
        limit: rateLimiting.defaultApiLimit,
        windowMs: rateLimiting.windowMs,
      });

      if (!allowed) {
        res.setHeader('content-type', 'application/json; charset=utf-8');
        return res.end(JSON.stringify({
          status: false,
          reason: 'api.rateLimitExceeded',
          errorParams: [{ key: 'seconds', value: resetIn }],
        }));
      }
    }

    //? here all the logic happends for login or creating an account with credentials
    const { status, reason, newToken, session } = await loginWithCredentials(params) as {
      status: boolean,
      reason: string,
      newToken: string | null,
      session: SessionLayout | undefined
    }

    //? if it failed to either login or creating an account then we return
    if (!status) {
      const reasonKey = typeof reason === 'string' && reason.length > 0
        ? reason
        : 'api.internalServerError';
      res.setHeader("content-type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ status, reason: reasonKey }));
    }

    //? if it was successful then we apply the cookie and return the user id and reason for the login or account creation
    if (newToken) {
      if (token) { await deleteSession(token); }

      const requestedSessionMode = parseSessionBasedTokenHeader(req.headers['x-session-based-token']);
      const useSessionBasedToken = requestedSessionMode ?? sessionBasedToken;

      if (process.env.NODE_ENV === 'development') {
        console.log('setting cookie with new token', 'green');
      }

      if (!useSessionBasedToken) {
        res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=${newToken}; ${SESSION_COOKIE_OPTIONS}`);
      }

      if (useSessionBasedToken) {
        res.setHeader("X-Session-Token", newToken);
      }
      // return res.end(JSON.stringify({ status, reason, session })) 
      // } else { 
    }
    return res.end(JSON.stringify({ status, reason, session, authenticated: Boolean(newToken) }))

  } else if (z.string().startsWith('/auth/callback').safeParse(routePath).success) {
    //? this endpoint is triggerd by the oauth provider after the user has logged in
    const newToken = await loginCallback(routePath, req, res);

    //? if it failed to either login or creating an account then we return
    if (!newToken) {
      res.writeHead(401, { "Content-Type": "text/plain" });
      return res.end('Login failed');
    }

    //? we successfully logged in or created an acocunt

    //? if the user already had a token then we delete the previous session data
    if (token) { await deleteSession(token); }

    //? we set the cookie with the new token and redirect the user to the frontend
    if (process.env.NODE_ENV === 'development') {
      console.log('setting cookie or redirect with new token', 'green');
    }
    const location = process.env.DNS

    if (sessionBasedToken) {
      res.writeHead(302, {
        Location: `${process.env.DNS}?token=${newToken}`,
      });
    } else {
      res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=${newToken}; ${SESSION_COOKIE_OPTIONS}`);
      res.writeHead(302, { Location: location }); // Redirect without exposing token in URL
    }
    return res.end();

    //? HTTP API route - allows calling APIs via HTTP instead of WebSocket
    //? Supports: GET/POST/PUT/DELETE /api/{name}
  } else if (routePath.startsWith('/api/')) {
    let useHttpStream = false;
    let streamClosed = false;
    try {
      const httpToken = extractTokenFromRequest(req);
      useHttpStream = shouldUseHttpStream({
        acceptHeader: req.headers.accept,
        queryString,
      });

      if (useHttpStream) {
        initSseResponse(res);
        req.on('close', () => {
          streamClosed = true;
        });
      }

      // Extract API name from path: /api/examples/getUserData → examples/getUserData
      const apiName = routePath.slice(5); // Remove "/api/" prefix (5 chars)

      if (!apiName) {
        const response = {
          status: 'error',
          httpStatus: 400,
          message: 'api.invalidName',
          errorCode: 'api.invalidName',
        };

        if (useHttpStream) {
          if (!streamClosed) {
            sendSseEvent({ res, event: 'final', data: response });
          }
          return res.end();
        }

        res.setHeader('Content-Type', 'application/json');
        res.writeHead(400);
        return res.end(JSON.stringify(response));
      }

      // Use getParams to parse request data (handles GET query params, POST/PUT/DELETE body)
      const apiData = params && typeof params === 'object'
        ? { ...(params as Record<string, unknown>) }
        : {};
      delete apiData.stream;

      const result = await handleHttpApiRequest({
        name: apiName,
        data: apiData,
        token: httpToken,
        requesterIp: req.socket.remoteAddress ?? undefined,
        xLanguageHeader: req.headers['x-language'],
        acceptLanguageHeader: req.headers['accept-language'],
        method: (method) || 'POST',
        stream: useHttpStream
          ? (payload) => {
            if (streamClosed || res.writableEnded) {
              return;
            }

            sendSseEvent({ res, event: 'stream', data: payload });
          }
          : undefined,
      });

      if (useHttpStream) {
        if (!streamClosed) {
          sendSseEvent({ res, event: 'final', data: result });
        }
        return res.end();
      }

      res.setHeader('Content-Type', 'application/json');
      res.writeHead(result.httpStatus);
      return res.end(JSON.stringify(result));
    } catch (error) {
      console.log('HTTP API error:', error, 'red');

      if (useHttpStream) {
        if (!res.writableEnded) {
          sendSseEvent({
            res,
            event: 'error',
            data: {
              status: 'error',
              httpStatus: 500,
              message: 'api.invalidRequestFormat',
              errorCode: 'api.invalidRequestFormat',
            },
          });
        }
        return res.end();
      }

      res.setHeader('Content-Type', 'application/json');
      res.writeHead(500);
      return res.end(JSON.stringify({
        status: 'error',
        httpStatus: 500,
        message: 'api.invalidRequestFormat',
        errorCode: 'api.invalidRequestFormat',
      }));
    }

  } else if (routePath.startsWith('/sync/')) {
    let useHttpStream = false;
    let streamClosed = false;
    try {
      useHttpStream = shouldUseHttpStream({
        acceptHeader: req.headers.accept,
        queryString,
      });

      if (useHttpStream) {
        initSseResponse(res);
        req.on('close', () => {
          streamClosed = true;
        });
      }

      if (method !== 'POST') {
        const response = {
          status: 'error',
          message: 'sync.methodNotAllowed',
          errorCode: 'sync.methodNotAllowed',
        };

        if (useHttpStream) {
          if (!streamClosed) {
            sendSseEvent({ res, event: 'final', data: response });
          }
          return res.end();
        }

        res.setHeader('Content-Type', 'application/json');
        res.writeHead(405);
        return res.end(JSON.stringify(response));
      }

      const httpToken = extractTokenFromRequest(req);
      const syncName = routePath.slice(6);

      if (!syncName) {
        const response = {
          status: 'error',
          message: 'sync.invalidName',
          errorCode: 'sync.invalidName',
        };

        if (useHttpStream) {
          if (!streamClosed) {
            sendSseEvent({ res, event: 'final', data: response });
          }
          return res.end();
        }

        res.setHeader('Content-Type', 'application/json');
        res.writeHead(400);
        return res.end(JSON.stringify(response));
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
          ? (payload) => {
            if (streamClosed || res.writableEnded) {
              return;
            }

            sendSseEvent({ res, event: 'stream', data: payload });
          }
          : undefined,
      });

      if (useHttpStream) {
        if (!streamClosed) {
          sendSseEvent({ res, event: 'final', data: result });
        }
        return res.end();
      }

      res.setHeader('Content-Type', 'application/json');
      res.writeHead(result.status === 'success' ? 200 : 400);
      return res.end(JSON.stringify(result));
    } catch (error) {
      console.log('HTTP SYNC error:', error, 'red');

      if (useHttpStream) {
        if (!res.writableEnded) {
          sendSseEvent({
            res,
            event: 'error',
            data: {
              status: 'error',
              message: 'sync.invalidRequestFormat',
              errorCode: 'sync.invalidRequestFormat',
            },
          });
        }
        return res.end();
      }

      res.setHeader('Content-Type', 'application/json');
      res.writeHead(500);
      return res.end(JSON.stringify({
        status: 'error',
        message: 'sync.invalidRequestFormat',
        errorCode: 'sync.invalidRequestFormat',
      }));
    }

  } else if (routePath.includes("/assets/")) {
    const assetPath = routePath.slice(routePath.indexOf("/assets/"));
    req.url = assetPath;
    return serveFile(req, res);

  } else if (z.string()
    .regex(/^\/(assets\/[a-zA-Z0-9_\-/]+|[a-zA-Z0-9_\-]+)\.(png|jpg|jpeg|gif|svg|html|css|js)$/)
    .safeParse(routePath).success) {
    //? if the request is a file with one of the following extensions then we serve it
    //? png|jpg|jpeg|gif|svg|html|css|js
    return serveFile(req, res);

  } else if (path.extname(routePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not Found");

  } else { // for the index.html
    //? if the request doesnt fit any of the above then we serve the index.html file
    return serveFile({ url: '/' }, res);
  }
}

const ip: string = process.env.SERVER_IP || '127.0.0.1';
const port: string = process.env.SERVER_PORT || '80';

(async () => {
  const isDevMode = process.env.NODE_ENV !== 'production';
  if (isDevMode) {
    const { initConsolelog } = await import('./utils/console.log');
    initConsolelog();
    const { initializeAll } = await import('./dev/loader');
    await initializeAll();
    const { setupWatchers } = await import('./dev/hotReload');
    setupWatchers();
    const { initRepl } = await import('./utils/repl');
    initRepl();
  }

  const httpServer = http.createServer(async (req, res) => { ServerRequest(req, res) });
  loadSocket(httpServer);
  // @ts-ignore // typescript thinks ip needs to be a number
  httpServer.listen(port, ip, () => {
    console.log(`Server is running on http://${ip}:${port}/`, 'green');
  });


})()