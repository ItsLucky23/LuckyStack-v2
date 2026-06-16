import type { ContractCheckResult, EndpointDescriptor } from './types';
import { sendProbe } from './probeRequest';

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
  //? CSRF is only enforced on state-changing methods (POST/PUT/DELETE). A GET
  //? probe would never reach the CSRF middleware regardless of headers, so it
  //? would always appear to pass — a false green. Guard here so the check is
  //? safe to call directly (the runner already filters, but direct callers may not).
  if (endpoint.method === 'GET') {
    return {
      endpoint,
      status: 'skipped',
      reason: `CSRF enforcement does not apply to ${endpoint.method} requests`,
      durationMs: 0,
    };
  }
  const url = `${baseUrl.replace(/\/$/, '')}/${endpoint.fullPath}`;
  const body = input.inputFor ? input.inputFor(endpoint) : {};
  const started = Date.now();
  const expectedErrorCode = input.expectedErrorCode ?? DEFAULT_EXPECTED_ERROR_CODE;
  const expectedHttpStatus = input.expectedHttpStatus ?? DEFAULT_EXPECTED_HTTP_STATUS;

  //? Valid session Cookie + Origin, but NO CSRF header — that omission is the
  //? whole point of the probe.
  const result = await sendProbe({
    url,
    method: endpoint.method,
    baseUrl,
    body,
    headers: { Cookie: input.authCookie },
    requestTimeoutMs: input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  });

  if (!result) {
    return { endpoint, status: 'fail', reason: 'fetch returned no response', durationMs: Date.now() - started };
  }

  const { httpStatus, parsed } = result;
  const durationMs = Date.now() - started;

  if (parsed?.status === 'success') {
    return {
      endpoint, status: 'fail', httpStatus, responseStatus: 'success',
      reason: 'state-changing endpoint accepted an authenticated request with NO CSRF header — CSRF protection is not enforced',
      durationMs,
    };
  }

  if (parsed?.status !== 'error' || parsed.errorCode !== expectedErrorCode) {
    const responseStatus: ContractCheckResult['responseStatus'] =
      parsed?.status === 'success' || parsed?.status === 'error' ? parsed.status : 'unknown';
    return {
      endpoint, status: 'fail', httpStatus, responseStatus, errorCode: parsed?.errorCode,
      reason: `expected CSRF rejection '${expectedErrorCode}' but got ${parsed?.status ?? 'none'}/${parsed?.errorCode ?? '(none)'}`,
      durationMs,
    };
  }

  if (expectedHttpStatus !== false && httpStatus !== expectedHttpStatus) {
    return {
      endpoint, status: 'fail', httpStatus, responseStatus: 'error', errorCode: parsed.errorCode,
      reason: `expected HTTP ${expectedHttpStatus} on CSRF rejection but got ${httpStatus}`,
      durationMs,
    };
  }

  return { endpoint, status: 'pass', httpStatus, responseStatus: 'error', errorCode: parsed.errorCode, durationMs };
};
