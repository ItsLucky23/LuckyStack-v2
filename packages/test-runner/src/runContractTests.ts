import { walkEndpoints } from './walkEndpoints';
import { runContractCheck } from './contractCheck';
import { shouldSkip, calculateSummary } from './testLayerHelpers';
import type { ApiMethodMap, ContractCheckResult, EndpointDescriptor, RunContractSummary } from './types';

export interface RunContractTestsInput {
  apiMethodMap: ApiMethodMap;
  baseUrl: string;
  /**
   * Endpoints to skip. Matched against `<page>/<name>` (version-agnostic) and
   * `<page>/<name>/<version>` (version-specific). Useful for endpoints that
   * are known to need real input (e.g. a file upload).
   */
  skip?: string[];
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
  headers?: Record<string, string>;
  onResult?: (result: ContractCheckResult) => void;
}

export const runContractTests = async (input: RunContractTestsInput): Promise<RunContractSummary> => {
  const endpoints = walkEndpoints(input.apiMethodMap);
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
    });
    results.push(result);
    input.onResult?.(result);
  }

  return calculateSummary(results);
};
