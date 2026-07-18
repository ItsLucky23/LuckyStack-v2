import {
  captureException,
  dispatchHook,
  extractTokenFromRequest,
  getLogger,
  tryCatch,
} from '@luckystack/core';
import type { HttpSyncStreamEvent } from '@luckystack/sync';
import { capabilities, getSync } from '../capabilities';
import { initSseResponse, sendSseEvent, shouldUseHttpStream } from '../sse';
import { resolveRequesterIp } from './resolveRequesterIp';
import { getDevToolsInitError } from '../devToolsStatus';
import type { HttpRouteHandler } from './types';

interface NormalizedHttpSyncParams {
  data: Record<string, unknown>;
  receiver: string;
  ignoreSelf?: boolean;
  cb?: string;
}

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

export const handleSyncRoute: HttpRouteHandler = async ({
  req,
  res,
  routePath,
  queryString,
  method,
  params,
  requestId,
}) => {
  if (!routePath.startsWith('/sync/')) return false;

  //? @luckystack/sync is optional. Absent => no real-time fanout; report the
  //? disabled contract so a developer hitting /sync/* gets a clear signal.
  const sync = capabilities.sync ? await getSync() : null;
  if (!sync) {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(404);
    res.end(JSON.stringify({ status: 'error', errorCode: 'sync.disabled', message: 'sync.disabled' }));
    return true;
  }

  const useHttpStream = shouldUseHttpStream({ acceptHeader: req.headers.accept, queryString });
  let streamClosed = false;
  let sseInitialized = false;
  //? SRV-O5 (parity with apiRoute) — open the SSE response LAZILY (first stream
  //? chunk, or a SUCCESSFUL final), NEVER eagerly. The eager `initSseResponse`
  //? committed HTTP 200 + event-stream headers BEFORE handleHttpSyncRequest ran its
  //? method / auth / rate-limit / route / membership gates, so a rejected caller
  //? hitting a streaming sync endpoint got 200 with the real error buried in the
  //? SSE body instead of a 405 / 401 / 403 / 404 status.
  const ensureSseOpen = () => {
    if (sseInitialized || res.writableEnded) return;
    initSseResponse(res);
    sseInitialized = true;
  };
  //? SRV-O6 — wire the handler's abortSignal to client disconnect (the sync
  //? pipeline accepts an `abortSignal` and races the `_server` run against it, but
  //? the route never supplied one). Mark the SSE stream closed on EVERY terminal
  //? connection event (so subsequent `sendSseEvent` calls become no-ops and a
  //? broken socket can't crash the worker with an unhandled 'error') AND abort the
  //? in-flight handler. Attached for both streaming and non-streaming requests.
  const abortController = new AbortController();
  const markClosed = () => {
    streamClosed = true;
    if (!abortController.signal.aborted) abortController.abort();
  };
  req.on('close', markClosed);
  req.on('error', markClosed);
  req.on('aborted', markClosed);
  res.on('error', markClosed);

  const [error, handled] = await tryCatch(async () => {
    if (method !== 'POST') {
      const response = {
        status: 'error' as const,
        message: 'sync.methodNotAllowed',
        errorCode: 'sync.methodNotAllowed',
      };
      //? Pre-gate failure: SSE is never opened, so emit a real 405 status.
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(405);
      res.end(JSON.stringify(response));
      return true;
    }

    const httpToken = extractTokenFromRequest(req);
    const syncName = routePath.slice(6); // strip "/sync/"

    if (!syncName) {
      const response = {
        status: 'error' as const,
        message: 'sync.invalidName',
        errorCode: 'sync.invalidName',
      };
      //? Pre-gate failure: SSE is never opened, so emit a real 400 status.
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(400);
      res.end(JSON.stringify(response));
      return true;
    }

    //? Dev-tools init failed at boot -> `devSyncs` is EMPTY, so this route would
    //? report a misleading "route not found". Answer with the REAL reason (parity
    //? with apiRoute). Null in prod + healthy dev, so normal flows are unaffected.
    const devToolsError = getDevToolsInitError();
    if (devToolsError) {
      const response = {
        status: 'error' as const,
        message: 'sync.devToolsUnavailable',
        errorCode: 'sync.devToolsUnavailable',
        detail: `Dev tooling failed to initialize, so NO sync routes are loaded. Fix the cause and RESTART the dev server (hot reload is off). Cause: ${devToolsError.message}`,
      };
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(503);
      res.end(JSON.stringify(response));
      return true;
    }

    const syncParams = normalizeHttpSyncParams(params);

    //? Resolve the real client IP for per-IP rate limiting (honors
    //? `http.trustProxy`; preserves the historical `undefined` fallback when
    //? there is genuinely no address). See `resolveRequesterIp`.
    const requesterIp = resolveRequesterIp(req);

    const result = await sync.handleHttpSyncRequest({
      name: `sync/${syncName}`,
      cb: syncParams.cb,
      data: syncParams.data,
      receiver: syncParams.receiver,
      ignoreSelf: syncParams.ignoreSelf,
      token: httpToken,
      requesterIp,
      xLanguageHeader: req.headers['x-language'],
      acceptLanguageHeader: req.headers['accept-language'],
      abortSignal: abortController.signal,
      stream: useHttpStream
        ? (payload: HttpSyncStreamEvent) => {
            if (streamClosed || res.writableEnded) return;
            ensureSseOpen();
            sendSseEvent({ res, event: 'stream', data: payload });
          }
        : undefined,
    });

    //? Stream the final envelope only when the request actually qualifies: SSE was
    //? already opened mid-stream, OR the result is a success (open it now). A
    //? gate-rejection result that never opened the stream falls through to the
    //? proper-status JSON write below instead of a 200 + SSE-wrapped error.
    if (useHttpStream && (sseInitialized || result.status === 'success')) {
      ensureSseOpen();
      if (!streamClosed) sendSseEvent({ res, event: 'final', data: result });
      res.end();
      return true;
    }

    res.setHeader('Content-Type', 'application/json');
    res.writeHead(result.httpStatus ?? (result.status === 'success' ? 200 : 400));
    res.end(JSON.stringify(result));
    return true;
  }, undefined, { routePath, method, requestId, source: 'httpHandler.sync' });

  if (!error) {
    return handled ?? true;
  }

  getLogger().error('http-sync: top-level handler threw', error, { routePath, method, requestId });
  captureException(error, { routePath, method, requestId, source: 'httpHandler.sync' });
  void dispatchHook('syncError', {
    route: routePath,
    method,
    requestId,
    error,
  });

  const errResponse = {
    status: 'error' as const,
    message: 'sync.invalidRequestFormat',
    errorCode: 'sync.invalidRequestFormat',
  };

  //? Only route the 500 through SSE when the response was actually committed (the
  //? stream opened). `res.headersSent` is authoritative — in the streaming path
  //? only `initSseResponse` writes headers before this catch. When headers are
  //? still unwritten (gate/parse failure before any chunk), emit a real 500 status.
  if (useHttpStream && res.headersSent) {
    if (!res.writableEnded) sendSseEvent({ res, event: 'error', data: errResponse });
    res.end();
    return true;
  }

  res.setHeader('Content-Type', 'application/json');
  res.writeHead(500);
  res.end(JSON.stringify(errResponse));
  return true;
};
