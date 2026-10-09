import { runFuzzCheck } from './fuzzCheck';
import { shouldSkip, calculateSummary, selectEndpoints, transportFor, STATE_CHANGING_METHODS } from './testLayerHelpers';
import type { ProbeTransport } from './probeRequest';
import type { ApiMethodMap, ContractCheckResult, RunContractSummary, SyncMetaMap } from './types';

export interface RunFuzzTestsInput {
  apiMethodMap: ApiMethodMap;
  /** Generated `syncMetaMap`. When given, sync routes are swept too. */
  syncMetaMap?: SyncMetaMap;
  baseUrl: string;
  skip?: string[];
  /** Substring filter on `<page>/<name>/<version>`; other routes are not requested at all. */
  filter?: string;
  headers?: Record<string, string>;
  /** Transport for sync routes (e.g. the socket transport). API routes always use HTTP. */
  syncTransport?: ProbeTransport;
  onResult?: (result: ContractCheckResult) => void;
}

export const runFuzzTests = async (input: RunFuzzTestsInput): Promise<RunContractSummary> => {
  const endpoints = selectEndpoints(input);
  const skip = input.skip ?? [];
  //? In cookie-mode (authenticated sweep) junk bodies sent to state-changing
  //? routes (POST/PUT/DELETE — every sync route) bypass the body-ignore
  //? short-circuit and reach real mutation handlers — risking unintended
  //? side-effects on the test database. Skip those endpoints here; the contract
  //? layer already validates their shape with well-formed input, and the CSRF
  //? layer probes their auth guard separately.
  const isAuthenticatedSweep = Boolean(input.headers?.Cookie);
  const results: ContractCheckResult[] = [];

  for (const endpoint of endpoints) {
    if (isAuthenticatedSweep && STATE_CHANGING_METHODS.has(endpoint.method)) {
      const skipped: ContractCheckResult = {
        endpoint,
        status: 'skipped',
        durationMs: 0,
        reason: 'state-changing route skipped in cookie-mode fuzz sweep (mutation risk with junk bodies)',
      };
      results.push(skipped);
      input.onResult?.(skipped);
      continue;
    }

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

    const result = await runFuzzCheck({
      endpoint,
      baseUrl: input.baseUrl,
      headers: input.headers,
      transport: transportFor(endpoint, input.syncTransport),
    });
    results.push(result);
    input.onResult?.(result);
  }

  return calculateSummary(results);
};
