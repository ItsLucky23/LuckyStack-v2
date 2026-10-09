//? The generated ApiTypeMap stays compile-time-only (it's a TypeScript type).
//? At runtime we lean on the generated `apiMethodMap` object for iteration —
//? that's the one artifact the test-runner uses to walk every endpoint.
//?
//? Kept as its own module so future layers (auth-enforcement, rate-limit,
//? fuzz) can import these without pulling the runner's dependencies.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

//? Runtime mirrors of the generated artifacts the test-runner walks. Kept here
//? (not imported from the consumer's generated map) so the runner has no
//? import-time coupling to a project's generated files. Shared across the layer
//? files so the page→name→version shape is declared once.
export type ApiMethodMap = Partial<Record<string, Partial<Record<string, Partial<Record<string, string>>>>>>;

//? Mirror of the generated `syncMethodMap` shape (page → name → version → method).
//? Sync routes always POST over HTTP-fallback but the map carries the server-side
//? method declaration so `walkSyncEndpoints` can produce accurate descriptors.
export type SyncMethodMap = Partial<Record<string, Partial<Record<string, Partial<Record<string, string>>>>>>;

export interface ApiMetaEntry {
  method: string;
  auth: { login: boolean; additional?: Record<string, unknown>[]; hasAdditional?: boolean };
  rateLimit?: number | false;
}

export type ApiMetaMap = Partial<Record<string, Partial<Record<string, Partial<Record<string, ApiMetaEntry>>>>>>;

//? Mirror of the generated `syncMetaMap` (page → name → version → meta), emitted
//? by devkit next to `apiMetaMap`. A sync route has no HTTP method of its own —
//? only the auth requirement and rate limit its `_server` file declares.
export interface SyncMetaEntry {
  auth: ApiMetaEntry['auth'];
  rateLimit?: number | false;
}

export type SyncMetaMap = Partial<Record<string, Partial<Record<string, Partial<Record<string, SyncMetaEntry>>>>>>;

//? The part of a meta entry the sweep layers read. Both `ApiMetaEntry` and
//? `SyncMetaEntry` satisfy it, so one set of helpers serves both route kinds.
export type RouteMetaEntry = Pick<ApiMetaEntry, 'auth' | 'rateLimit'>;

export type RouteMetaMap = Partial<Record<string, Partial<Record<string, Partial<Record<string, RouteMetaEntry>>>>>>;

export interface EndpointDescriptor {
  page: string;
  name: string;
  version: string;
  method: HttpMethod;
  /** `api/<page>/<name>/<version>` or `sync/<page>/<name>/<version>` */
  fullPath: string;
  /** Route kind. Absent means `'api'` — only `walkSyncEndpoints` sets `'sync'`. */
  kind?: 'api' | 'sync';
}

export interface ContractCheckResult {
  endpoint: EndpointDescriptor;
  status: 'pass' | 'fail' | 'skipped';
  httpStatus?: number;
  responseStatus?: 'success' | 'error' | 'unknown';
  errorCode?: string;
  reason?: string;
  durationMs: number;
}

export interface RunContractSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  results: ContractCheckResult[];
}
