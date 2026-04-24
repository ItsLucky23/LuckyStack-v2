import type { ContractCheckResult, EndpointDescriptor } from './types';

const REQUEST_TIMEOUT_MS = 10000;
const EXPECTED_ERROR_CODE = 'api.rateLimitExceeded';

export interface RateLimitCheckInput {
  endpoint: EndpointDescriptor;
  baseUrl: string;
  rateLimit: number;
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
  headers?: Record<string, string>;
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

  const send = async (): Promise<Response | null> => {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        method: endpoint.method,
        headers: {
          'Content-Type': 'application/json',
          ...input.headers,
        },
        body: endpoint.method === 'GET' ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutHandle);
    }
  };

  //? Fire `rateLimit` allowed requests first (drain the bucket), then a final
  //? request that should be blocked. Serial so the server sees a clean order.
  for (let i = 0; i < rateLimit; i += 1) {
    await send();
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

  const parsed = await final.json().catch(() => null) as {
    status?: 'success' | 'error';
    errorCode?: string;
  } | null;

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
