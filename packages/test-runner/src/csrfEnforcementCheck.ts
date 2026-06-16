import { tryCatch } from '@luckystack/core';
import type { ContractCheckResult, EndpointDescriptor } from './types';

const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

//? Canonical error code the framework's CSRF middleware emits when a
//? state-changing, cookie-authenticated request arrives without a matching
//? CSRF token. See packages/server/src/httpRoutes/csrfMiddleware.ts.
const DEFAULT_EXPECTED_ERROR_CODE = 'auth.csrfMismatch';
const DEFAULT_EXPECTED_HTTP_STATUS = 403;

export interface CsrfEnforcementCheckInput {
  endpoint: EndpointDescriptor;
  baseUrl: string;
  /**
   * A valid session Cookie header (`<name>=<token>`). The probe deliberately
   * carries it so the request passes the auth guard and reaches the CSRF check.
   */
  authCookie: string;
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
  /** Per-call request timeout in ms. Defaults to 5000. */
  requestTimeoutMs?: number;
  /** Error code expected on CSRF rejection. Defaults to `auth.csrfMismatch`. */
  expectedErrorCode?: string;
  /** HTTP status expected on CSRF rejection. Defaults to 403; pass `false` to skip. */
  expectedHttpStatus?: number | false;
}

//? CSRF-enforcement layer: for each `auth.login: true` state-changing route,
//? send an authenticated request (valid session Cookie) WITHOUT the CSRF
//? header. Expect the framework's CSRF middleware to reject it. This is the
//? inverse of the custom layer's CSRF token-passing — it proves the protection
//? actually fires, so a consumer who misconfigures CSRF doesn't get a green run.
export const runCsrfEnforcementCheck = async (
  input: CsrfEnforcementCheckInput,
): Promise<ContractCheckResult> => {
  const { endpoint, baseUrl } = input;
  const url = `${baseUrl.replace(/\/$/, '')}/${endpoint.fullPath}`;
  const body = input.inputFor ? input.inputFor(endpoint) : {};
  const started = Date.now();
  const requestTimeoutMs = input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const expectedErrorCode = input.expectedErrorCode ?? DEFAULT_EXPECTED_ERROR_CODE;
  const expectedHttpStatus = input.expectedHttpStatus ?? DEFAULT_EXPECTED_HTTP_STATUS;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => { controller.abort(); }, requestTimeoutMs);
  const [fetchError, response] = await tryCatch(() => fetch(url, {
    method: endpoint.method,
    //? Valid session Cookie + Origin, but NO CSRF header — that omission is the
    //? whole point of the probe.
    headers: { 'Content-Type': 'application/json', 'Origin': new URL(baseUrl).origin, Cookie: input.authCookie },
    body: endpoint.method === 'GET' ? undefined : JSON.stringify(body),
    signal: controller.signal,
  }));
  clearTimeout(timeoutHandle);

  if (fetchError || !response) {
    return { endpoint, status: 'fail', reason: fetchError?.message ?? 'fetch returned no response', durationMs: Date.now() - started };
  }

  const [parseError, parsed] = await tryCatch<{ status?: 'success' | 'error'; errorCode?: string } | null, undefined>(
    async () => await response.json() as { status?: 'success' | 'error'; errorCode?: string },
  );
  const durationMs = Date.now() - started;

  if (parseError) {
    return { endpoint, status: 'fail', httpStatus: response.status, responseStatus: 'unknown', reason: `JSON parse failed: ${parseError.message}`, durationMs };
  }

  if (parsed?.status === 'success') {
    return {
      endpoint, status: 'fail', httpStatus: response.status, responseStatus: 'success',
      reason: 'state-changing endpoint accepted an authenticated request with NO CSRF header — CSRF protection is not enforced',
      durationMs,
    };
  }

  if (parsed?.status !== 'error' || parsed.errorCode !== expectedErrorCode) {
    return {
      endpoint, status: 'fail', httpStatus: response.status, responseStatus: parsed?.status ?? 'unknown', errorCode: parsed?.errorCode,
      reason: `expected CSRF rejection '${expectedErrorCode}' but got ${parsed?.status ?? 'none'}/${parsed?.errorCode ?? '(none)'}`,
      durationMs,
    };
  }

  if (expectedHttpStatus !== false && response.status !== expectedHttpStatus) {
    return {
      endpoint, status: 'fail', httpStatus: response.status, responseStatus: 'error', errorCode: parsed.errorCode,
      reason: `expected HTTP ${expectedHttpStatus} on CSRF rejection but got ${response.status}`,
      durationMs,
    };
  }

  return { endpoint, status: 'pass', httpStatus: response.status, responseStatus: 'error', errorCode: parsed.errorCode, durationMs };
};
