import { walkEndpoints } from './walkEndpoints';
import { runFuzzCheck } from './fuzzCheck';
import { shouldSkip, calculateSummary } from './testLayerHelpers';
import type { ApiMethodMap, ContractCheckResult, RunContractSummary } from './types';

export interface RunFuzzTestsInput {
  apiMethodMap: ApiMethodMap;
  baseUrl: string;
  skip?: string[];
  headers?: Record<string, string>;
  onResult?: (result: ContractCheckResult) => void;
}

export const runFuzzTests = async (input: RunFuzzTestsInput): Promise<RunContractSummary> => {
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

    const result = await runFuzzCheck({
      endpoint,
      baseUrl: input.baseUrl,
      headers: input.headers,
    });
    results.push(result);
    input.onResult?.(result);
  }

  return calculateSummary(results);
};
