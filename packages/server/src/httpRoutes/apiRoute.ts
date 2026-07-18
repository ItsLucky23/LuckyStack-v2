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
import { getDevToolsInitError } from '../devToolsStatus';
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
  //? SRV-O6 — wire the handler's abortSignal to client disconnect. The api
  //? pipeline accepts an `abortSignal` and races `main()` against it, but the HTTP
  //? route never supplied one, so a slow handler kept running after the caller went
  //? away (wasted DB/CPU work, no cancellation). Abort on any terminal connection
  //? event, for BOTH streaming and non-streaming requests.
  const abortController = new AbortController();
  //? Mirror the four-listener pattern: req 'error' + 'aborted' + 'close' and res
  //? 'error' all (1) flip streamClosed so subsequent SSE writes become no-ops and
  //? a broken socket can't crash the worker with an unhandled 'error', and (2)
  //? abort the in-flight handler. Harmless once the request has already completed.
  const markClosed = () => {
    streamClosed = true;
    if (!abortController.signal.aborted) abortController.abort();
  };
  req.on('close', markClosed);
  req.on('error', markClosed);
  req.on('aborted', markClosed);
  res.on('error', markClosed);

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

    //? Dev-tools init failed at boot -> `devApis` is EMPTY, so this route (and
    //? every other) would 404 with no explanation. Answer with the REAL reason:
    //? a 503 naming the underlying cause, instead of a misleading "route not
    //? found". Null in prod + healthy dev, so normal 404s are unaffected. SSE is
    //? never opened before this point, so a plain JSON status is correct.
    const devToolsError = getDevToolsInitError();
    if (devToolsError) {
      const response = {
        status: 'error' as const,
        httpStatus: 503,
        message: 'api.devToolsUnavailable',
        errorCode: 'api.devToolsUnavailable',
        detail: `Dev tooling failed to initialize, so NO API routes are loaded. Fix the cause and RESTART the dev server (hot reload is off). Cause: ${devToolsError.message}`,
      };
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(503);
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
      abortSignal: abortController.signal,
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
