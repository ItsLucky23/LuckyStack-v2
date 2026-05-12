import {
  captureException,
  dispatchHook,
  extractTokenFromRequest,
  getLogger,
  tryCatch,
} from '@luckystack/core';
import { handleHttpApiRequest } from '@luckystack/api';
import { initSseResponse, sendSseEvent, shouldUseHttpStream } from '../sse';
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
  if (useHttpStream) {
    initSseResponse(res);
    req.on('close', () => {
      streamClosed = true;
    });
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
      method,
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
