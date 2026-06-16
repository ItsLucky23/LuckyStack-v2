import type { ContractCheckResult, EndpointDescriptor } from './types';
import { sendProbe } from './probeRequest';

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const EXPECTED_ERROR_CODE = 'api.rateLimitExceeded';

//? Error codes the server emits BEFORE the rate-limit pipeline runs (CSRF gate,
//? auth guard, schema validation). When a drain response carries one of these, the
//? bucket was never incremented — the final probe will fail for the wrong reason
//? and should be classified as `skipped` rather than a real failure.
const PRE_LIMITER_ERROR_CODES = new Set([
  'auth.required',
  'auth.csrfTokenMissing',
  'auth.csrfTokenInvalid',
  'auth.unauthorized',
  'api.csrfTokenMissing',
  'api.csrfTokenInvalid',
  'api.unauthorized',
  'api.validationError',
]);

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

  const send = () => sendProbe({
    url,
    method: endpoint.method,
    baseUrl,
    body,
    headers: input.headers,
    requestTimeoutMs,
  });

  //? Fire `rateLimit` allowed requests first (drain the bucket), then a final
  //? request that should be blocked. Serial so the server sees a clean order.
  //? Read the first drain response to detect pre-limiter rejections (CSRF/auth/
  //? validation): if the server rejects before the limiter runs, the bucket is
  //? never incremented, the final probe will fail for the wrong reason, and we
  //? classify the whole check as `skipped` rather than a false failure.
  for (let i = 0; i < rateLimit; i += 1) {
    const drained = await send();
    if (!drained) continue;
    if (i === 0) {
      //? Inspect the first drain to detect pre-limiter rejection.
      const errorCode = drained.parsed?.errorCode;
      if (errorCode && PRE_LIMITER_ERROR_CODES.has(errorCode)) {
        return {
          endpoint,
          status: 'skipped',
          durationMs: Date.now() - started,
          reason: `drain response rejected pre-limiter (${errorCode}); bucket was never incremented — check CSRF/auth headers`,
        };
      }
    }
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

  const { httpStatus, parsed } = final;

  if (parsed?.status === 'error' && parsed.errorCode === EXPECTED_ERROR_CODE) {
    return {
      endpoint,
      status: 'pass',
      httpStatus,
      responseStatus: 'error',
      errorCode: parsed.errorCode,
      durationMs,
    };
  }

  const responseStatus: ContractCheckResult['responseStatus'] =
    parsed?.status === 'success' || parsed?.status === 'error' ? parsed.status : 'unknown';
  return {
    endpoint,
    status: 'fail',
    httpStatus,
    responseStatus,
    errorCode: parsed?.errorCode,
    reason: `expected '${EXPECTED_ERROR_CODE}' on request ${rateLimit + 1} but got ${parsed?.status ?? 'none'}/${parsed?.errorCode ?? '(none)'}`,
    durationMs,
  };
};
