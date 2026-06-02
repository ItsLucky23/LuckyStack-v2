//? Orchestrator — runs all five test layers (contract, auth-enforcement,
//? rate-limit, fuzz, custom) against a running server and returns a single
//? combined summary. Consumers call this from their own thin script that
//? imports the generated `apiMethodMap` + `apiInputSchemas`.

import { clearAllRateLimits, getProjectConfig } from '@luckystack/core';

import { sampleSchemaInput } from './schemaSampleInput';
import { runContractTests } from './runContractTests';
import { runAuthEnforcementTests } from './runAuthEnforcementTests';
import { runRateLimitTests } from './runRateLimitTests';
import { runFuzzTests } from './runFuzzTests';
import { runCustomTests } from './customTests';
import type { CustomTestResult, RunCustomTestsSummary } from './customTests';
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
    const cookieName = input.sessionCookieName ?? getProjectConfig().http.sessionCookieName;
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
    //? The rate-limit layer drains per-route buckets; clear them before the
    //? custom layer so business-logic tests on low-limit routes (e.g.
    //? confirmReset, sendReset) aren't spuriously rejected with
    //? api.rateLimitExceeded. Runs in-process against the same Redis the server
    //? uses. Non-fatal if the active strategy has no clear().
    try {
      await clearAllRateLimits();
    } catch {
      //? swallow — a missing clear() is a test-quality degrade, not a crash.
    }
    const custom = await runCustomTests({
      baseUrl: input.baseUrl,
      sessionCookieName: input.sessionCookieName,
      filter: input.filter,
      //? Pass the generated method map so the harness invokes each API route
      //? with its declared HTTP method (e.g. logout is DELETE, not POST).
      apiMethodMap: input.apiMethodMap,
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

//? ── Colored, list-based reporting ───────────────────────────────────────
//? Honors NO_COLOR / FORCE_COLOR (https://no-color.org) and falls back to
//? plain text when stdout is not a TTY (piped to a file / CI log).
const useColor = ((): boolean => {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return process.stdout.isTTY;
})();
const paint = (code: string, text: string): string => (useColor ? `\u001B[${code}m${text}\u001B[0m` : text);
const green = (t: string): string => paint('32', t);
const red = (t: string): string => paint('31', t);
const yellow = (t: string): string => paint('33', t);
const dim = (t: string): string => paint('2', t);
const bold = (t: string): string => paint('1', t);

interface ReportRow {
  label: string;
  reason?: string;
}

const xfailOf = (s: RunContractSummary | RunCustomTestsSummary | undefined): number =>
  s && 'xfailed' in s ? s.xfailed : 0;
const skippedOf = (s: RunContractSummary | RunCustomTestsSummary | undefined): number =>
  s && 'skipped' in s ? s.skipped : 0;

//? Per-layer headline: green "X/Y passed" when clean, red "Z failed" when not,
//? plus dim xfail / skipped counts. This is the "14/20 in groen, 6/20 in rood"
//? the report leads with.
const formatLayerLine = (label: string, s: RunContractSummary | RunCustomTestsSummary | undefined): string => {
  if (!s) return `  ${dim('–')} ${label.padEnd(18)} ${dim('(layer skipped)')}`;
  const clean = s.failed === 0;
  const mark = clean ? green('✓') : red('✗');
  const head = clean
    ? green(`${s.passed}/${s.total} passed`)
    : `${green(`${s.passed}/${s.total} passed`)}  ${red(`${s.failed}/${s.total} failed`)}`;
  const extras: string[] = [];
  const xf = xfailOf(s);
  const sk = skippedOf(s);
  if (xf) extras.push(yellow(`${xf} expected-fail`));
  if (sk) extras.push(dim(`${sk} skipped`));
  const extra = extras.length > 0 ? `  ${dim('·')} ${extras.join(dim(', '))}` : '';
  return `  ${mark} ${label.padEnd(18)} ${head}${extra}`;
};

const sweepFailRows = (s: RunContractSummary | undefined): ReportRow[] =>
  (s?.results ?? [])
    .filter((r) => r.status === 'fail')
    .map((r) => ({
      label: `${r.endpoint.page}/${r.endpoint.name}/${r.endpoint.version}`,
      reason: r.errorCode ? `${r.reason ?? 'failed'} [${r.errorCode}]` : r.reason,
    }));

const sweepSkipRows = (layer: string, s: RunContractSummary | undefined): ReportRow[] =>
  (s?.results ?? [])
    .filter((r) => r.status === 'skipped')
    .map((r) => ({
      label: `${layer}: ${r.endpoint.page}/${r.endpoint.name}/${r.endpoint.version}`,
      reason: r.reason,
    }));

const customRows = (s: RunCustomTestsSummary | undefined, status: CustomTestResult['status']): ReportRow[] =>
  (s?.results ?? [])
    .filter((r) => r.status === status)
    .map((r) => ({ label: `${r.routePath} :: ${r.caseName}`, reason: r.reason }));

const printSection = (title: (t: string) => string, heading: string, rows: ReportRow[], bullet: string): void => {
  if (rows.length === 0) return;
  console.log('');
  console.log(title(bold(`${heading} (${rows.length})`)));
  for (const row of rows) {
    console.log(`  ${title(bullet)} ${row.label}`);
    if (row.reason) console.log(`      ${dim(row.reason)}`);
  }
};

export const logRunAllSummary = (summary: RunAllTestsSummary): void => {
  console.log('');
  console.log(formatLayerLine('contract', summary.contract));
  console.log(formatLayerLine('auth-enforcement', summary.auth));
  console.log(formatLayerLine('rate-limit', summary.rateLimit));
  console.log(formatLayerLine('fuzz', summary.fuzz));
  console.log(formatLayerLine('custom', summary.custom));

  //? Real failures across every layer — these MUST be fixed (a green test that
  //? went red, or a wrong test). Sweep failures + un-marked custom failures.
  const failed: ReportRow[] = [
    ...sweepFailRows(summary.contract),
    ...sweepFailRows(summary.auth),
    ...sweepFailRows(summary.rateLimit),
    ...sweepFailRows(summary.fuzz),
    ...customRows(summary.custom, 'fail'),
  ];
  printSection(red, 'Failed — must be fixed (real bugs / wrong tests)', failed, '✗');

  //? Known, accepted failures — red is OK here; they are tracked, not regressions.
  printSection(yellow, 'Expected failures — known issues, allowed to fail', customRows(summary.custom, 'xfail'), '⚠');

  //? Stale markers — these passed but are still flagged expectedToFail.
  printSection(yellow, 'Unexpectedly passed — remove the expectedToFail marker', customRows(summary.custom, 'xpass'), '?');

  //? Skipped with reason — not run in this mode (login-gated, high rate-limit, …).
  const skipped: ReportRow[] = [
    ...sweepSkipRows('contract', summary.contract),
    ...sweepSkipRows('auth', summary.auth),
    ...sweepSkipRows('rate-limit', summary.rateLimit),
    ...sweepSkipRows('fuzz', summary.fuzz),
  ];
  printSection(dim, 'Skipped — not run (with reason)', skipped, '–');

  const totalXfail = xfailOf(summary.contract) + xfailOf(summary.auth) + xfailOf(summary.rateLimit)
    + xfailOf(summary.fuzz) + xfailOf(summary.custom);
  const totalSkipped = skippedOf(summary.contract) + skippedOf(summary.auth) + skippedOf(summary.rateLimit)
    + skippedOf(summary.fuzz) + skippedOf(summary.custom);

  console.log('');
  const parts = [
    green(`${summary.totalPassed} passed`),
    summary.totalFailed > 0 ? red(`${summary.totalFailed} failed`) : dim('0 failed'),
    totalXfail > 0 ? yellow(`${totalXfail} expected-fail`) : dim('0 expected-fail'),
    totalSkipped > 0 ? yellow(`${totalSkipped} skipped`) : dim('0 skipped'),
  ];
  console.log(`Summary: ${parts.join(dim('  ·  '))}`);
  console.log(dim('  legend: ✗ red = must fix · ⚠ yellow = known/allowed · – skipped (not run)'));
};
