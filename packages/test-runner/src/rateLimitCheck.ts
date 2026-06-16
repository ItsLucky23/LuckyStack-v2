import { tryCatch } from '@luckystack/core';
import type { ContractCheckResult, EndpointDescriptor } from './types';

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const EXPECTED_ERROR_CODE = 'api.rateLimitExceeded';

export interface RateLimitCheckInput {
  endpoint: EndpointDescriptor;
  baseUrl: string;
  rateLimit: number;
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
  headers?: Record<string, string>;
  /** Per-call request timeout in ms. Defaults to 10000. */
  requestTimeoutMs?: number;
}

//? Rate-limit layer: fire `rateLimit + 1` requests back to back and assert the
//? last one is rejected with `api.rateLimitExceeded`. All preceding requests
//? are allowed to return either success or any other envelope — only the N+1
//? matters for this layer.
//?
//? This layer mutates server-side state (limiter counters). Run it after the
//? contract + auth layers, or against a dedicated test instance. The server's
//? clearAllRateLimits() utility can reset state between runs.
export const runRateLimitCheck = async (input: RateLimitCheckInput): Promise<ContractCheckResult> => {
  const { endpoint, baseUrl, rateLimit } = input;
  const url = `${baseUrl.replace(/\/$/, '')}/${endpoint.fullPath}`;
  const body = input.inputFor ? input.inputFor(endpoint) : {};
  const started = Date.now();
  const requestTimeoutMs = input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  const send = async (): Promise<Response | null> => {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => { controller.abort(); }, requestTimeoutMs);
    const [error, response] = await tryCatch(() => fetch(url, {
      method: endpoint.method,
      headers: {
        'Content-Type': 'application/json',
        'Origin': new URL(baseUrl).origin,
        ...input.headers,
      },
      body: endpoint.method === 'GET' ? undefined : JSON.stringify(body),
      signal: controller.signal,
    }));
    clearTimeout(timeoutHandle);
    if (error || !response) return null;
    return response;
  };

  //? Fire `rateLimit` allowed requests first (drain the bucket), then a final
  //? request that should be blocked. Serial so the server sees a clean order.
  //? Cancel each drain response body — we only care about the final probe's
  //? envelope, but an unconsumed undici body holds its socket out of the pool
  //? until GC, risking pool exhaustion / skewed timings on a large sweep.
  for (let i = 0; i < rateLimit; i += 1) {
    const drained = await send();
    if (drained) await tryCatch(() => drained.body?.cancel() ?? Promise.resolve());
  }

  const final = await send();
  const durationMs = Date.now() - started;

  if (!final) {
    return {
      endpoint,
      status: 'fail',
      reason: 'Final rate-limit probe request failed to return a response',
      durationMs,
    };
  }

  const [, parsed] = await tryCatch<{ status?: 'success' | 'error'; errorCode?: string } | null, undefined>(
    async () => await final.json() as { status?: 'success' | 'error'; errorCode?: string },
  );

  if (parsed?.status === 'error' && parsed.errorCode === EXPECTED_ERROR_CODE) {
    return {
      endpoint,
      status: 'pass',
      httpStatus: final.status,
      responseStatus: 'error',
      errorCode: parsed.errorCode,
      durationMs,
    };
  }

  return {
    endpoint,
    status: 'fail',
    httpStatus: final.status,
    responseStatus: parsed?.status ?? 'unknown',
    errorCode: parsed?.errorCode,
    reason: `expected '${EXPECTED_ERROR_CODE}' on request ${rateLimit + 1} but got ${parsed?.status ?? 'none'}/${parsed?.errorCode ?? '(none)'}`,
    durationMs,
  };
};
