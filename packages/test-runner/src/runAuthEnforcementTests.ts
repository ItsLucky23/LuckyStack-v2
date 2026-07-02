import { walkEndpoints } from './walkEndpoints';
import { runAuthEnforcementCheck } from './authEnforcementCheck';
import { shouldSkip, hasAuthRequirement, hasMetaEntry, calculateSummary } from './testLayerHelpers';
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
    //? Order matters: the auth-requirement check must run BEFORE shouldSkip so a
    //? protected endpoint in the explicit skip list is still recorded as
    //? `skipped` in the results (not silently dropped as a public route).
    //? Reversing the order would hide the skip from the summary. We gate on
    //? `hasAuthRequirement` (login OR additional[]-predicates) so role/tenant/
    //? ownership-guarded routes with `login: false` are also probed.
    if (!hasMetaEntry(input.apiMetaMap, endpoint)) {
      //? Route is in `apiMethodMap` but ABSENT from `apiMetaMap` (partial drift /
      //? hand-trimmed map / generator bug). Its auth requirement is unknowable, so
      //? this layer can't assert it. Record a `skipped` result (NOT a silent
      //? continue) so the gap is visible per-route in the summary instead of the
      //? route masquerading as a verified-public endpoint. (M8)
      const skipped: ContractCheckResult = {
        endpoint,
        status: 'skipped',
        durationMs: 0,
        reason: 'No apiMetaMap entry — auth requirement unverifiable',
      };
      results.push(skipped);
      input.onResult?.(skipped);
      continue;
    }

    if (!hasAuthRequirement(input.apiMetaMap, endpoint)) {
      //? Truly-public endpoints (meta entry present, login:false, no additional[])
      //? can't be tested by this layer — skip silently, no noise. They're still
      //? covered by the contract layer.
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
