//? Shared helpers for the sweep test layers (contract, auth-enforcement,
//? rate-limit, fuzz). Centralizes the skip-matching, meta-map queries, and
//? summary-count math that were previously copy-pasted across each layer file.

import type {
  ApiMetaMap,
  ContractCheckResult,
  EndpointDescriptor,
  RunContractSummary,
} from './types';

/**
 * Whether an endpoint is in the explicit skip list. Matched against
 * `<page>/<name>` (version-agnostic) and `<page>/<name>/<version>`
 * (version-specific).
 */
export const shouldSkip = (endpoint: EndpointDescriptor, skip: string[]): boolean => {
  if (skip.length === 0) return false;
  const versioned = `${endpoint.page}/${endpoint.name}/${endpoint.version}`;
  const versionless = `${endpoint.page}/${endpoint.name}`;
  return skip.includes(versioned) || skip.includes(versionless);
};

/** Whether the endpoint's meta entry declares `auth.login: true`. */
export const requiresLogin = (apiMetaMap: ApiMetaMap, endpoint: EndpointDescriptor): boolean => {
  const meta = apiMetaMap[endpoint.page]?.[endpoint.name]?.[endpoint.version];
  return meta?.auth.login ?? false;
};

/**
 * The endpoint's declared numeric rate limit, or `null` when it has none
 * (`false`/`undefined`) or no meta entry exists.
 */
export const getRateLimit = (apiMetaMap: ApiMetaMap, endpoint: EndpointDescriptor): number | null => {
  const meta = apiMetaMap[endpoint.page]?.[endpoint.name]?.[endpoint.version];
  if (!meta || meta.rateLimit === false || meta.rateLimit === undefined) return null;
  return meta.rateLimit;
};

/** Aggregate pass/fail/skip counts over a sweep layer's results. */
export const calculateSummary = (results: ContractCheckResult[]): RunContractSummary => ({
  total: results.length,
  passed: results.filter(r => r.status === 'pass').length,
  failed: results.filter(r => r.status === 'fail').length,
  skipped: results.filter(r => r.status === 'skipped').length,
  results,
});
