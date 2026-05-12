import { tryCatch } from '@luckystack/core';
import type { ContractCheckResult, EndpointDescriptor } from './types';

const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

export interface ContractCheckInput {
  endpoint: EndpointDescriptor;
  baseUrl: string;
  /**
   * Optional input factory. Defaults to `{}`. When an endpoint requires a
   * specific shape to not crash, callers can override per-endpoint here.
   */
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
  /**
   * Optional headers (auth tokens, cookies). Applied to every request.
   */
  headers?: Record<string, string>;
  /**
   * Per-call request timeout in ms. Defaults to 5000. Bump for slow endpoints
   * (AI calls, large reports) where the framework default would false-fail
   * the contract check.
   */
  requestTimeoutMs?: number;
}

//? Contract layer: send any-shape input, accept any response where
//? `status` is `success` or `error` (with an `errorCode`). Anything else is
//? a contract violation — 5xx, thrown exceptions, or shapes outside this
//? envelope.
//?
//? The goal here is NOT to prove every endpoint works end-to-end; it's to
//? catch endpoints that crash the server or return garbage on well-formed
//? empty input. Real behavior tests go in the per-endpoint test file.
export const runContractCheck = async (input: ContractCheckInput): Promise<ContractCheckResult> => {
  const { endpoint, baseUrl } = input;
  const url = `${baseUrl.replace(/\/$/, '')}/${endpoint.fullPath}`;
  const body = input.inputFor ? input.inputFor(endpoint) : {};
  const started = Date.now();

  const requestTimeoutMs = input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), requestTimeoutMs);

  const [fetchError, response] = await tryCatch(() => fetch(url, {
    method: endpoint.method,
    headers: {
      'Content-Type': 'application/json',
      ...input.headers,
    },
    body: endpoint.method === 'GET' ? undefined : JSON.stringify(body),
    signal: controller.signal,
  }));
  clearTimeout(timeoutHandle);

  if (fetchError || !response) {
    return {
      endpoint,
      status: 'fail',
      reason: fetchError?.message ?? 'fetch returned no response',
      durationMs: Date.now() - started,
    };
  }

  const [parseError, parsed] = await tryCatch<{ status?: 'success' | 'error'; errorCode?: string } | null, undefined>(
    async () => await response.json() as { status?: 'success' | 'error'; errorCode?: string },
  );

  const durationMs = Date.now() - started;

  if (parseError) {
    return {
      endpoint,
      status: 'fail',
      httpStatus: response.status,
      responseStatus: 'unknown',
      reason: `JSON parse failed: ${parseError.message}`,
      durationMs,
    };
  }

  if (!parsed || (parsed.status !== 'success' && parsed.status !== 'error')) {
    return {
      endpoint,
      status: 'fail',
      httpStatus: response.status,
      responseStatus: 'unknown',
      reason: 'Response missing standard `status` envelope',
      durationMs,
    };
  }

  if (parsed.status === 'error' && !parsed.errorCode) {
    return {
      endpoint,
      status: 'fail',
      httpStatus: response.status,
      responseStatus: 'error',
      reason: 'Error response missing `errorCode`',
      durationMs,
    };
  }

  return {
    endpoint,
    status: 'pass',
    httpStatus: response.status,
    responseStatus: parsed.status,
    errorCode: parsed.errorCode,
    durationMs,
  };
};
