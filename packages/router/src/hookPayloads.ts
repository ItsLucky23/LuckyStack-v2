export interface PreProxyRequestPayload {
  /** Resolved service key the request is being routed to. */
  service: string;
  /** Original request path (before URL rewriting). */
  pathname: string;
  /** Uppercase HTTP method. */
  method: string;
  /** Upstream URL the request will be forwarded to. */
  target: string;
  /** True when the local binding was unhealthy and we routed via fallback env. */
  viaFallback: boolean;
}

/** Coarse classification of upstream failures, derived from the underlying error. */
export type PostProxyResponseErrorCause = 'network' | 'timeout' | 'upstream-throw' | 'unknown';

export interface PostProxyResponseError {
  /** Human-readable message from the underlying error. */
  message: string;
  /** Node.js error code (e.g. `ECONNREFUSED`, `ETIMEDOUT`) when available. */
  code?: string;
  /** Coarse classification so consumers can bucket failures without sniffing `code`. */
  cause?: PostProxyResponseErrorCause;
}

export interface PostProxyResponsePayload extends PreProxyRequestPayload {
  /**
   * HTTP status returned by the upstream. `0` indicates no response was received
   * (network error, timeout, or upstream threw before headers). When `0`, `error`
   * will be populated.
   */
  statusCode: number;
  /** Round-trip latency in milliseconds (proxy entry → upstream response start, or failure). */
  latencyMs: number;
  /**
   * Populated on the error path (upstream unreachable, network failure, gateway
   * timeout). Absent on the happy path. Consumers can branch on `payload.error`
   * to distinguish failure events from success events.
   */
  error?: PostProxyResponseError;
}

declare module '@luckystack/core' {
  interface HookPayloads {
    preProxyRequest: PreProxyRequestPayload;
    postProxyResponse: PostProxyResponsePayload;
  }
}
