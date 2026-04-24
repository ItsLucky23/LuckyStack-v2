import type { ContractCheckResult, EndpointDescriptor } from './types';

const REQUEST_TIMEOUT_MS = 5000;

//? Canonical error code the framework emits for unauthenticated requests
//? to `auth.login: true` endpoints. See packages/api/src/handleHttpApiRequest.ts.
const EXPECTED_ERROR_CODE = 'auth.required';

export interface AuthEnforcementCheckInput {
  endpoint: EndpointDescriptor;
  baseUrl: string;
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
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

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: endpoint.method,
      //? No session cookie, no auth header — deliberately.
      headers: { 'Content-Type': 'application/json' },
      body: endpoint.method === 'GET' ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const parsed = await response.json().catch(() => null) as {
      status?: 'success' | 'error';
      errorCode?: string;
    } | null;

    const durationMs = Date.now() - started;

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
  } catch (err) {
    return {
      endpoint,
      status: 'fail',
      reason: (err as Error).message,
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
};
