import { runAuthEnforcementCheck } from './authEnforcementCheck';
import {
  shouldSkip,
  hasAuthRequirement,
  hasMetaEntry,
  calculateSummary,
  metaMapFor,
  selectEndpoints,
  transportFor,
} from './testLayerHelpers';
import type { ProbeTransport } from './probeRequest';
import type {
  ApiMethodMap,
  ApiMetaMap,
  ContractCheckResult,
  EndpointDescriptor,
  RunContractSummary,
  SyncMetaMap,
} from './types';

export interface RunAuthEnforcementTestsInput {
  apiMethodMap: ApiMethodMap;
  apiMetaMap: ApiMetaMap;
  /** Generated `syncMetaMap`. When given, sync routes are swept too. */
  syncMetaMap?: SyncMetaMap;
  baseUrl: string;
  skip?: string[];
  /** Substring filter on `<page>/<name>/<version>`; other routes are not requested at all. */
  filter?: string;
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
  /** Transport for sync routes (e.g. the socket transport). Defaults to HTTP. */
  syncTransport?: ProbeTransport;
  /** Transport for API routes (e.g. the socket transport). Defaults to HTTP. */
  apiTransport?: ProbeTransport;
  onResult?: (result: ContractCheckResult) => void;
}

export const runAuthEnforcementTests = async (
  input: RunAuthEnforcementTestsInput,
): Promise<RunContractSummary> => {
  const endpoints = selectEndpoints(input);
  const skip = input.skip ?? [];
  const results: ContractCheckResult[] = [];

  for (const endpoint of endpoints) {
    const metaMap = metaMapFor(endpoint, input.apiMetaMap, input.syncMetaMap);
    //? Order matters: the auth-requirement check must run BEFORE shouldSkip so a
    //? protected endpoint in the explicit skip list is still recorded as
    //? `skipped` in the results (not silently dropped as a public route).
    //? Reversing the order would hide the skip from the summary. We gate on
    //? `hasAuthRequirement` (login OR additional[]-predicates) so role/tenant/
    //? ownership-guarded routes with `login: false` are also probed.
    if (!hasMetaEntry(metaMap, endpoint)) {
      //? Route is in the method/sync map but ABSENT from its meta map (partial
      //? drift / hand-trimmed map / generator bug). Its auth requirement is
      //? unknowable, so this layer can't assert it. Record a `skipped` result (NOT
      //? a silent continue) so the gap is visible per-route in the summary instead
      //? of the route masquerading as a verified-public endpoint. (M8)
      const skipped: ContractCheckResult = {
        endpoint,
        status: 'skipped',
        durationMs: 0,
        reason: `No ${endpoint.kind === 'sync' ? 'syncMetaMap' : 'apiMetaMap'} entry — auth requirement unverifiable`,
      };
      results.push(skipped);
      input.onResult?.(skipped);
      continue;
    }

    if (!hasAuthRequirement(metaMap, endpoint)) {
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
      transport: transportFor(endpoint, input.syncTransport, input.apiTransport),
    });
    results.push(result);
    input.onResult?.(result);
  }

  return calculateSummary(results);
};
