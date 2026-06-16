import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

//? Characterization tests for the DSN-present orchestration path of
//? `initializeSentry()`, added alongside the Bucket-3 refactor that split the
//? ~108-line god-function into `resolveSentryInitConfig` / `buildBeforeSend` /
//? `buildSentryInitOptions` / `wireSharedSentryDI`. These pin the externally-
//? observable behavior (the exact `Sentry.init` options, the cookie-stripping
//? `beforeSend`, the shared-DI wiring delegation, the auto-instrumentation call,
//? and the production vs development sample-rate + `enabled` branching) so the
//? extraction is provably behavior-preserving.
//?
//? The optional `@sentry/node` peer is simulated by mocking `node:module`'s
//? `createRequire` so the package's `loadSentry()` (which goes through core's
//? `loadPeer` → `requireFn(...)`) returns a fully-faked Sentry SDK whose calls
//? we can assert. The small `@luckystack/core` surface that `sentry.ts` imports
//? is mocked so we can observe `initSharedSentry` + `getProjectName` + the
//? logger without booting the real registries. `autoInstrumentation` is mocked
//? to a spy so the idempotent hook-wiring call is observable without registering
//? real hooks.

const fakeSentry = {
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setUser: vi.fn(),
  setContext: vi.fn(),
  startInactiveSpan: vi.fn(() => ({ span: true })),
};

//? Synchronous factory: no `importOriginal` / await needed because we only need
//? to override `createRequire` — the real built-in exports that `sentry.ts` does
//? NOT call (`builtinModules`, `isBuiltin`, etc.) are not imported by the SUT.
//? An async factory causes a race on the FIRST `await import('./sentry')` where
//? the factory's promise is still pending while the ESM linker runs sentry.ts's
//? module-level `createRequire(import.meta.url)`, causing the real createRequire
//? (and therefore the real @sentry/node) to be used in test 1 only.
vi.mock('node:module', () => {
  const createRequire = () => {
    const req = ((id: string): unknown => {
      if (id === '@sentry/node') return fakeSentry;
      throw new Error(`Cannot find module '${id}'`);
    }) as unknown as NodeRequire;
    req.resolve = ((id: string): string => {
      if (id === '@sentry/node') return '/fake/@sentry/node';
      throw new Error(`Cannot find module '${id}'`);
    }) as NodeRequire['resolve'];
    return req;
  };
  return { createRequire };
});

const initSharedSentry = vi.fn();
const warn = vi.fn();
const info = vi.fn();

vi.mock('@luckystack/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@luckystack/core')>();
  return {
    ...actual,
    getLogger: () => ({ debug: vi.fn(), info, warn, error: vi.fn() }),
    getProjectName: () => 'test-project',
    initSharedSentry: (instance: unknown) => initSharedSentry(instance),
    //? Override loadPeer so `sentry.ts`'s loadSentry() returns fakeSentry without
    //? going through createRequire — avoids the async node:module mock race that
    //? caused fakeSentry.init to show 0 calls on the first test.
    loadPeer: (packageName: string) => {
      if (packageName === '@sentry/node') return fakeSentry;
      throw new Error(`Unexpected loadPeer call for '${packageName}' in test`);
    },
  };
});

const enableAuto = vi.fn();
vi.mock('./autoInstrumentation', () => ({
  enableErrorTrackingAutoInstrumentation: () => enableAuto(),
}));

//? ET-O3: `initializeSentry` now calls `createSentryAdapter()` to register the
//? adapter via `appendErrorTracker`. Mock the adapter module so the characterization
//? tests stay focused on the orchestration (Sentry.init options, DI wiring, auto-
//? instrumentation) rather than the adapter's own peer-dep loading path.
const fakeAdapter = { name: 'sentry', captureException: vi.fn(), captureMessage: vi.fn(), setUser: vi.fn() };
vi.mock('./adapters/sentry', () => ({
  createSentryAdapter: () => fakeAdapter,
}));

//? Narrowing helper: under `noUncheckedIndexedAccess`, `mock.calls[0]` is
//? `args | undefined`. Assert the call happened and hand back its first arg
//? typed, instead of sprinkling non-null assertions or casts at each read.
const firstCallArg = (mock: { mock: { calls: unknown[][] } }): Record<string, unknown> => {
  const call = mock.mock.calls[0];
  if (!call) throw new Error('expected the mock to have been called at least once');
  return call[0] as Record<string, unknown>;
};

describe('initializeSentry — DSN-present orchestration (characterization)', () => {
  const savedEnv = { ...process.env };

  //? Pre-warm all async mock factories before the first test. Without this,
  //? the first `await import('./sentry')` in test 1 may resolve `node:module`
  //? and `@luckystack/core` through not-yet-settled async factories, causing
  //? the real createRequire (and thus real @sentry/node) to be used instead of
  //? fakeSentry. A single import + immediate module reset here forces all
  //? factories to settle so every test in this file starts from a clean state.
  beforeAll(async () => {
    await import('./sentry');
    vi.resetModules();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.SENTRY_DSN;
    delete process.env.VITE_SENTRY_DSN;
    delete process.env.SENTRY_ENABLED;
    delete process.env.VITE_SENTRY_ENABLED;
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('calls Sentry.init with the resolved options and enables auto-instrumentation', async () => {
    process.env.SENTRY_DSN = 'https://abc@example.ingest.sentry.io/1';
    const { initializeSentry } = await import('./sentry');

    initializeSentry();

    expect(fakeSentry.init).toHaveBeenCalledTimes(1);
    const opts = firstCallArg(fakeSentry.init);
    expect(opts.dsn).toBe('https://abc@example.ingest.sentry.io/1');
    expect(opts.environment).toBe('test');
    expect(opts.serverName).toBe('test-project');
    //? NODE_ENV=test, no enable override ⇒ enabled stays false.
    expect(opts.enabled).toBe(false);
    //? Non-production ⇒ development default sample rate 1.
    expect(opts.tracesSampleRate).toBe(1);
    expect(opts.ignoreErrors).toEqual(['Socket connection timeout', 'ECONNREFUSED']);

    expect(initSharedSentry).toHaveBeenCalledTimes(1);
    expect(enableAuto).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith('Sentry initialized for error monitoring');
  });

  it('beforeSend strips request.cookies and returns the event', async () => {
    process.env.SENTRY_DSN = 'https://abc@example.ingest.sentry.io/1';
    const { initializeSentry } = await import('./sentry');

    initializeSentry();

    const beforeSend = firstCallArg(fakeSentry.init).beforeSend as (
      event: Record<string, unknown>,
    ) => { request?: { cookies?: unknown; url?: unknown } };
    const withCookies = { request: { cookies: 'session=secret', url: '/x' } };
    const result = beforeSend(withCookies);
    expect(result).toBe(withCookies);
    expect(result.request?.cookies).toBeUndefined();
    expect(result.request?.url).toBe('/x');

    //? No request ⇒ untouched.
    const noRequest = { message: 'boom' };
    expect(beforeSend(noRequest)).toBe(noRequest);
  });

  it('wires the shared-DI surface — setUser/setContext/startInactiveSpan delegate to the live SDK (captureException/captureMessage are no-ops, routed via adapter)', async () => {
    process.env.SENTRY_DSN = 'https://abc@example.ingest.sentry.io/1';
    const { initializeSentry } = await import('./sentry');

    initializeSentry();

    const instance = firstCallArg(initSharedSentry) as unknown as {
      captureException: (err: Error, ctx: unknown) => string;
      captureMessage: (msg: string, level: string) => string;
      setUser: (user: unknown) => void;
      setContext: (key: string, ctx: unknown) => void;
      startInactiveSpan: (opts: unknown) => unknown;
    };

    //? ET-O3: captureException / captureMessage in the legacy DI slot are now
    //? no-ops — the `createSentryAdapter` adapter handles them via the adapter
    //? registry (captureExceptionAcrossTrackers), preventing double-fire and
    //? enabling per-event ALS identity. Calling the DI slot still returns a
    //? string (the expected type) but does NOT reach Sentry directly.
    const err = new Error('x');
    instance.captureException(err, { tag: 1 });
    expect(fakeSentry.captureException).not.toHaveBeenCalled();

    instance.captureMessage('hi', 'warning');
    expect(fakeSentry.captureMessage).not.toHaveBeenCalled();

    instance.setUser({ id: 'u1' });
    expect(fakeSentry.setUser).toHaveBeenCalledWith({ id: 'u1' });

    instance.setContext('k', { a: 1 });
    expect(fakeSentry.setContext).toHaveBeenCalledWith('k', { a: 1 });

    const span = instance.startInactiveSpan({ name: 's', op: 'o' });
    expect(fakeSentry.startInactiveSpan).toHaveBeenCalledWith({ name: 's', op: 'o' });
    expect(span).toEqual({ span: true });
  });

  it('uses the production sample-rate branch and honors SENTRY_ENABLED override', async () => {
    process.env.SENTRY_DSN = 'https://abc@example.ingest.sentry.io/1';
    process.env.NODE_ENV = 'production';
    const { initializeSentry } = await import('./sentry');

    initializeSentry();

    const opts = firstCallArg(fakeSentry.init);
    expect(opts.environment).toBe('production');
    //? production ⇒ production default sample rate 0.2.
    expect(opts.tracesSampleRate).toBe(0.2);
    //? production ⇒ enabled true even without override.
    expect(opts.enabled).toBe(true);
  });

  it('enables outside production when SENTRY_ENABLED=true', async () => {
    process.env.SENTRY_DSN = 'https://abc@example.ingest.sentry.io/1';
    process.env.NODE_ENV = 'development';
    process.env.SENTRY_ENABLED = 'true';
    const { initializeSentry } = await import('./sentry');

    initializeSentry();

    const opts = firstCallArg(fakeSentry.init);
    expect(opts.enabled).toBe(true);
    expect(opts.tracesSampleRate).toBe(1);
  });
});
