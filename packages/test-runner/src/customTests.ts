//? Per-route business-logic test layer. Discovers `*.tests.ts` files
//? alongside `_api/` and `_sync/` route source, dynamic-imports each,
//? builds a route-bound `TestContext`, runs the exported `customTests`
//? cases. Spec: docs/ARCHITECTURE_TESTING.md.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { getPrismaClient, getSrcDir, tryCatch } from '@luckystack/core';

const API_TEST_FILE_PATTERN = /_v(\d+)\.tests\.ts$/;
const SYNC_SERVER_TEST_FILE_PATTERN = /_server_v(\d+)\.tests\.ts$/;

export interface CustomTestCase {
  name: string;
  run: (ctx: TestContext) => Promise<void>;
}

export interface CustomTestResult {
  routePath: string;
  caseName: string;
  status: 'pass' | 'fail';
  durationMs: number;
  reason?: string;
}

export interface RunCustomTestsSummary {
  total: number;
  passed: number;
  failed: number;
  results: CustomTestResult[];
}

export interface RunCustomTestsInput {
  baseUrl: string;
  /** Optional cookie name for the session token. Defaults to `luckystack_token`. */
  sessionCookieName?: string;
  /** Filter to a subset of routes — substring match against `<page>/<name>/<version>`. */
  filter?: string;
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
    const current = stack.pop()!;
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
      const relativePage = path.relative(srcDir, pageDir).replaceAll('\\', '/');
      found.push({
        filePath: fullPath,
        kind: parentDir === '_api' ? 'api' : 'sync',
        route: { page: relativePage, name: namePart, version },
      });
    }
  }
  return found.sort((a, b) => a.filePath.localeCompare(b.filePath));
};

//? Test fixture shapes. The TestContext is built per route — each per-route
//? test file's `customTests` cases receive a context already bound to the
//? route the file lives next to, so authors don't repeat `page/name/version`.
export interface TestContext {
  /** Invoke the route under test. Page / name / version are baked in. */
  callApi: <TInput = unknown, TOutput = unknown>(input: TInput) => Promise<TOutput>;
  callSync: <TInput = unknown, TOutput = unknown>(input: TInput, opts?: { receiver?: string }) => Promise<TOutput>;
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
  throws: (fn: () => unknown | Promise<unknown>, message?: string) => Promise<Error>;
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
    const [err] = await tryCatch(async () => fn());
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
}

//? Minimal session login: mints a session in Redis via the consumer's
//? registered SessionAdapter (from `@luckystack/login`). Deliberately does
//? NOT create the Prisma user record — User-table shape varies per
//? project. If your test needs a real user row, create it via
//? `ctx.prisma.user.create(...)` first, then pass `{ id, email }` to
//? `session.login()`.
const buildSessionHelpers = (state: TestSessionState): TestContext['session'] => {
  return {
    login: async (user) => {
      const { saveSession } = await import('@luckystack/login');
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
      await saveSession(token, sessionData as never, true);
      state.token = token;
      state.userId = userId;
      return { token, userId };
    },
    logout: async () => {
      if (!state.token) return;
      const { deleteSession } = await import('@luckystack/login');
      await deleteSession(state.token);
      state.token = null;
      state.userId = null;
    },
    current: () => ({ token: state.token, userId: state.userId }),
  };
};

const buildCallApi = (
  baseUrl: string,
  routePath: string,
  state: TestSessionState,
  cookieName: string,
): TestContext['callApi'] => {
  return async (input) => {
    const url = `${baseUrl.replace(/\/$/, '')}/api/${routePath}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (state.token) headers['Cookie'] = `${cookieName}=${state.token}`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(input ?? {}),
    });
    return (await response.json()) as never;
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
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (state.token) headers['Cookie'] = `${cookieName}=${state.token}`;
    const body = { data: input ?? {}, receiver: opts?.receiver };
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return (await response.json()) as never;
  };
};

const buildContext = (
  discovery: DiscoveredTestFile,
  input: RunCustomTestsInput,
): TestContext => {
  const cookieName = input.sessionCookieName ?? 'luckystack_token';
  const routePath = `${discovery.route.page}/${discovery.route.name}/${discovery.route.version}`;
  const state: TestSessionState = { token: null, userId: null };
  const prisma = getPrismaClient();
  return {
    callApi: buildCallApi(input.baseUrl, routePath, state, cookieName),
    callSync: buildCallSync(input.baseUrl, routePath, state, cookieName),
    session: buildSessionHelpers(state),
    prisma,
    expect: buildExpect(),
  };
};

export const runCustomTests = async (input: RunCustomTestsInput): Promise<RunCustomTestsSummary> => {
  const files = discoverCustomTestFiles();
  const results: CustomTestResult[] = [];

  for (const discovery of files) {
    const routePath = `${discovery.route.page}/${discovery.route.name}/${discovery.route.version}`;
    if (input.filter && !routePath.includes(input.filter)) continue;

    const [importError, mod] = await tryCatch(async () => import(pathToFileURL(discovery.filePath).href));
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
      if (typeof c?.name !== 'string' || typeof c?.run !== 'function') continue;
      const ctx = buildContext(discovery, input);
      const started = Date.now();
      const [runError] = await tryCatch(async () => c.run(ctx));
      const durationMs = Date.now() - started;
      const r: CustomTestResult = runError
        ? { routePath, caseName: c.name, status: 'fail', durationMs, reason: runError.message }
        : { routePath, caseName: c.name, status: 'pass', durationMs };
      results.push(r);
      input.onResult?.(r);
    }
  }

  return {
    total: results.length,
    passed: results.filter(r => r.status === 'pass').length,
    failed: results.filter(r => r.status === 'fail').length,
    results,
  };
};
