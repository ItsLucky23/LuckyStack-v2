import { walkEndpoints } from './walkEndpoints';
import { runCsrfEnforcementCheck } from './csrfEnforcementCheck';
import { shouldSkip, requiresLogin, hasMetaEntry, calculateSummary, STATE_CHANGING_METHODS } from './testLayerHelpers';
import type { ApiMethodMap, ApiMetaMap, ContractCheckResult, EndpointDescriptor, RunContractSummary } from './types';

export interface RunCsrfEnforcementTestsInput {
  apiMethodMap: ApiMethodMap;
  apiMetaMap: ApiMetaMap;
  baseUrl: string;
  /** Valid session Cookie header (`<name>=<token>`) the probes carry so they reach the CSRF check. */
  authCookie: string;
  skip?: string[];
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
  /** Per-call request timeout in ms forwarded to each check. */
  requestTimeoutMs?: number;
  /** Error code expected on CSRF rejection. Defaults to `auth.csrfMismatch`. */
  expectedErrorCode?: string;
  /** HTTP status expected on CSRF rejection. Defaults to 403; pass `false` to skip. */
  expectedHttpStatus?: number | false;
  onResult?: (result: ContractCheckResult) => void;
}

export const runCsrfEnforcementTests = async (
  input: RunCsrfEnforcementTestsInput,
): Promise<RunContractSummary> => {
  const endpoints = walkEndpoints(input.apiMethodMap);
  const skip = input.skip ?? [];
  const results: ContractCheckResult[] = [];

  for (const endpoint of endpoints) {
    //? Only login-required, state-changing routes are CSRF-protected. A missing
    //? meta entry means we can't know the auth requirement — skip silently here
    //? (the auth layer already surfaces the stale-map gap).
    if (!hasMetaEntry(input.apiMetaMap, endpoint)) continue;
    if (!requiresLogin(input.apiMetaMap, endpoint)) continue;
    if (!STATE_CHANGING_METHODS.has(endpoint.method)) continue;

    if (shouldSkip(endpoint, skip)) {
      const skipped: ContractCheckResult = {
        endpoint,
        status: 'skipped',
        durationMs: 0,
        reason: 'Explicitly skipped',
      };
      results.push(skipped);
      input.onResult?.(skipped);
      continue;
    }

    const result = await runCsrfEnforcementCheck({
      endpoint,
      baseUrl: input.baseUrl,
      authCookie: input.authCookie,
      inputFor: input.inputFor,
      requestTimeoutMs: input.requestTimeoutMs,
      expectedErrorCode: input.expectedErrorCode,
      expectedHttpStatus: input.expectedHttpStatus,
    });
    results.push(result);
    input.onResult?.(result);
  }

  return calculateSummary(results);
};
