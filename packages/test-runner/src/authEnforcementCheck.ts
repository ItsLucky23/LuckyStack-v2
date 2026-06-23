import type { ContractCheckResult, EndpointDescriptor } from './types';
import { sendProbe } from './probeRequest';

const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

//? Canonical error codes the framework emits when an unauthenticated request hits
//? a protected endpoint: `auth.required` for an `auth.login: true` route, and
//? `auth.forbidden` for a route guarded ONLY by `auth.additional[]` predicates
//? (login: false) — validateRequest forbids the anonymous caller. Either is a PASS;
//? both mean the guard fired. See packages/api/src/handleHttpApiRequest.ts +
//? packages/core/src/validateRequest.ts.
const EXPECTED_ERROR_CODES = new Set(['auth.required', 'auth.forbidden']);

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

  //? No session cookie, no auth header — deliberately. Origin IS sent so the
  //? server's origin policy doesn't 403 before the auth check can run.
  const result = await sendProbe({
    url,
    method: endpoint.method,
    baseUrl,
    body,
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

  if (parsed?.status === 'success') {
    return {
      endpoint,
      status: 'fail',
      httpStatus,
      responseStatus: 'success',
      reason: 'auth.login endpoint returned success without a session',
      durationMs,
    };
  }

  if (parsed?.status !== 'error') {
    return {
      endpoint,
      status: 'fail',
      httpStatus,
      responseStatus: 'unknown',
      reason: 'Response missing standard `status` envelope',
      durationMs,
    };
  }

  if (parsed.errorCode === undefined || !EXPECTED_ERROR_CODES.has(parsed.errorCode)) {
    return {
      endpoint,
      status: 'fail',
      httpStatus,
      responseStatus: 'error',
      errorCode: parsed.errorCode,
      reason: `expected an auth-rejection errorCode (${[...EXPECTED_ERROR_CODES].join(' | ')}) but got '${parsed.errorCode ?? '(missing)'}'`,
      durationMs,
    };
  }

  return {
    endpoint,
    status: 'pass',
    httpStatus,
    responseStatus: 'error',
    errorCode: parsed.errorCode,
    durationMs,
  };
};
