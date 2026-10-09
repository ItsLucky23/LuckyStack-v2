//? Shared helpers for the sweep test layers (contract, auth-enforcement,
//? rate-limit, fuzz). Centralizes the endpoint selection, skip-matching,
//? meta-map queries, and summary-count math that were previously copy-pasted
//? across each layer file.

import { walkEndpoints, walkSyncEndpoints } from './walkEndpoints';
import { defaultProbeTransport } from './probeRequest';
import type { ProbeTransport } from './probeRequest';
import type {
  ApiMethodMap,
  ApiMetaMap,
  ContractCheckResult,
  EndpointDescriptor,
  HttpMethod,
  RouteMetaMap,
  RunContractSummary,
  SyncMetaMap,
} from './types';

//? Single source of truth for the canonical layer names used in both the
//? orchestrator (`runAllTests`) and the reporter (`logRunAllSummary`). Keeping
//? them here prevents silent drift between the reporting labels and the summary
//? property keys when layers are added or renamed.
export const LAYER_KEYS = {
  contract: 'contract',
  auth: 'auth-enforcement',
  rateLimit: 'rate-limit',
  csrf: 'csrf-enforcement',
  fuzz: 'fuzz',
  custom: 'custom',
} as const;

//? HTTP methods that carry a body and mutate server state. The CSRF middleware
//? enforces a token only on these. Fuzz / rate-limit layers share this set to
//? avoid firing junk bodies at mutating authenticated routes in cookie-mode.
export const STATE_CHANGING_METHODS = new Set<HttpMethod>(['POST', 'PUT', 'DELETE']);

/** `<page>/<name>/<version>` — the key `filter` and `skip` match against. */
export const routeKey = (endpoint: EndpointDescriptor): string =>
  `${endpoint.page}/${endpoint.name}/${endpoint.version}`;

/** Whether an endpoint matches a substring `filter` (no filter matches all). */
export const matchesFilter = (endpoint: EndpointDescriptor, filter: string | undefined): boolean =>
  !filter || routeKey(endpoint).includes(filter);

export interface SelectEndpointsInput {
  apiMethodMap: ApiMethodMap;
  /** Generated `syncMetaMap`. When given, sync routes are swept too. */
  syncMetaMap?: SyncMetaMap;
  /** Substring filter on `<page>/<name>/<version>`. Non-matching routes are never requested. */
  filter?: string;
}

/**
 * The endpoints a sweep layer exercises: every API route, plus every sync
 * route when a `syncMetaMap` is supplied, narrowed by `filter`. Filtering
 * here — before any request — is what makes `filter` limit the traffic, not
 * just the report.
 */
export const selectEndpoints = (input: SelectEndpointsInput): EndpointDescriptor[] => [
  ...walkEndpoints(input.apiMethodMap),
  ...(input.syncMetaMap ? walkSyncEndpoints(input.syncMetaMap) : []),
].filter((endpoint) => matchesFilter(endpoint, input.filter));

/** The meta map that describes `endpoint`: `syncMetaMap` for sync routes, else `apiMetaMap`. */
export const metaMapFor = (
  endpoint: EndpointDescriptor,
  apiMetaMap: ApiMetaMap,
  syncMetaMap: SyncMetaMap | undefined,
): RouteMetaMap => (endpoint.kind === 'sync' ? syncMetaMap ?? {} : apiMetaMap);

/** The transport for `endpoint`: `syncTransport` for sync routes when given, else HTTP. */
export const transportFor = (
  endpoint: EndpointDescriptor,
  syncTransport: ProbeTransport | undefined,
): ProbeTransport => (endpoint.kind === 'sync' && syncTransport ? syncTransport : defaultProbeTransport);

/**
 * Whether an endpoint is in the explicit skip list. Matched against
 * `<page>/<name>` (version-agnostic) and `<page>/<name>/<version>`
 * (version-specific).
 */
export const shouldSkip = (endpoint: EndpointDescriptor, skip: string[]): boolean => {
  if (skip.length === 0) return false;
  const versioned = routeKey(endpoint);
  const versionless = `${endpoint.page}/${endpoint.name}`;
  return skip.includes(versioned) || skip.includes(versionless);
};

/** Whether the endpoint's meta entry declares `auth.login: true`. */
export const requiresLogin = (metaMap: RouteMetaMap, endpoint: EndpointDescriptor): boolean => {
  const meta = metaMap[endpoint.page]?.[endpoint.name]?.[endpoint.version];
  //? The meta map is a consumer-generated RUNTIME artifact — the static type
  //? declares `auth` as required, but a stale/partial entry can be missing it.
  //? Read defensively so a malformed entry surfaces as `false` (no login) and
  //? gets handled by the layer's skip path, instead of throwing a TypeError
  //? outside the per-endpoint tryCatch and aborting the whole layer.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime-defensive read of a generated artifact
  return meta?.auth?.login ?? false;
};

/** Whether the endpoint requires ANY authorization: `auth.login: true` OR a
 *  declared non-empty `auth.additional[]` predicate list (role/tenant/ownership
 *  guards). The auth sweep must probe BOTH — an additional[]-only route (login:
 *  false) is still authz-protected and an unauth call must be rejected. */
export const hasAuthRequirement = (metaMap: RouteMetaMap, endpoint: EndpointDescriptor): boolean => {
  const meta = metaMap[endpoint.page]?.[endpoint.name]?.[endpoint.version];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime-defensive read of a generated artifact
  return (meta?.auth?.login ?? false) || (meta?.auth?.hasAdditional ?? false);
};

/** Whether the meta map carries an entry for this endpoint at all. */
export const hasMetaEntry = (metaMap: RouteMetaMap, endpoint: EndpointDescriptor): boolean =>
  metaMap[endpoint.page]?.[endpoint.name]?.[endpoint.version] !== undefined;

/**
 * The endpoint's declared numeric rate limit, or `null` when it has none
 * (`false`/`undefined`) or no meta entry exists.
 */
export const getRateLimit = (metaMap: RouteMetaMap, endpoint: EndpointDescriptor): number | null => {
  const meta = metaMap[endpoint.page]?.[endpoint.name]?.[endpoint.version];
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
