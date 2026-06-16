import type { ContractCheckResult, EndpointDescriptor } from './types';
import { sendProbe } from './probeRequest';

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

  const result = await sendProbe({
    url,
    method: endpoint.method,
    baseUrl,
    body,
    headers: input.headers,
    requestTimeoutMs: input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  });

  if (!result) {
    return {
      endpoint,
      status: 'fail',
      reason: 'fetch returned no response',
      durationMs: Date.now() - started,
    };
  }

  const { httpStatus, parsed } = result;
  const durationMs = Date.now() - started;

  if (!parsed) {
    return {
      endpoint,
      status: 'fail',
      httpStatus,
      responseStatus: 'unknown',
      reason: 'JSON parse failed',
      durationMs,
    };
  }

  if (parsed.status !== 'success' && parsed.status !== 'error') {
    return {
      endpoint,
      status: 'fail',
      httpStatus,
      responseStatus: 'unknown',
      reason: 'Response missing standard `status` envelope',
      durationMs,
    };
  }

  if (parsed.status === 'error' && !parsed.errorCode) {
    return {
      endpoint,
      status: 'fail',
      httpStatus,
      responseStatus: 'error',
      reason: 'Error response missing `errorCode`',
      durationMs,
    };
  }

  //? When `inputFor` produced a non-empty sample body but the route returned an
  //? error, the probe may have failed its own Zod validation rather than proving
  //? the contract. Counting that as a PASS is misleading — the happy-path was
  //? never exercised. Classify as `skipped` so the caller knows the body was
  //? rejected before the handler ran and can supply a better sample.
  const bodyIsNonEmpty = body !== null
    && typeof body === 'object'
    && !Array.isArray(body)
    && Object.keys(body).length > 0;
  if (input.inputFor && bodyIsNonEmpty && parsed.status === 'error') {
    return {
      endpoint,
      status: 'skipped',
      httpStatus,
      responseStatus: 'error',
      errorCode: parsed.errorCode,
      reason: `inputFor produced a non-empty sample but route returned error (${parsed.errorCode ?? 'unknown'}); provide a valid sample via inputFor to test the happy path`,
      durationMs,
    };
  }

  return {
    endpoint,
    status: 'pass',
    httpStatus,
    responseStatus: parsed.status,
    errorCode: parsed.errorCode,
    durationMs,
  };
};
