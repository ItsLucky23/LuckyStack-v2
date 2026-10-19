import { runContractCheck } from './contractCheck';
import { resetServerState } from './resetServerState';
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
  /**
   * Routes designed to fail on the server (e.g. a playground route that throws
   * on purpose), matched like `skip`. Their shaped 5xx reply passes; every
   * other route's 5xx fails the layer.
   */
  expectServerError?: string[];
  /** Substring filter on `<page>/<name>/<version>`; other routes are not requested at all. */
  filter?: string;
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
  headers?: Record<string, string>;
  /** Transport for sync routes (e.g. the socket transport). Defaults to HTTP. */
  syncTransport?: ProbeTransport;
  /** Transport for API routes (e.g. the socket transport). Defaults to HTTP. */
  apiTransport?: ProbeTransport;
  /**
   * When given, rate limits are reset (`/_test/reset?only=rateLimits`) before
   * each route, so the shared per-IP bucket cannot fill up mid-sweep and turn
   * the remaining probes into limiter rejections.
   */
  resetToken?: string;
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

    if (input.resetToken) {
      await resetServerState({ baseUrl: input.baseUrl, token: input.resetToken, only: ['rateLimits'] });
    }

    //? Serial rather than parallel so we don't trip rate limiters or mask
    //? endpoint ordering bugs. Swap to a pool later if walk-time matters.
    const result = await runContractCheck({
      endpoint,
      baseUrl: input.baseUrl,
      inputFor: input.inputFor,
      headers: input.headers,
      transport: transportFor(endpoint, input.syncTransport, input.apiTransport),
      allowServerError: shouldSkip(endpoint, input.expectServerError ?? []),
    });
    results.push(result);
    input.onResult?.(result);
  }

  return calculateSummary(results);
};
