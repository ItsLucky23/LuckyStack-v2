import { runContractCheck } from './contractCheck';
import { shouldSkip, calculateSummary, selectEndpoints, transportFor } from './testLayerHelpers';
import type { ProbeTransport } from './probeRequest';
import type { ApiMethodMap, ContractCheckResult, EndpointDescriptor, RunContractSummary, SyncMetaMap } from './types';

export interface RunContractTestsInput {
  apiMethodMap: ApiMethodMap;
  /** Generated `syncMetaMap`. When given, sync routes are swept too. */
  syncMetaMap?: SyncMetaMap;
  baseUrl: string;
  /**
   * Endpoints to skip. Matched against `<page>/<name>` (version-agnostic) and
   * `<page>/<name>/<version>` (version-specific). Useful for endpoints that
   * are known to need real input (e.g. a file upload).
   */
  skip?: string[];
  /** Substring filter on `<page>/<name>/<version>`; other routes are not requested at all. */
  filter?: string;
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
  headers?: Record<string, string>;
  /** Transport for sync routes (e.g. the socket transport). API routes always use HTTP. */
  syncTransport?: ProbeTransport;
  onResult?: (result: ContractCheckResult) => void;
}

export const runContractTests = async (input: RunContractTestsInput): Promise<RunContractSummary> => {
  const endpoints = selectEndpoints(input);
  const skip = input.skip ?? [];
  const results: ContractCheckResult[] = [];

  for (const endpoint of endpoints) {
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

    //? Serial rather than parallel so we don't trip rate limiters or mask
    //? endpoint ordering bugs. Swap to a pool later if walk-time matters.
    const result = await runContractCheck({
      endpoint,
      baseUrl: input.baseUrl,
      inputFor: input.inputFor,
      headers: input.headers,
      transport: transportFor(endpoint, input.syncTransport),
    });
    results.push(result);
    input.onResult?.(result);
  }

  return calculateSummary(results);
};
