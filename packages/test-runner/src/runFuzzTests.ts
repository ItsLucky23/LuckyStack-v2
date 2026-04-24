import { walkEndpoints } from './walkEndpoints';
import { runFuzzCheck } from './fuzzCheck';
import type { ContractCheckResult, EndpointDescriptor, RunContractSummary } from './types';

type ApiMethodMap = Record<string, Record<string, Record<string, string>>>;

export interface RunFuzzTestsInput {
  apiMethodMap: ApiMethodMap;
  baseUrl: string;
  skip?: string[];
  headers?: Record<string, string>;
  onResult?: (result: ContractCheckResult) => void;
}

const shouldSkip = (endpoint: EndpointDescriptor, skip: string[]): boolean => {
  if (skip.length === 0) return false;
  const versioned = `${endpoint.page}/${endpoint.name}/${endpoint.version}`;
  const versionless = `${endpoint.page}/${endpoint.name}`;
  return skip.includes(versioned) || skip.includes(versionless);
};

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

  return {
    total: results.length,
    passed: results.filter(r => r.status === 'pass').length,
    failed: results.filter(r => r.status === 'fail').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    results,
  };
};
