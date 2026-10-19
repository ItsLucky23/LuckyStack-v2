//? Single-source probe used by every check layer (contract, auth, csrf,
//? rate-limit, fuzz). Two levels:
//?   - `sendProbe` — one timed HTTP fetch + JSON-envelope parse. Centralises the
//?     AbortController + timeout + tryCatch pattern so it isn't copied into each
//?     check file.
//?   - `ProbeTransport` — "send this payload to this endpoint". The checks only
//?     know endpoints and payloads; the transport owns the wire: URL building,
//?     the GET query-string encoding, the sync `{ data, receiver }` envelope, and
//?     (socket transport, see `socketProbeTransport.ts`) Socket.io delivery.

import { buildRoutedGetUrl, tryCatch } from '@luckystack/core';
import type { EndpointDescriptor, HttpMethod } from './types';

export interface ProbeRequestInput {
  url: string;
  method: HttpMethod;
  baseUrl: string;
  body?: unknown;
  headers?: Record<string, string>;
  requestTimeoutMs: number;
}

export interface ProbeResponse {
  /** HTTP status. Over Socket.io: the envelope's `httpStatus`, when it carries one. */
  httpStatus?: number;
  parsed: { status?: string; errorCode?: string } | null;
}

/**
 * Send a single timed fetch probe and parse the JSON envelope. Returns
 * `null` when the request itself fails (network error or abort).
 */
export const sendProbe = async (input: ProbeRequestInput): Promise<ProbeResponse | null> => {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => { controller.abort(); }, input.requestTimeoutMs);

  //? A GET cannot carry a body (fetch throws), so its payload rides the query
  //? string as the reserved `__luckystack_data` value — the same encoding the
  //? real client sends and the server reads. Dropping it instead (the old
  //? behaviour) made every GET route with a required field fail validation.
  const isGet = input.method === 'GET';
  const url = isGet && input.body !== undefined ? buildRoutedGetUrl(input.url, input.body) : input.url;

  const [fetchError, response] = await tryCatch(() => fetch(url, {
    method: input.method,
    headers: {
      'Content-Type': 'application/json',
      //? Browsers attach Origin on state-changing requests; the server's origin
      //? policy fail-closes POST/PUT/DELETE without one.
      'Origin': new URL(input.baseUrl).origin,
      ...input.headers,
    },
    body: isGet ? undefined : JSON.stringify(input.body),
    signal: controller.signal,
  }));
  clearTimeout(timeoutHandle);

  if (fetchError || !response) return null;

  const [, parsed] = await tryCatch<{ status?: string; errorCode?: string } | null, undefined>(
    async () => await response.json() as { status?: string; errorCode?: string },
  );

  return { httpStatus: response.status, parsed: parsed ?? null };
};

export interface ProbeTransportRequest {
  endpoint: EndpointDescriptor;
  baseUrl: string;
  /** The route payload — the API `data`, or the sync `data` (the transport adds the sync envelope). */
  body: unknown;
  /** HTTP headers (session Cookie or Bearer, CSRF). A socket transport reads only the session. */
  headers?: Record<string, string>;
  requestTimeoutMs: number;
}

export interface ProbeTransport {
  readonly name: 'http' | 'socket';
  /** Resolve with the parsed reply, or `null` when no reply arrived (network error / timeout). */
  send: (request: ProbeTransportRequest) => Promise<ProbeResponse | null>;
  /** Release held connections. Optional — the HTTP transport holds none. */
  close?: () => Promise<void>;
}

export interface HttpProbeTransportOptions {
  /**
   * Room sent as `receiver` on sync probes. Without one the server answers
   * `sync.missingReceiver`, which proves the envelope but not the route.
   */
  syncReceiver?: string;
}

//? HTTP transport: API routes go to `/api/...` with the payload as the body (or
//? query string for GET); sync routes go to `/sync/...` wrapped in the same
//? `{ data, receiver }` envelope the routed-HTTP client sends.
export const createHttpProbeTransport = (options: HttpProbeTransportOptions = {}): ProbeTransport => ({
  name: 'http',
  send: (request) => sendProbe({
    url: `${request.baseUrl.replace(/\/$/, '')}/${request.endpoint.fullPath}`,
    method: request.endpoint.method,
    baseUrl: request.baseUrl,
    body: request.endpoint.kind === 'sync'
      ? { data: request.body, receiver: options.syncReceiver }
      : request.body,
    headers: request.headers,
    requestTimeoutMs: request.requestTimeoutMs,
  }),
});

/** Transport the checks use when the caller supplies none. */
export const defaultProbeTransport: ProbeTransport = createHttpProbeTransport();
