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
  if (useHttpStream) {
    initSseResponse(res);
    //? Mark the SSE stream closed on EVERY terminal connection event, not just
    //? 'close': an aborted or errored client (or a write error on res) must
    //? also flip the flag so subsequent `sendSseEvent` calls become no-ops and
    //? the connection can't leak or crash the worker with an unhandled 'error'.
    const markClosed = () => {
      streamClosed = true;
    };
    req.on('close', markClosed);
    req.on('error', markClosed);
    req.on('aborted', markClosed);
    res.on('error', markClosed);
  }

  const [error, handled] = await tryCatch(async () => {
    if (method !== 'POST') {
      const response = {
        status: 'error' as const,
        message: 'sync.methodNotAllowed',
        errorCode: 'sync.methodNotAllowed',
      };
      if (useHttpStream) {
        if (!streamClosed) sendSseEvent({ res, event: 'final', data: response });
        res.end();
        return true;
      }
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
      if (useHttpStream) {
        if (!streamClosed) sendSseEvent({ res, event: 'final', data: response });
        res.end();
        return true;
      }
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(400);
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

  if (useHttpStream) {
    if (!res.writableEnded) sendSseEvent({ res, event: 'error', data: errResponse });
    res.end();
    return true;
  }

  res.setHeader('Content-Type', 'application/json');
  res.writeHead(500);
  res.end(JSON.stringify(errResponse));
  return true;
};
