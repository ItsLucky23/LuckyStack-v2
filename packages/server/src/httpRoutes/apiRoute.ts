import {
  captureException,
  dispatchHook,
  extractTokenFromRequest,
  getLogger,
  tryCatch,
} from '@luckystack/core';
import { handleHttpApiRequest } from '@luckystack/api';
import { initSseResponse, sendSseEvent, shouldUseHttpStream } from '../sse';
import { resolveRequesterIp } from './resolveRequesterIp';
import type { HttpRouteHandler } from './types';

export const handleApiRoute: HttpRouteHandler = async ({
  req,
  res,
  routePath,
  queryString,
  method,
  params,
  requestId,
}) => {
  if (!routePath.startsWith('/api/')) return false;

  const useHttpStream = shouldUseHttpStream({ acceptHeader: req.headers.accept, queryString });
  let streamClosed = false;
  let sseInitialized = false;
  //? SRV-O5 — open the SSE response LAZILY (first stream chunk, or a SUCCESSFUL
  //? final), NEVER eagerly. The eager `initSseResponse` committed HTTP 200 +
  //? event-stream headers BEFORE `handleHttpApiRequest` ran its auth / rate-limit /
  //? route / method gates, so an unauthenticated or rate-limited caller hitting a
  //? streaming endpoint received 200 with the real error buried in the SSE body
  //? instead of a 401 / 403 / 404 / 429 status. Deferring the open lets a
  //? pre-execution gate failure (which never emits a stream chunk) fall through to
  //? a proper-status JSON response below; the stream is only opened once the
  //? request has actually passed the gates and is streaming or succeeding.
  const ensureSseOpen = () => {
    if (sseInitialized || res.writableEnded) return;
    initSseResponse(res);
    sseInitialized = true;
  };
  if (useHttpStream) {
    //? SRV-O1 — mirror the four-listener pattern from syncRoute: req 'error' and
    //? 'aborted' + res 'error' must all flip streamClosed so a broken client or
    //? a write error on the ServerResponse doesn't crash the worker with an
    //? unhandled 'error' event. Attached eagerly (independent of the SSE headers)
    //? so a client abort flips streamClosed even before the stream opens.
    const markClosed = () => {
      streamClosed = true;
    };
    req.on('close', markClosed);
    req.on('error', markClosed);
    req.on('aborted', markClosed);
    res.on('error', markClosed);
  }

  const [error, handled] = await tryCatch(async () => {
    const httpToken = extractTokenFromRequest(req);
    const apiName = routePath.slice(5); // strip "/api/"

    if (!apiName) {
      const response = {
        status: 'error' as const,
        httpStatus: 400,
        message: 'api.invalidName',
        errorCode: 'api.invalidName',
      };
      //? Pre-gate failure: SSE is never opened, so emit a real 400 status.
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(400);
      res.end(JSON.stringify(response));
      return true;
    }

    const apiData = typeof params === 'object'
      ? { ...(params as Record<string, unknown>) }
      : {};
    delete (apiData as Record<string, unknown>).stream;

    //? Resolve the real client IP for per-IP rate limiting (honors
    //? `http.trustProxy`; preserves the historical `undefined` fallback when
    //? there is genuinely no address). See `resolveRequesterIp`.
    const requesterIp = resolveRequesterIp(req);

    const result = await handleHttpApiRequest({
      name: apiName,
      data: apiData,
      token: httpToken,
      requesterIp,
      xLanguageHeader: req.headers['x-language'],
      acceptLanguageHeader: req.headers['accept-language'],
      method,
      stream: useHttpStream
        ? (payload) => {
            if (streamClosed || res.writableEnded) return;
            ensureSseOpen();
            sendSseEvent({ res, event: 'stream', data: payload });
          }
        : undefined,
    });

    //? Stream the final envelope only when the request actually qualifies: SSE was
    //? already opened mid-stream, OR the result is a success (open it now, even if
    //? the handler emitted zero chunks). A gate-rejection result (auth / rate-limit
    //? / not-found / method) that never opened the stream falls through to the
    //? proper-status JSON write below instead of a 200 + SSE-wrapped error.
    if (useHttpStream && (sseInitialized || result.status === 'success')) {
      ensureSseOpen();
      if (!streamClosed) sendSseEvent({ res, event: 'final', data: result });
      res.end();
      return true;
    }

    res.setHeader('Content-Type', 'application/json');
    res.writeHead(result.httpStatus);
    res.end(JSON.stringify(result));
    return true;
  }, undefined, { routePath, method, requestId, source: 'httpHandler.api' });

  if (!error) {
    return handled ?? true;
  }

  getLogger().error('http-api: top-level handler threw', error, { routePath, method, requestId });
  captureException(error, { routePath, method, requestId, source: 'httpHandler.api' });
  void dispatchHook('apiError', {
    route: routePath,
    method,
    requestId,
    error,
  });

  const errResponse = {
    status: 'error' as const,
    httpStatus: 500,
    message: 'api.invalidRequestFormat',
    errorCode: 'api.invalidRequestFormat',
  };

  //? Only route the 500 through SSE when the response was actually committed (the
  //? stream opened). `res.headersSent` is the authoritative signal here — in the
  //? streaming path only `initSseResponse` writes headers before this catch — and
  //? it sidesteps the closure-narrowing of `sseInitialized` at this scope. When
  //? headers are still unwritten (gate/parse failure before any chunk), emit a real
  //? 500 status rather than an SSE error event on a non-SSE response.
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
