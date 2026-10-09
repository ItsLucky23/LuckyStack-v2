import { runCsrfEnforcementCheck } from './csrfEnforcementCheck';
import {
  shouldSkip,
  requiresLogin,
  hasMetaEntry,
  calculateSummary,
  metaMapFor,
  selectEndpoints,
  transportFor,
  STATE_CHANGING_METHODS,
} from './testLayerHelpers';
import type { ProbeTransport } from './probeRequest';
import type {
  ApiMethodMap,
  ApiMetaMap,
  ContractCheckResult,
  EndpointDescriptor,
  RunContractSummary,
  SyncMetaMap,
} from './types';

export interface RunCsrfEnforcementTestsInput {
  apiMethodMap: ApiMethodMap;
  apiMetaMap: ApiMetaMap;
  /** Generated `syncMetaMap`. When given, sync routes' `/sync/*` HTTP endpoints are probed too. */
  syncMetaMap?: SyncMetaMap;
  baseUrl: string;
  /** Valid session Cookie header (`<name>=<token>`) the probes carry so they reach the CSRF check. */
  authCookie: string;
  skip?: string[];
  /** Substring filter on `<page>/<name>/<version>`; other routes are not requested at all. */
  filter?: string;
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
  /**
   * HTTP transport for sync routes (one carrying the sync `receiver`). CSRF is
   * an HTTP-only guard, so this must be an HTTP transport even when the project
   * syncs over Socket.io — the `/sync/*` HTTP route is reachable either way.
   */
  syncTransport?: ProbeTransport;
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
  const endpoints = selectEndpoints(input);
  const skip = input.skip ?? [];
  const results: ContractCheckResult[] = [];

  for (const endpoint of endpoints) {
    const metaMap = metaMapFor(endpoint, input.apiMetaMap, input.syncMetaMap);
    //? Only login-required, state-changing routes are CSRF-protected. A missing
    //? meta entry means we can't know the auth requirement — skip silently here
    //? (the auth layer already surfaces the stale-map gap).
    if (!hasMetaEntry(metaMap, endpoint)) continue;
    if (!requiresLogin(metaMap, endpoint)) continue;
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
      transport: transportFor(endpoint, input.syncTransport),
    });
    results.push(result);
    input.onResult?.(result);
  }

  return calculateSummary(results);
};
