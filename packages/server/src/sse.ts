import type { ServerResponse } from 'node:http';
import { getProjectConfig } from '@luckystack/core';

//? Server-Sent Events (SSE) helpers shared by /api/* and /sync/* HTTP
//? streaming. Only used when the client opted in via Accept: text/event-stream
//? or the configured ?<queryParam>=<enabledValue>.

const isExpectingEventStream = (acceptHeader: string | string[] | undefined): boolean => {
  if (!acceptHeader) return false;
  const value = Array.isArray(acceptHeader) ? acceptHeader.join(',') : acceptHeader;
  return value.toLowerCase().includes('text/event-stream');
};

const queryRequestsStream = (queryString: string | undefined): boolean => {
  if (!queryString) return false;
  const { queryParam, enabledValue } = getProjectConfig().http.stream;
  const params = new URLSearchParams(queryString);
  const value = params.get(queryParam);
  return value === enabledValue || value === '1';
};

export const shouldUseHttpStream = ({
  acceptHeader,
  queryString,
}: {
  acceptHeader: string | string[] | undefined;
  queryString: string | undefined;
}): boolean => isExpectingEventStream(acceptHeader) || queryRequestsStream(queryString);

export const initSseResponse = (res: ServerResponse): void => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const connectedComment = getProjectConfig().http.stream.connectedComment;
  if (connectedComment) {
    res.write(`${connectedComment}\n\n`);
  }
};

export const sendSseEvent = ({
  res,
  event,
  data,
}: {
  res: ServerResponse;
  event: string;
  data: unknown;
}): void => {
  if (res.writableEnded) return;
  //? Defense-in-depth: only write SSE frames to a response that was actually
  //? opened as an event-stream via `initSseResponse`. Every framework caller
  //? does init first, so this changes no real path — it just prevents a future
  //? caller from emitting `event:`/`data:` lines onto a non-SSE response (which
  //? would corrupt the body the client expected).
  const contentType = res.getHeader('Content-Type');
  if (typeof contentType !== 'string' || !contentType.includes('text/event-stream')) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};
