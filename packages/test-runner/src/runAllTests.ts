//? Orchestrator — runs all five test layers (contract, auth-enforcement,
//? rate-limit, fuzz, custom) against a running server and returns a single
//? combined summary. Consumers call this from their own thin script that
//? imports the generated `apiMethodMap` + `apiInputSchemas`.

import { sampleSchemaInput } from './schemaSampleInput';
import { runContractTests } from './runContractTests';
import { runAuthEnforcementTests } from './runAuthEnforcementTests';
import { runRateLimitTests } from './runRateLimitTests';
import { runFuzzTests } from './runFuzzTests';
import { runCustomTests } from './customTests';
import type { RunCustomTestsSummary } from './customTests';
import type { ContractCheckResult, EndpointDescriptor, RunContractSummary } from './types';
import type { ZodTypeAny } from 'zod';

type ApiMethodMap = Partial<Record<string, Partial<Record<string, Partial<Record<string, string>>>>>>;
type ApiMetaMap = Partial<Record<string, Partial<Record<string, Partial<Record<string, {
  method: string;
  auth: { login: boolean; additional?: Record<string, unknown>[] };
  rateLimit?: number | false;
}>>>>>>;
type ApiInputSchemas = Partial<Record<string, Partial<Record<string, Partial<Record<string, ZodTypeAny | undefined>>>>>>;

export interface RunAllTestsInput {
  apiMethodMap: ApiMethodMap;
  apiMetaMap: ApiMetaMap;
  apiInputSchemas: ApiInputSchemas;
  baseUrl: string;
  /** Cookie name for the session token. Defaults to `luckystack_token`. */
  sessionCookieName?: string;
  /** Auth token applied as a `Cookie` header to sweep-layer requests that need a session. */
  authToken?: string;
  /** Endpoints to skip from the sweep layers, e.g. routes that need a file upload. */
  skip?: string[];
  /** Substring filter applied to `<page>/<name>/<version>`. */
  filter?: string;
  /** Disable individual layers (faster local iteration). */
  noSweep?: boolean;
  noFuzz?: boolean;
  noRateLimit?: boolean;
  noCustom?: boolean;
}

export interface RunAllTestsSummary {
  contract?: RunContractSummary;
  auth?: RunContractSummary;
  rateLimit?: RunContractSummary;
  fuzz?: RunContractSummary;
  custom?: RunCustomTestsSummary;
  totalPassed: number;
  totalFailed: number;
}

const inputForEndpoint = (apiInputSchemas: ApiInputSchemas) =>
  (endpoint: EndpointDescriptor): unknown => {
    const schema = apiInputSchemas[endpoint.page]?.[endpoint.name]?.[endpoint.version];
    return schema ? sampleSchemaInput(schema) : {};
  };

const matchesFilter = (endpoint: EndpointDescriptor, filter: string | undefined): boolean => {
  if (!filter) return true;
  return `${endpoint.page}/${endpoint.name}/${endpoint.version}`.includes(filter);
};

const filterResults = (results: ContractCheckResult[], filter: string | undefined): ContractCheckResult[] =>
  filter ? results.filter(r => matchesFilter(r.endpoint, filter)) : results;

const cloneSummary = (summary: RunContractSummary, filter: string | undefined): RunContractSummary => {
  if (!filter) return summary;
  const results = filterResults(summary.results, filter);
  return {
    total: results.length,
    passed: results.filter(r => r.status === 'pass').length,
    failed: results.filter(r => r.status === 'fail').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    results,
  };
};

export const runAllTests = async (input: RunAllTestsInput): Promise<RunAllTestsSummary> => {
  const summary: RunAllTestsSummary = { totalPassed: 0, totalFailed: 0 };
  const headers: Record<string, string> = {};
  if (input.authToken) {
    const cookieName = input.sessionCookieName ?? 'luckystack_token';
    headers.Cookie = `${cookieName}=${input.authToken}`;
  }
  const inputFor = inputForEndpoint(input.apiInputSchemas);

  if (!input.noSweep) {
    const contract = await runContractTests({
      apiMethodMap: input.apiMethodMap,
      baseUrl: input.baseUrl,
      skip: input.skip,
      headers,
      inputFor,
    });
    summary.contract = cloneSummary(contract, input.filter);

    const auth = await runAuthEnforcementTests({
      apiMethodMap: input.apiMethodMap,
      apiMetaMap: input.apiMetaMap,
      baseUrl: input.baseUrl,
      skip: input.skip,
      inputFor,
    });
    summary.auth = cloneSummary(auth, input.filter);

    if (!input.noRateLimit) {
      const rateLimit = await runRateLimitTests({
        apiMethodMap: input.apiMethodMap,
        apiMetaMap: input.apiMetaMap,
        baseUrl: input.baseUrl,
        skip: input.skip,
        headers,
        inputFor,
      });
      summary.rateLimit = cloneSummary(rateLimit, input.filter);
    }

    if (!input.noFuzz) {
      const fuzz = await runFuzzTests({
        apiMethodMap: input.apiMethodMap,
        baseUrl: input.baseUrl,
        skip: input.skip,
        headers,
      });
      summary.fuzz = cloneSummary(fuzz, input.filter);
    }
  }

  if (!input.noCustom) {
    const custom = await runCustomTests({
      baseUrl: input.baseUrl,
      sessionCookieName: input.sessionCookieName,
      filter: input.filter,
    });
    summary.custom = custom;
  }

  summary.totalPassed = (summary.contract?.passed ?? 0)
    + (summary.auth?.passed ?? 0)
    + (summary.rateLimit?.passed ?? 0)
    + (summary.fuzz?.passed ?? 0)
    + (summary.custom?.passed ?? 0);
  summary.totalFailed = (summary.contract?.failed ?? 0)
    + (summary.auth?.failed ?? 0)
    + (summary.rateLimit?.failed ?? 0)
    + (summary.fuzz?.failed ?? 0)
    + (summary.custom?.failed ?? 0);

  return summary;
};

const formatSummaryLine = (label: string, s: RunContractSummary | RunCustomTestsSummary | undefined): string => {
  if (!s) return `  - ${label.padEnd(20)} (skipped)`;
  const skipped = 'skipped' in s ? s.skipped : 0;
  const mark = s.failed === 0 ? '✓' : '✗';
  return `  ${mark} ${label.padEnd(20)} ${s.passed}/${s.total} pass${skipped ? `, ${skipped} skipped` : ''}`;
};

export const logRunAllSummary = (summary: RunAllTestsSummary): void => {
  console.log('');
  console.log(formatSummaryLine('contract', summary.contract));
  console.log(formatSummaryLine('auth-enforcement', summary.auth));
  console.log(formatSummaryLine('rate-limit', summary.rateLimit));
  console.log(formatSummaryLine('fuzz', summary.fuzz));
  console.log(formatSummaryLine('custom', summary.custom));
  console.log('');
  console.log(`Summary: ${summary.totalPassed} passed, ${summary.totalFailed} failed`);
};
