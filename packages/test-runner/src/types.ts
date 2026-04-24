//? The generated ApiTypeMap stays compile-time-only (it's a TypeScript type).
//? At runtime we lean on the generated `apiMethodMap` object for iteration —
//? that's the one artifact the test-runner uses to walk every endpoint.
//?
//? Kept as its own module so future layers (auth-enforcement, rate-limit,
//? fuzz) can import these without pulling the runner's dependencies.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface EndpointDescriptor {
  page: string;
  name: string;
  version: string;
  method: HttpMethod;
  /** `api/<page>/<name>/<version>` */
  fullPath: string;
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
