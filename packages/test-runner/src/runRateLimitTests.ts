import { walkEndpoints } from './walkEndpoints';
import { runRateLimitCheck } from './rateLimitCheck';
import type { ContractCheckResult, EndpointDescriptor, RunContractSummary } from './types';

type ApiMethodMap = Record<string, Record<string, Record<string, string>>>;
type ApiMetaMap = Record<string, Record<string, Record<string, {
  method: string;
  auth: { login: boolean; additional?: Record<string, unknown>[] };
  rateLimit?: number | false;
}>>>;

export interface RunRateLimitTestsInput {
  apiMethodMap: ApiMethodMap;
  apiMetaMap: ApiMetaMap;
  baseUrl: string;
  skip?: string[];
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
  headers?: Record<string, string>;
  /**
   * Max rateLimit value to test. Endpoints with a higher limit are skipped
   * to avoid firing thousands of requests in CI.
   */
  maxRateLimitToTest?: number;
  onResult?: (result: ContractCheckResult) => void;
}

const getRateLimit = (apiMetaMap: ApiMetaMap, endpoint: EndpointDescriptor): number | null => {
  const meta = apiMetaMap[endpoint.page]?.[endpoint.name]?.[endpoint.version];
  if (!meta || meta.rateLimit === false || meta.rateLimit === undefined) return null;
  return meta.rateLimit;
};

const shouldSkip = (endpoint: EndpointDescriptor, skip: string[]): boolean => {
  if (skip.length === 0) return false;
  const versioned = `${endpoint.page}/${endpoint.name}/${endpoint.version}`;
  const versionless = `${endpoint.page}/${endpoint.name}`;
  return skip.includes(versioned) || skip.includes(versionless);
};

export const runRateLimitTests = async (
  input: RunRateLimitTestsInput,
): Promise<RunContractSummary> => {
  const endpoints = walkEndpoints(input.apiMethodMap);
  const skip = input.skip ?? [];
  const maxRateLimit = input.maxRateLimitToTest ?? 50;
  const results: ContractCheckResult[] = [];

  for (const endpoint of endpoints) {
    const rateLimit = getRateLimit(input.apiMetaMap, endpoint);
    if (rateLimit === null) continue;

    if (rateLimit > maxRateLimit) {
      const skipped: ContractCheckResult = {
        endpoint,
        status: 'skipped',
        durationMs: 0,
        reason: `rateLimit ${rateLimit} exceeds maxRateLimitToTest=${maxRateLimit}`,
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

    const result = await runRateLimitCheck({
      endpoint,
      baseUrl: input.baseUrl,
      rateLimit,
      inputFor: input.inputFor,
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
