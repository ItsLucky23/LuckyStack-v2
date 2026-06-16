import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  return {
    ...actual,
    createRequire: () => {
      const req = ((id: string): unknown => {
        if (id === '@sentry/node') return fakeSentry;
        throw new Error(`Cannot find module '${id}'`);
      }) as unknown as NodeRequire;
      req.resolve = ((id: string): string => {
        if (id === '@sentry/node') return '/fake/@sentry/node';
        throw new Error(`Cannot find module '${id}'`);
      }) as NodeRequire['resolve'];
      return req;
    },
  };
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
  };
});

const enableAuto = vi.fn();
vi.mock('./autoInstrumentation', () => ({
  enableErrorTrackingAutoInstrumentation: () => enableAuto(),
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

  it('wires the shared-DI surface so each bridged fn delegates to the live SDK', async () => {
    process.env.SENTRY_DSN = 'https://abc@example.ingest.sentry.io/1';
    const { initializeSentry } = await import('./sentry');

    initializeSentry();

    const instance = firstCallArg(initSharedSentry) as unknown as {
      captureException: (err: Error, ctx: unknown) => void;
      captureMessage: (msg: string, level: string) => void;
      setUser: (user: unknown) => void;
      setContext: (key: string, ctx: unknown) => void;
      startInactiveSpan: (opts: unknown) => unknown;
    };
    const err = new Error('x');
    instance.captureException(err, { tag: 1 });
    expect(fakeSentry.captureException).toHaveBeenCalledWith(err, { tag: 1 });

    instance.captureMessage('hi', 'warning');
    expect(fakeSentry.captureMessage).toHaveBeenCalledWith('hi', 'warning');

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
