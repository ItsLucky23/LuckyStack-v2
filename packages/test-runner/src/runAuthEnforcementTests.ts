import { walkEndpoints } from './walkEndpoints';
import { runAuthEnforcementCheck } from './authEnforcementCheck';
import type { ContractCheckResult, EndpointDescriptor, RunContractSummary } from './types';

type ApiMethodMap = Record<string, Record<string, Record<string, string>>>;
type ApiMetaMap = Record<string, Record<string, Record<string, {
  method: string;
  auth: { login: boolean; additional?: Record<string, unknown>[] };
  rateLimit?: number | false;
}>>>;

export interface RunAuthEnforcementTestsInput {
  apiMethodMap: ApiMethodMap;
  apiMetaMap: ApiMetaMap;
  baseUrl: string;
  skip?: string[];
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
  onResult?: (result: ContractCheckResult) => void;
}

const shouldSkip = (endpoint: EndpointDescriptor, skip: string[]): boolean => {
  if (skip.length === 0) return false;
  const versioned = `${endpoint.page}/${endpoint.name}/${endpoint.version}`;
  const versionless = `${endpoint.page}/${endpoint.name}`;
  return skip.includes(versioned) || skip.includes(versionless);
};

const requiresLogin = (apiMetaMap: ApiMetaMap, endpoint: EndpointDescriptor): boolean => {
  const meta = apiMetaMap[endpoint.page]?.[endpoint.name]?.[endpoint.version];
  return meta?.auth.login === true;
};

export const runAuthEnforcementTests = async (
  input: RunAuthEnforcementTestsInput,
): Promise<RunContractSummary> => {
  const endpoints = walkEndpoints(input.apiMethodMap);
  const skip = input.skip ?? [];
  const results: ContractCheckResult[] = [];

  for (const endpoint of endpoints) {
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

  return {
    total: results.length,
    passed: results.filter(r => r.status === 'pass').length,
    failed: results.filter(r => r.status === 'fail').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    results,
  };
};
