import type { AuthProps, BaseSessionLayout as SessionLayout, ErrorFormatter, HttpMethod } from '@luckystack/core';

//? Shared transport-agnostic types for the API request handlers. Both the
//? socket adapter (handleApiRequest) and the HTTP adapter (handleHttpApiRequest)
//? import these so the response/stream/route contracts can't drift between
//? transports. Extracted per CC-6 / the `api` package audit table.

/** Loosely-typed stream payload emitted by streaming endpoints. */
export type ApiStreamPayload = Record<string, unknown>;

export interface RuntimeSuccessResponse {
  status: 'success';
  message?: string;
  httpStatus?: number;
  [key: string]: unknown;
}

export interface RuntimeErrorResponse {
  status: 'error';
  errorCode?: string;
  errorParams?: { key: string; value: string | number | boolean }[];
  httpStatus?: number;
  message?: string;
  [key: string]: unknown;
}

/** Discriminated union returned by a registered API handler's `main`. */
export type RuntimeApiResponse = RuntimeSuccessResponse | RuntimeErrorResponse;

/** Narrowing guard for an object that is already a `RuntimeApiResponse`. */
export const isRuntimeApiResponse = (value: unknown): value is RuntimeApiResponse => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const status = (value as { status?: unknown }).status;
  return status === 'success' || status === 'error';
};

//? B2 — backpressure helper shape. Same opt-in pattern as sync; resolves once
//? the originator socket's pending write buffer drops below the threshold.
//? SSE has no socket write-buffer, so the HTTP transport supplies a no-op of
//? this same shape so handlers don't branch by transport.
export interface ApiFlushPressureOptions {
  thresholdBytes?: number;
}
export type ApiFlushPressure = (options?: ApiFlushPressureOptions) => Promise<void>;

/** Shape every registered API route exposes on the runtime map. */
export interface RuntimeApiEntry {
  auth: AuthProps;
  main: (params: {
    data: Record<string, unknown>;
    user: SessionLayout | null;
    functions: Record<string, unknown>;
    stream: (payload?: ApiStreamPayload) => void;
    //? B1 — aborts on `apiCancel` or socket/HTTP disconnect.
    abortSignal: AbortSignal;
    //? B2 — backpressure helper bound to the originator transport.
    flushPressure: ApiFlushPressure;
  }) => Promise<RuntimeApiResponse> | RuntimeApiResponse;
  inputType?: string;
  inputTypeFilePath?: string;
  rateLimit?: number | false;
  httpMethod?: HttpMethod;
  /**
   * Per-route validation strictness.
   * `'strict'` (default): runtime Zod validation runs, mismatched payloads
   *   are rejected with `api.invalidInputType`.
   * `'relaxed'` / `{ input: 'skip' }`: skip the validate step. Use for public
   *   webhooks that receive third-party-shaped payloads you can't model in TS,
   *   or for migration windows when input shapes are in flux.
   */
  validation?: 'strict' | 'relaxed' | { input: 'skip' | 'strict' };
  /**
   * Per-route error response formatter. Receives the normalized error
   * envelope + context and returns the shape to emit. Falls back to the
   * global formatter from `registerErrorFormatter(...)`, then to the
   * framework default `normalizeErrorResponse`.
   */
  errorFormatter?: ErrorFormatter;
}

/** Mutable envelope shape passed between respond-phase hooks + the formatter. */
export interface ApiResponseEnvelope { status: 'success' | 'error'; httpStatus?: number; [key: string]: unknown }
