//? Orchestrator — runs all five test layers (contract, auth-enforcement,
//? rate-limit, fuzz, custom) against a running server and returns a single
//? combined summary. Consumers call this from their own thin script that
//? imports the generated `apiMethodMap` + `apiInputSchemas`.

import { clearAllRateLimits, getCsrfConfig, getProjectConfig } from '@luckystack/core';

import { sampleSchemaInput } from './schemaSampleInput';
import { runContractTests } from './runContractTests';
import { runAuthEnforcementTests } from './runAuthEnforcementTests';
import { runRateLimitTests } from './runRateLimitTests';
import { runCsrfEnforcementTests } from './runCsrfEnforcementTests';
import { runFuzzTests } from './runFuzzTests';
import { runCustomTests } from './customTests';
import { calculateSummary, LAYER_KEYS } from './testLayerHelpers';
import type { CustomTestResult, RunCustomTestsSummary } from './customTests';
import type { ApiMethodMap, ApiMetaMap, ContractCheckResult, EndpointDescriptor, RunContractSummary } from './types';
import type { ZodType } from 'zod';

type ApiInputSchemas = Partial<Record<string, Partial<Record<string, Partial<Record<string, ZodType | undefined>>>>>>;

export interface RunAllTestsInput {
  apiMethodMap: ApiMethodMap;
  apiMetaMap: ApiMetaMap;
  apiInputSchemas: ApiInputSchemas;
  baseUrl: string;
  /** Cookie name for the session token. Defaults to the project's configured session cookie name (`projectConfig.http.sessionCookieName`). */
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
  /**
   * Disable the CSRF-enforcement layer. Defaults to ON (the layer runs) — but it
   * can only probe past the auth guard with a session, so it is a no-op unless an
   * `authToken` is supplied.
   */
  noCsrf?: boolean;
  noCustom?: boolean;
  /**
   * Token sent as `X-Test-Reset-Token` when the rate-limit layer resets the
   * shared bucket between endpoints. The server's `/_test/reset` requires
   * `TEST_RESET_TOKEN` to be set and matching — an unset/wrong token is 403, so
   * `resetBetweenEndpoints` would silently no-op. Defaults to
   * `process.env.TEST_RESET_TOKEN` so a CI run with the env set works with no
   * extra wiring; pass explicitly to override.
   */
  resetToken?: string;
}

export interface RunAllTestsSummary {
  contract?: RunContractSummary;
  auth?: RunContractSummary;
  rateLimit?: RunContractSummary;
  csrf?: RunContractSummary;
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
  return calculateSummary(filterResults(summary.results, filter));
};

//? Build the Cookie (and CSRF) headers sweep layers send when an `authToken`
//? is supplied. In cookie-mode the server's CSRF middleware rejects POST/PUT/DELETE
//? without a matching CSRF token, so we look up the session record and attach the
//? token the same way customTests.ts does: call getSession(authToken) and read
//? csrfToken off the persisted record. Token-mode sweeps (no Cookie header) and
//? runs without authToken are unaffected — the CSRF header is never added.
const buildAuthHeaders = async (input: RunAllTestsInput): Promise<Record<string, string>> => {
  const headers: Record<string, string> = {};
  if (!input.authToken) return headers;

  const cookieName = input.sessionCookieName ?? getProjectConfig().http.sessionCookieName;
  headers.Cookie = `${cookieName}=${input.authToken}`;

  //? Resolve the CSRF token lazily — import @luckystack/login at call time so
  //? projects that run the test-runner without login installed don't crash on
  //? import. Mirror the same dynamic import pattern used in customTests.ts.
  try {
    const { getSession } = await import('@luckystack/login');
    const session = await getSession(input.authToken);
    if (session?.csrfToken) {
      headers[getCsrfConfig().headerName] = session.csrfToken;
    }
  } catch (error) {
    //? @luckystack/login not installed or session lookup failed.
    //? Warn so the operator knows the sweep is running without a CSRF header
    //? (degraded mode) — the sweep continues, but CSRF-protected state-changing
    //? endpoints will be unreachable in cookie-mode.
    console.warn(
      '[test-runner] buildAuthHeaders: could not resolve CSRF token —',
      error instanceof Error ? error.message : String(error),
      '— sweep will run without the CSRF header (degraded mode).',
    );
  }

  return headers;
};

//? Run the four auto-sweep layers (contract → auth → rate-limit → fuzz) in
//? order, honoring the per-layer disable flags, and write each filtered
//? summary onto `summary`. Mutates `summary` in place — identical to the
//? prior inline block. The auth and rate-limit / fuzz nesting + ordering is
//? preserved exactly (auth always runs in the sweep; rate-limit + fuzz are
//? individually gated).
const runSweepLayers = async (
  input: RunAllTestsInput,
  summary: RunAllTestsSummary,
  headers: Record<string, string>,
  inputFor: (endpoint: EndpointDescriptor) => unknown,
): Promise<void> => {
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
      //? Reset the shared per-IP rate-limit bucket between endpoints so a
      //? neighbour saturating the window doesn't cause false pass/fail on the
      //? next endpoint. Requires the server to expose /_test/reset (NODE_ENV in
      //? { 'development', 'test' } AND TEST_RESET_TOKEN set + matching header).
      resetBetweenEndpoints: true,
      //? Thread the reset token (explicit input, else the TEST_RESET_TOKEN env the
      //? server validates against) — without it `/_test/reset` returns 403 and the
      //? between-endpoint reset silently never happens.
      resetToken: input.resetToken ?? process.env.TEST_RESET_TOKEN,
    });
    summary.rateLimit = cloneSummary(rateLimit, input.filter);
  }

  //? CSRF-enforcement layer: probes that the framework's CSRF middleware rejects
  //? state-changing authenticated requests carrying NO CSRF header. It can only
  //? reach the CSRF check past the auth guard with a valid session, so it runs
  //? only when an `authToken` is supplied (and the layer isn't disabled). Without
  //? a token there is nothing to probe — the layer is silently skipped, leaving
  //? behavior unchanged for tokenless sweeps.
  if (!input.noCsrf && headers.Cookie) {
    const csrf = await runCsrfEnforcementTests({
      apiMethodMap: input.apiMethodMap,
      apiMetaMap: input.apiMetaMap,
      baseUrl: input.baseUrl,
      authCookie: headers.Cookie,
      skip: input.skip,
      inputFor,
    });
    summary.csrf = cloneSummary(csrf, input.filter);
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
};

//? Run the custom (Layer 5) sweep, after clearing the per-route rate-limit
//? buckets the sweep layers drained. Mutates `summary` in place — identical to
//? the prior inline block.
const runCustomLayer = async (input: RunAllTestsInput, summary: RunAllTestsSummary): Promise<void> => {
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
};

//? The ordered list of sweep-layer keys that map to `RunContractSummary`
//? slots on `RunAllTestsSummary`. Drives `computeTotals` and the reporter so
//? adding a new sweep layer only requires adding it here + to the summary type.
const SWEEP_LAYER_ORDER = [
  LAYER_KEYS.contract,
  LAYER_KEYS.auth,
  LAYER_KEYS.rateLimit,
  LAYER_KEYS.csrf,
  LAYER_KEYS.fuzz,
] as const;

type SweepLayerKey = typeof SWEEP_LAYER_ORDER[number];

//? Map from each canonical layer key to the matching summary property name on
//? `RunAllTestsSummary`. Property names diverged from LAYER_KEYS values early
//? (LAYER_KEYS uses display strings like `'auth-enforcement'`); keeping this
//? map here means neither the reporter nor computeTotals need to hand-code the
//? mapping.
const SWEEP_SUMMARY_PROP: Record<SweepLayerKey, keyof Pick<RunAllTestsSummary, 'contract' | 'auth' | 'rateLimit' | 'csrf' | 'fuzz'>> = {
  [LAYER_KEYS.contract]: 'contract',
  [LAYER_KEYS.auth]: 'auth',
  [LAYER_KEYS.rateLimit]: 'rateLimit',
  [LAYER_KEYS.csrf]: 'csrf',
  [LAYER_KEYS.fuzz]: 'fuzz',
};

//? Iterate every sweep layer + the custom layer to sum passed/failed.
//? DD-TR-various — xpass exit-code policy (documented decision):
//? `xpass` (a case marked `expectedToFail` that unexpectedly passes) is NOT
//? counted in `totalFailed`. Rationale: an xpass is a positive signal — the
//? known issue is gone and the marker just needs removing. Treating it as a
//? failure would make CI red when a bug is fixed, which is backwards.
//? It IS shown prominently in the summary line and the "Unexpectedly passed"
//? section so the stale marker can't rot silently behind a green run.
//? To opt into strict mode (xpass = CI failure), inspect `summary.custom?.xpassed`
//? in your own script and `process.exit(1)` when it is > 0.
const computeTotals = (summary: RunAllTestsSummary): void => {
  let passed = 0;
  let failed = 0;
  for (const key of SWEEP_LAYER_ORDER) {
    const s = summary[SWEEP_SUMMARY_PROP[key]];
    passed += s?.passed ?? 0;
    failed += s?.failed ?? 0;
  }
  summary.totalPassed = passed + (summary.custom?.passed ?? 0);
  summary.totalFailed = failed + (summary.custom?.failed ?? 0);
};

export const runAllTests = async (input: RunAllTestsInput): Promise<RunAllTestsSummary> => {
  const summary: RunAllTestsSummary = { totalPassed: 0, totalFailed: 0 };

  //? Warn when a non-empty apiMethodMap is paired with an empty apiMetaMap.
  //? The auth-enforcement and rate-limit layers both use the meta map to decide
  //? which routes require login and which have declared rate limits. An absent
  //? or stale map silently skips every auth/rate-limit check — the run looks
  //? green but provides no real coverage.
  if (!input.noSweep) {
    const hasRoutes = Object.keys(input.apiMethodMap).length > 0;
    const hasMeta = Object.keys(input.apiMetaMap).length > 0;
    if (hasRoutes && !hasMeta) {
      console.warn(
        '[test-runner] runAllTests: apiMetaMap is empty but apiMethodMap has routes. '
        + 'The auth-enforcement and rate-limit layers will skip every route. '
        + 'Pass the generated apiMetaMap to enable those checks.',
      );
    }
  }

  const headers = await buildAuthHeaders(input);
  const inputFor = inputForEndpoint(input.apiInputSchemas);

  if (!input.noSweep) {
    await runSweepLayers(input, summary, headers, inputFor);
  }

  if (!input.noCustom) {
    await runCustomLayer(input, summary);
  }

  computeTotals(summary);

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

//? DD-TR-various — leaky summary union tightened:
//? `LayerSummary` is the minimal shape the reporter cares about — the fields
//? every layer summary has in common. The extra-field helpers discriminate via
//? `in` to stay type-safe without widening callers to `unknown`.
interface LayerSummary {
  total: number;
  passed: number;
  failed: number;
}

const xfailOf = (s: LayerSummary | undefined): number => {
  if (s === undefined || !('xfailed' in s)) return 0;
  const v = (s as Record<string, unknown>).xfailed;
  return typeof v === 'number' ? v : 0;
};
const skippedOf = (s: LayerSummary | undefined): number => {
  if (s === undefined || !('skipped' in s)) return 0;
  const v = (s as Record<string, unknown>).skipped;
  return typeof v === 'number' ? v : 0;
};

//? Per-layer headline: green "X/Y passed" when clean, red "Z failed" when not,
//? plus dim xfail / skipped counts. This is the "14/20 in groen, 6/20 in rood"
//? the report leads with.
const formatLayerLine = (label: string, s: LayerSummary | undefined): string => {
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

  //? Print a headline line for every sweep layer (ordered) then the custom layer.
  for (const key of SWEEP_LAYER_ORDER) {
    console.log(formatLayerLine(key, summary[SWEEP_SUMMARY_PROP[key]]));
  }
  console.log(formatLayerLine(LAYER_KEYS.custom, summary.custom));

  //? Real failures across every layer — these MUST be fixed (a green test that
  //? went red, or a wrong test). Sweep failures + un-marked custom failures.
  const failed: ReportRow[] = [
    ...SWEEP_LAYER_ORDER.flatMap((key) => sweepFailRows(summary[SWEEP_SUMMARY_PROP[key]])),
    ...customRows(summary.custom, 'fail'),
  ];
  printSection(red, 'Failed — must be fixed (real bugs / wrong tests)', failed, '✗');

  //? Known, accepted failures — red is OK here; they are tracked, not regressions.
  printSection(yellow, 'Expected failures — known issues, allowed to fail', customRows(summary.custom, 'xfail'), '⚠');

  //? Stale markers — these passed but are still flagged expectedToFail.
  printSection(yellow, 'Unexpectedly passed — remove the expectedToFail marker', customRows(summary.custom, 'xpass'), '?');

  //? Skipped with reason — not run in this mode (login-gated, high rate-limit, …).
  const skipped: ReportRow[] = SWEEP_LAYER_ORDER.flatMap((key) =>
    sweepSkipRows(key, summary[SWEEP_SUMMARY_PROP[key]]),
  );
  printSection(dim, 'Skipped — not run (with reason)', skipped, '–');

  //? Sum xfail and skipped across all layers (sweep + custom) in one pass.
  let totalXfail = 0;
  let totalSkipped = 0;
  for (const key of SWEEP_LAYER_ORDER) {
    const s = summary[SWEEP_SUMMARY_PROP[key]];
    totalXfail += xfailOf(s);
    totalSkipped += skippedOf(s);
  }
  totalXfail += xfailOf(summary.custom);
  totalSkipped += skippedOf(summary.custom);

  //? `xpass` (a case still marked expectedToFail that now passes) is NOT a
  //? failure, so it doesn't move the exit code — but it MUST be visible in the
  //? final line, otherwise a stale marker rots silently behind a green run.
  const totalXpass = summary.custom?.xpassed ?? 0;

  console.log('');
  const parts = [
    green(`${summary.totalPassed} passed`),
    summary.totalFailed > 0 ? red(`${summary.totalFailed} failed`) : dim('0 failed'),
    totalXfail > 0 ? yellow(`${totalXfail} expected-fail`) : dim('0 expected-fail'),
    totalXpass > 0 ? yellow(`${totalXpass} unexpectedly-passed`) : dim('0 unexpectedly-passed'),
    totalSkipped > 0 ? yellow(`${totalSkipped} skipped`) : dim('0 skipped'),
  ];
  console.log(`Summary: ${parts.join(dim('  ·  '))}`);
  console.log(dim('  legend: ✗ red = must fix · ⚠ yellow = known/allowed · – skipped (not run)'));
};
