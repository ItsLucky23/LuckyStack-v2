import { tryCatch } from '@luckystack/core';
import type { ContractCheckResult, EndpointDescriptor } from './types';

const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

//? Canonical error code the framework emits for unauthenticated requests
//? to `auth.login: true` endpoints. See packages/api/src/handleHttpApiRequest.ts.
const EXPECTED_ERROR_CODE = 'auth.required';

export interface AuthEnforcementCheckInput {
  endpoint: EndpointDescriptor;
  baseUrl: string;
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
  /** Per-call request timeout in ms. Defaults to 5000. */
  requestTimeoutMs?: number;
}

//? Auth-enforcement layer: for each `auth.login: true` endpoint, call it with
//? NO session headers/cookies. Expect the server to reject with `auth.required`.
//?
//? A passing endpoint here proves the login guard isn't silently bypassed.
//? Endpoints that return `success` without a session are a critical finding.
export const runAuthEnforcementCheck = async (
  input: AuthEnforcementCheckInput,
): Promise<ContractCheckResult> => {
  const { endpoint, baseUrl } = input;
  const url = `${baseUrl.replace(/\/$/, '')}/${endpoint.fullPath}`;
  const body = input.inputFor ? input.inputFor(endpoint) : {};
  const started = Date.now();
  const requestTimeoutMs = input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => { controller.abort(); }, requestTimeoutMs);

  const [fetchError, response] = await tryCatch(() => fetch(url, {
    method: endpoint.method,
    //? No session cookie, no auth header — deliberately. Origin IS sent so the
    //? server's origin policy doesn't 403 before the auth check can run.
    headers: { 'Content-Type': 'application/json', 'Origin': new URL(baseUrl).origin },
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

  if (parsed?.status === 'success') {
    return {
      endpoint,
      status: 'fail',
      httpStatus: response.status,
      responseStatus: 'success',
      reason: `auth.login endpoint returned success without a session`,
      durationMs,
    };
  }

  if (parsed?.status !== 'error') {
    return {
      endpoint,
      status: 'fail',
      httpStatus: response.status,
      responseStatus: 'unknown',
      reason: 'Response missing standard `status` envelope',
      durationMs,
    };
  }

  if (parsed.errorCode !== EXPECTED_ERROR_CODE) {
    return {
      endpoint,
      status: 'fail',
      httpStatus: response.status,
      responseStatus: 'error',
      errorCode: parsed.errorCode,
      reason: `expected errorCode '${EXPECTED_ERROR_CODE}' but got '${parsed.errorCode ?? '(missing)'}'`,
      durationMs,
    };
  }

  return {
    endpoint,
    status: 'pass',
    httpStatus: response.status,
    responseStatus: 'error',
    errorCode: parsed.errorCode,
    durationMs,
  };
};
