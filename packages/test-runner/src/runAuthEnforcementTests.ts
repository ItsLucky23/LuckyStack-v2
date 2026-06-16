import { walkEndpoints } from './walkEndpoints';
import { runAuthEnforcementCheck } from './authEnforcementCheck';
import { shouldSkip, requiresLogin, calculateSummary } from './testLayerHelpers';
import type { ApiMethodMap, ApiMetaMap, ContractCheckResult, EndpointDescriptor, RunContractSummary } from './types';

export interface RunAuthEnforcementTestsInput {
  apiMethodMap: ApiMethodMap;
  apiMetaMap: ApiMetaMap;
  baseUrl: string;
  skip?: string[];
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
  onResult?: (result: ContractCheckResult) => void;
}

export const runAuthEnforcementTests = async (
  input: RunAuthEnforcementTestsInput,
): Promise<RunContractSummary> => {
  const endpoints = walkEndpoints(input.apiMethodMap);
  const skip = input.skip ?? [];
  const results: ContractCheckResult[] = [];

  for (const endpoint of endpoints) {
    //? Order matters: requiresLogin must run BEFORE shouldSkip so that a
    //? login-required endpoint in the explicit skip list is still recorded as
    //? `skipped` in the results (not silently dropped as a public route).
    //? Reversing the order would hide the skip from the summary.
    if (!requiresLogin(input.apiMetaMap, endpoint)) {
      //? Public endpoints can't be tested by this layer — skip silently, no
      //? noise. They're still covered by the contract layer.
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

    const result = await runAuthEnforcementCheck({
      endpoint,
      baseUrl: input.baseUrl,
      inputFor: input.inputFor,
    });
    results.push(result);
    input.onResult?.(result);
  }

  return calculateSummary(results);
};
