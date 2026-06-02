//? Per-route business-logic test layer. Discovers `*.tests.ts` files
//? alongside `_api/` and `_sync/` route source, dynamic-imports each,
//? builds a route-bound `TestContext`, runs the exported `customTests`
//? cases. Spec: docs/ARCHITECTURE_TESTING.md.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { getCsrfConfig, getPrismaClient, getProjectConfig, getSrcDir, tryCatch } from '@luckystack/core';

import {
  openStreamWatcher,
  type StreamChunkFrame,
  type StreamWatcher,
} from './streamWatcher';

const API_TEST_FILE_PATTERN = /_v(\d+)\.tests\.ts$/;
const SYNC_SERVER_TEST_FILE_PATTERN = /_server_v(\d+)\.tests\.ts$/;

//? Mirror of the generated `apiMethodMap` shape (page → name → version →
//? method). Kept local so the test-runner has no import-time coupling to the
//? consumer's generated artifact.
type ApiMethodMap = Partial<Record<string, Partial<Record<string, Partial<Record<string, string>>>>>>;

export interface CustomTestCase {
  name: string;
  run: (ctx: TestContext) => Promise<void>;
  /**
   * Mark this case as a KNOWN, accepted failure (e.g. a documented bug not
   * yet fixed, or a scenario the current implementation cannot satisfy). The
   * string is the reason shown in the report. A case marked `expectedToFail`
   * that throws is reported as `xfail` — counted separately, NOT a red
   * failure. If it unexpectedly PASSES it is reported as `xpass` so the stale
   * marker can be removed. Leave undefined for normal cases.
   */
  expectedToFail?: string;
}

export interface CustomTestResult {
  routePath: string;
  caseName: string;
  //? `xfail` = marked expectedToFail and failed as expected (known issue).
  //? `xpass` = marked expectedToFail but passed (remove the marker).
  status: 'pass' | 'fail' | 'xfail' | 'xpass';
  durationMs: number;
  reason?: string;
  /** Documented reason when the case carried an `expectedToFail` marker. */
  expectedToFail?: string;
}

export interface RunCustomTestsSummary {
  total: number;
  passed: number;
  failed: number;
  /** Cases marked `expectedToFail` that failed as expected (known issues). */
  xfailed: number;
  /** Cases marked `expectedToFail` that unexpectedly passed (remove the marker). */
  xpassed: number;
  results: CustomTestResult[];
}

export interface RunCustomTestsInput {
  baseUrl: string;
  /** Optional cookie name for the session token. Defaults to the project's configured cookie. */
  sessionCookieName?: string;
  /** Filter to a subset of routes — substring match against `<page>/<name>/<version>`. */
  filter?: string;
  /**
   * Generated `apiMethodMap` so the harness sends each API route its declared
   * HTTP method (e.g. logout is DELETE). Falls back to POST when absent.
   */
  apiMethodMap?: ApiMethodMap;
  onResult?: (result: CustomTestResult) => void;
}

interface DiscoveredTestFile {
  /** Absolute path to the test file. */
  filePath: string;
  /** `api` or `sync` — which transport this route uses. */
  kind: 'api' | 'sync';
  /** Route descriptor parsed from the filename + directory location. */
  route: { page: string; name: string; version: string };
}

//? Walk `src/` recursively. A file matches when its directory contains an
//? `_api/` or `_sync/` segment AND the filename matches the version suffix
//? pattern. The route's `page` is everything between `src/` and the marker
//? segment, joined with `/`. Nested page folders are supported (e.g.
//? `src/admin/users/_api/getUser_v1.tests.ts` → page `admin/users`).
export const discoverCustomTestFiles = (srcDir: string = getSrcDir()): DiscoveredTestFile[] => {
  if (!fs.existsSync(srcDir)) return [];
  const found: DiscoveredTestFile[] = [];
  const stack: string[] = [srcDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.tests.ts')) continue;
      const parentDir = path.basename(current);
      if (parentDir !== '_api' && parentDir !== '_sync') continue;
      const pattern = parentDir === '_api' ? API_TEST_FILE_PATTERN : SYNC_SERVER_TEST_FILE_PATTERN;
      const versionMatch = pattern.exec(entry.name);
      if (!versionMatch) continue;
      const version = `v${versionMatch[1]}`;
      const namePart = entry.name.replace(parentDir === '_api' ? /_v\d+\.tests\.ts$/ : /_server_v\d+\.tests\.ts$/, '');
      const pageDir = path.dirname(current);
      //? Top-level `src/_api/` (no page folder) routes under the framework's
      //? `system` page — mirror that, otherwise an empty page produces the
      //? malformed URL `/api//logout/v1` and the call 404s.
      const relativePage = path.relative(srcDir, pageDir).replaceAll('\\', '/') || 'system';
      found.push({
        filePath: fullPath,
        kind: parentDir === '_api' ? 'api' : 'sync',
        route: { page: relativePage, name: namePart, version },
      });
    }
  }
  return found.toSorted((a, b) => a.filePath.localeCompare(b.filePath));
};

//? Test fixture shapes. The TestContext is built per route — each per-route
//? test file's `customTests` cases receive a context already bound to the
//? route the file lives next to, so authors don't repeat `page/name/version`.
export interface TestContext {
  /** Invoke the route under test. Page / name / version are baked in. */
  //? Two type parameters by design — `TInput` lets callers document the
  //? typed shape they're sending even though we don't validate against it
  //? here (the route's own runtime validation does). The ESLint rule
  //? otherwise flags it as "used once"; the documentation value is real.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- callsite-documentation use
  callApi: <TInput = unknown, TOutput = unknown>(input: TInput) => Promise<TOutput>;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- callsite-documentation use
  callSync: <TInput = unknown, TOutput = unknown>(input: TInput, opts?: { receiver?: string }) => Promise<TOutput>;
  /**
   * Open a second socket connection that joins `roomCode` as a pure
   * subscriber and exposes the incoming chunk stream for assertions.
   *
   * The route is auto-derived from the test file location, so a watcher
   * only surfaces chunks for the route this test belongs to. Multiple
   * watchers per test are allowed; all are auto-closed when the test
   * case finishes (whether it passes or throws).
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- callsite-documentation use
  watchStream: <TChunk extends StreamChunkFrame = StreamChunkFrame>(roomCode: string) => Promise<StreamWatcher<TChunk>>;
  session: {
    login: (user?: { email?: string; id?: string; name?: string }) => Promise<{ token: string; userId: string }>;
    logout: () => Promise<void>;
    current: () => { token: string | null; userId: string | null };
  };
  prisma: ReturnType<typeof getPrismaClient>;
  expect: TestExpect;
}

export interface TestExpect {
  eq: <T>(actual: T, expected: T, message?: string) => void;
  ok: (value: unknown, message?: string) => void;
  throws: (fn: () => Promise<unknown>, message?: string) => Promise<Error>;
  matches: (value: string, pattern: RegExp, message?: string) => void;
}

class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

const buildExpect = (): TestExpect => ({
  eq: (actual, expected, message) => {
    const ok = Object.is(actual, expected)
      || (typeof actual === 'object' && typeof expected === 'object' && JSON.stringify(actual) === JSON.stringify(expected));
    if (!ok) {
      const prefix = message ? `${message}: ` : '';
      throw new AssertionError(`${prefix}expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
    }
  },
  ok: (value, message) => {
    if (!value) throw new AssertionError(message ?? `expected truthy value, got ${JSON.stringify(value)}`);
  },
  throws: async (fn, message) => {
    const [err] = await tryCatch(fn);
    if (!err) throw new AssertionError(message ?? 'expected fn to throw, but it did not');
    return err;
  },
  matches: (value, pattern, message) => {
    if (!pattern.test(value)) {
      const prefix = message ? `${message}: ` : '';
      throw new AssertionError(`${prefix}"${value}" does not match ${pattern}`);
    }
  },
});

interface TestSessionState {
  token: string | null;
  userId: string | null;
  //? CSRF token minted by saveSession on login. Sent on authenticated
  //? state-changing requests so the server's CSRF middleware doesn't 403.
  csrfToken: string | null;
  //? Raw JSON body of the most recent callApi / callSync response. Surfaced in
  //? a failed case's reason so the report shows the server's actual errorCode
  //? (e.g. `api.rateLimitExceeded`) instead of only the assertion text.
  lastResponse: unknown;
}

//? Pull the server's errorCode (or non-success status) out of the last HTTP
//? response so a failure's reason shows WHY the server rejected the call, not
//? just the assertion text. Returns undefined for success / non-envelope bodies.
const extractErrorCode = (response: unknown): string | undefined => {
  if (!response || typeof response !== 'object') return undefined;
  const r = response as { errorCode?: unknown; status?: unknown };
  if (typeof r.errorCode === 'string' && r.errorCode.length > 0) return r.errorCode;
  if (typeof r.status === 'string' && r.status !== 'success') return r.status;
  return undefined;
};

//? Minimal session login: mints a session in Redis via the consumer's
//? registered SessionAdapter (from `@luckystack/login`). Deliberately does
//? NOT create the Prisma user record — User-table shape varies per
//? project. If your test needs a real user row, create it via
//? `ctx.prisma.user.create(...)` first, then pass `{ id, email }` to
//? `session.login()`.
const buildSessionHelpers = (state: TestSessionState): TestContext['session'] => {
  return {
    login: async (user) => {
      const { saveSession, getSession } = await import('@luckystack/login');
      const userId = user?.id ?? `test-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const email = user?.email ?? `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
      const name = user?.name ?? 'Test User';
      const token = `test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const sessionData = {
        id: userId,
        email,
        name,
        token,
        provider: 'credentials' as const,
      };
      await saveSession(token, sessionData, true);
      state.token = token;
      state.userId = userId;
      //? Read back the CSRF token saveSession minted so authenticated
      //? state-changing requests can pass the server's CSRF middleware.
      const persisted = await getSession(token);
      state.csrfToken = persisted?.csrfToken ?? null;
      return { token, userId };
    },
    logout: async () => {
      if (!state.token) return;
      const { deleteSession } = await import('@luckystack/login');
      await deleteSession(state.token);
      state.token = null;
      state.userId = null;
      state.csrfToken = null;
    },
    current: () => ({ token: state.token, userId: state.userId }),
  };
};

const buildCallApi = (
  baseUrl: string,
  routePath: string,
  state: TestSessionState,
  cookieName: string,
  //? The route's declared HTTP method (from the generated apiMethodMap). The
  //? server validates the method, so DELETE/PUT routes (e.g. logout) 405 if we
  //? always sent POST.
  method: string,
): TestContext['callApi'] => {
  return async (input) => {
    const url = `${baseUrl.replace(/\/$/, '')}/api/${routePath}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: new URL(baseUrl).origin };
    if (state.token) headers.Cookie = `${cookieName}=${state.token}`;
    if (state.csrfToken) headers[getCsrfConfig().headerName] = state.csrfToken;
    const init: RequestInit = { method, headers };
    //? GET / HEAD requests cannot carry a body (fetch throws). Every other
    //? method sends the JSON payload.
    if (method !== 'GET' && method !== 'HEAD') init.body = JSON.stringify(input ?? {});
    const response = await fetch(url, init);
    const json = (await response.json()) as never;
    state.lastResponse = json;
    return json;
  };
};

const buildCallSync = (
  baseUrl: string,
  routePath: string,
  state: TestSessionState,
  cookieName: string,
): TestContext['callSync'] => {
  return async (input, opts) => {
    const url = `${baseUrl.replace(/\/$/, '')}/sync/${routePath}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: new URL(baseUrl).origin };
    if (state.token) headers.Cookie = `${cookieName}=${state.token}`;
    if (state.csrfToken) headers[getCsrfConfig().headerName] = state.csrfToken;
    const body = { data: input ?? {}, receiver: opts?.receiver };
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as never;
    state.lastResponse = json;
    return json;
  };
};

interface BuiltContext {
  ctx: TestContext;
  /** Close every watcher opened during the case. Called by `runCustomTests` after each case. */
  closeAllWatchers: () => Promise<void>;
  /** Per-case session state — read after the run to surface the last response's errorCode. */
  state: TestSessionState;
}

const buildContext = (
  discovery: DiscoveredTestFile,
  input: RunCustomTestsInput,
): BuiltContext => {
  //? Default to the PROJECT's configured session cookie name (the server reads
  //? the token from this cookie). Hardcoding a name silently breaks every
  //? authenticated custom test when the project uses a different name.
  const cookieName = input.sessionCookieName ?? getProjectConfig().http.sessionCookieName;
  const routePath = `${discovery.route.page}/${discovery.route.name}/${discovery.route.version}`;
  const routeFullName = `sync/${routePath}`;
  //? API routes are invoked with their declared HTTP method; sync routes always
  //? POST. Default to POST when the map lacks the route (e.g. sync, or a map
  //? wasn't threaded through).
  const apiMethod = input.apiMethodMap?.[discovery.route.page]?.[discovery.route.name]?.[discovery.route.version] ?? 'POST';
  const state: TestSessionState = { token: null, userId: null, csrfToken: null, lastResponse: null };
  const prisma = getPrismaClient();

  //? Watchers are tracked per case so a missing explicit `close()` can't
  //? leak socket B between tests.
  const watchers: StreamWatcher[] = [];
  const watchStream = async <TChunk extends StreamChunkFrame = StreamChunkFrame>(
    roomCode: string,
  ): Promise<StreamWatcher<TChunk>> => {
    const watcher = await openStreamWatcher<TChunk>({
      baseUrl: input.baseUrl,
      roomCode,
      token: state.token,
      routeFullName,
    });
    //? Track watchers under the base `StreamChunkFrame` shape; the
    //? returned reference keeps the caller-supplied generic.
    watchers.push(watcher);
    return watcher;
  };

  const closeAllWatchers = async (): Promise<void> => {
    while (watchers.length > 0) {
      const watcher = watchers.pop();
      if (!watcher) continue;
      const [closeError] = await tryCatch(() => watcher.close());
      if (closeError) {
        //? Swallow — closing in cleanup must never mask the original test
        //? failure. Surface via logger if a project wires one up.
        //? (Intentionally not using getLogger here to avoid an extra import.)
      }
    }
  };

  const ctx: TestContext = {
    callApi: buildCallApi(input.baseUrl, routePath, state, cookieName, apiMethod),
    callSync: buildCallSync(input.baseUrl, routePath, state, cookieName),
    watchStream,
    session: buildSessionHelpers(state),
    prisma,
    expect: buildExpect(),
  };

  return { ctx, closeAllWatchers, state };
};

export const runCustomTests = async (input: RunCustomTestsInput): Promise<RunCustomTestsSummary> => {
  const files = discoverCustomTestFiles();
  const results: CustomTestResult[] = [];

  for (const discovery of files) {
    const routePath = `${discovery.route.page}/${discovery.route.name}/${discovery.route.version}`;
    if (input.filter && !routePath.includes(input.filter)) continue;

    const [importError, mod] = await tryCatch(
      () => import(pathToFileURL(discovery.filePath).href) as Promise<Record<string, unknown>>,
    );
    if (importError || !mod) {
      const r: CustomTestResult = {
        routePath, caseName: '(import)', status: 'fail', durationMs: 0,
        reason: `failed to import ${discovery.filePath}: ${importError?.message ?? 'unknown'}`,
      };
      results.push(r);
      input.onResult?.(r);
      continue;
    }

    const exported = (mod as { customTests?: unknown }).customTests;
    if (!Array.isArray(exported) || exported.length === 0) {
      //? File present but no cases — treat as silent skip; the AI hasn't filled it in yet.
      continue;
    }

    for (const rawCase of exported) {
      const c = rawCase as CustomTestCase;
      if (typeof c.name !== 'string' || typeof c.run !== 'function') continue;
      const expectedToFail = typeof c.expectedToFail === 'string' ? c.expectedToFail : undefined;
      const built = buildContext(discovery, input);
      const started = Date.now();
      const [runError] = await tryCatch(async () => c.run(built.ctx));
      //? Always close watchers regardless of pass/fail so the next case
      //? starts clean. tryCatch on the cleanup itself prevents a teardown
      //? throw from masking the original failure.
      await tryCatch(() => built.closeAllWatchers());
      const durationMs = Date.now() - started;

      let r: CustomTestResult;
      if (runError) {
        //? Augment the assertion message with the server's actual errorCode so
        //? the report explains the rejection, not just the failed expectation.
        const errorCode = extractErrorCode(built.state.lastResponse);
        const reason = errorCode ? `${runError.message} (server: ${errorCode})` : runError.message;
        r = expectedToFail
          ? { routePath, caseName: c.name, status: 'xfail', durationMs, reason, expectedToFail }
          : { routePath, caseName: c.name, status: 'fail', durationMs, reason };
      } else {
        r = expectedToFail
          ? {
              routePath, caseName: c.name, status: 'xpass', durationMs,
              reason: `marked expectedToFail ("${expectedToFail}") but passed — remove the marker`,
              expectedToFail,
            }
          : { routePath, caseName: c.name, status: 'pass', durationMs };
      }
      results.push(r);
      input.onResult?.(r);
    }
  }

  return {
    total: results.length,
    passed: results.filter(r => r.status === 'pass').length,
    failed: results.filter(r => r.status === 'fail').length,
    xfailed: results.filter(r => r.status === 'xfail').length,
    xpassed: results.filter(r => r.status === 'xpass').length,
    results,
  };
};
