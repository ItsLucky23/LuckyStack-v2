import { httpFetch } from './csrf';
import { buildRoutedGetUrl } from './routedDataQuery';
import tryCatch from './tryCatchClient';
import tryCatchSync from './tryCatchSync';
import type { HttpMethodLiteral } from './apiMethodMapRegistry';

export type RoutedInvocationMethod = HttpMethodLiteral;

export interface RoutedInvocationResponse<TResponse> {
  kind: 'response';
  response: TResponse;
  httpStatus: number;
}

export interface RoutedInvocationFailure {
  kind: 'aborted' | 'timeout' | 'network-error' | 'invalid-response';
}

export type RoutedInvocationResult<TResponse> =
  | RoutedInvocationResponse<TResponse>
  | RoutedInvocationFailure;

export interface RoutedHttpInvocationInput<TStream> {
  path: string;
  method: RoutedInvocationMethod;
  data: Record<string, unknown>;
  stream?: (payload: TStream) => void;
  signals?: readonly (AbortSignal | null | undefined)[];
  timeoutMs?: number | false;
}

interface ParsedSseEvent {
  event: string;
  data: unknown;
}

const parseJson = (value: string): unknown => {
  const [error, parsed] = tryCatchSync(() => JSON.parse(value) as unknown);
  return error ? undefined : parsed;
};

const parseSseFrame = (frame: string): ParsedSseEvent | null => {
  let event = 'message';
  const dataLines: string[] = [];
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0 || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice(6).trimStart();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  return { event, data: parseJson(dataLines.join('\n')) };
};

const parseSseResponse = async <TResponse>(
  response: Response,
  onStream: ((payload: never) => void) | undefined,
): Promise<TResponse | null> => {
  const reader = response.body?.getReader();
  if (!reader) return null;

  const decoder = new TextDecoder();
  let buffer = '';
  let finalResponse: TResponse | null = null;

  const consumeFrames = (flush: boolean): void => {
    buffer = buffer.replaceAll('\r\n', '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseSseFrame(frame);
      if (parsed?.event === 'stream' && parsed.data !== undefined) {
        onStream?.(parsed.data as never);
      } else if ((parsed?.event === 'final' || parsed?.event === 'error') && parsed.data !== undefined) {
        finalResponse = parsed.data as TResponse;
      }
      boundary = buffer.indexOf('\n\n');
    }

    if (flush && buffer.trim().length > 0) {
      const parsed = parseSseFrame(buffer);
      if (parsed?.event === 'stream' && parsed.data !== undefined) {
        onStream?.(parsed.data as never);
      } else if ((parsed?.event === 'final' || parsed?.event === 'error') && parsed.data !== undefined) {
        finalResponse = parsed.data as TResponse;
      }
      buffer = '';
    }
  };

  let readDone = false;
  while (!readDone) {
    const { done, value } = await reader.read();
    readDone = done;
    if (!done) {
      buffer += decoder.decode(value, { stream: true });
      consumeFrames(false);
    }
  }
  buffer += decoder.decode();
  consumeFrames(true);
  return finalResponse;
};

const buildRequest = ({
  path,
  method,
  data,
  stream,
  signal,
}: {
  path: string;
  method: RoutedInvocationMethod;
  data: Record<string, unknown>;
  stream: boolean;
  signal: AbortSignal;
}): { url: string; init: RequestInit } => {
  const headers = new Headers();
  if (stream) headers.set('Accept', 'text/event-stream');

  //? @adr 0062 — a GET keeps its declared method, so its payload can only ride
  //? the query string: it lands in access/proxy logs, history and `Referer`.
  //? Sensitive data belongs on a route that declares POST (ARCHITECTURE_HTTP.md).
  if (method === 'GET') {
    return {
      url: buildRoutedGetUrl(path, data, stream ? { stream: 'true' } : undefined),
      init: { method, headers, signal },
    };
  }

  headers.set('Content-Type', 'application/json');
  return {
    url: stream ? `${path}${path.includes('?') ? '&' : '?'}stream=true` : path,
    init: {
      method,
      headers,
      signal,
      body: JSON.stringify(data),
    },
  };
};

export const invokeRoutedHttp = async <TResponse, TStream = Record<string, unknown>>({
  path,
  method,
  data,
  stream,
  signals = [],
  timeoutMs,
}: RoutedHttpInvocationInput<TStream>): Promise<RoutedInvocationResult<TResponse>> => {
  if (signals.some((signal) => signal?.aborted)) return { kind: 'aborted' };

  const controller = new AbortController();
  const timeoutReason = Symbol('routed-invocation-timeout');
  const didTimeout = (): boolean => controller.signal.reason === timeoutReason;
  const abortFromCaller = (): void => {
    controller.abort();
  };
  for (const signal of signals) signal?.addEventListener('abort', abortFromCaller, { once: true });

  const timeout = typeof timeoutMs === 'number' && timeoutMs > 0
    ? setTimeout(() => {
        controller.abort(timeoutReason);
      }, timeoutMs)
    : null;

  const cleanup = (): void => {
    if (timeout) clearTimeout(timeout);
    for (const signal of signals) signal?.removeEventListener('abort', abortFromCaller);
  };

  const request = buildRequest({
    path,
    method,
    data,
    stream: typeof stream === 'function',
    signal: controller.signal,
  });
  const [fetchError, response] = await tryCatch(() => httpFetch(request.url, request.init));
  if (fetchError || !response) {
    cleanup();
    if (didTimeout()) return { kind: 'timeout' };
    if (controller.signal.aborted) return { kind: 'aborted' };
    return { kind: 'network-error' };
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const [parseError, parsed] = await tryCatch(async () => {
    if (contentType.includes('text/event-stream')) {
      return parseSseResponse<TResponse>(response, stream);
    }
    return (await response.json()) as TResponse;
  });
  cleanup();

  if (parseError || parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    if (didTimeout()) return { kind: 'timeout' };
    if (controller.signal.aborted) return { kind: 'aborted' };
    return { kind: 'invalid-response' };
  }

  return { kind: 'response', response: parsed, httpStatus: response.status };
};
