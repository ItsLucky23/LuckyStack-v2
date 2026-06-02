import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  initSecretManager,
  refreshSecretManager,
  reloadSecretManagerFromFiles,
  getCachedResolution,
  resetSecretManagerForTests,
  type SecretManagerConfig,
} from './index';

//? The private helpers (capturePointers, fetchResolve, applyResolved,
//? resolveToken, startDevReload) are not exported, so every branch is driven
//? through the public surface. `fetchImpl` is always an injected mock typed as
//? `typeof fetch` — no real network. process.env is snapshotted per test and
//? any pointer-shaped value is scrubbed so an outer-shell value can't leak into
//? capturePointers.

const POINTER = /^(.+)_V(\d+)$/;

let envSnapshot: NodeJS.ProcessEnv;

//? A fetch mock that always resolves to a JSON Response with the given body.
const jsonFetch = (body: unknown, status = 200, statusText = 'OK'): typeof fetch =>
  vi.fn<typeof fetch>(() => Promise.resolve(Response.json(body, { status, statusText })));

//? A 2xx Response carrying `{ values }`.
const okFetch = (values: unknown): typeof fetch => jsonFetch({ values });

//? A fetch mock whose promise rejects, simulating a transport-level failure.
const rejectingFetch = (error: Error): typeof fetch =>
  vi.fn<typeof fetch>(() => Promise.reject(error));

//? Narrow a fetch mock back to its vitest mock view so we can read `.mock`.
const callsOf = (fn: typeof fetch): unknown[][] =>
  (fn as ReturnType<typeof vi.fn>).mock.calls;

//? Pull the parsed request body of the Nth fetch call.
const bodyOf = (fn: typeof fetch, call = 0): { keys?: string[] } => {
  const init = callsOf(fn)[call]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as { keys?: string[] };
};

//? Swallow console.warn during hybrid tests (expression body dodges no-empty-function).
const swallowWarn = (): boolean => true;

const baseConfig = (overrides: Partial<SecretManagerConfig> = {}): SecretManagerConfig => ({
  url: 'https://secrets.example.com',
  token: 'tok-123',
  source: 'remote',
  ...overrides,
});

beforeEach(() => {
  envSnapshot = { ...process.env };
  //? Scrub any pointer-shaped env value so capturePointers starts clean.
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string' && POINTER.test(value)) Reflect.deleteProperty(process.env, key);
  }
  resetSecretManagerForTests();
  vi.restoreAllMocks();
});

afterEach(() => {
  process.env = envSnapshot;
  resetSecretManagerForTests();
});

describe('initSecretManager — source: local', () => {
  it('short-circuits: no network, pointer left untouched, cache empty', async () => {
    process.env.OPENAI_KEY = 'OPENAI_AUTHORIZATION_KEY_V5';
    const fetchImpl = okFetch({ OPENAI_AUTHORIZATION_KEY_V5: 'sk-real' });

    await initSecretManager(baseConfig({ source: 'local', fetchImpl }));

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(process.env.OPENAI_KEY).toBe('OPENAI_AUTHORIZATION_KEY_V5');
    expect(getCachedResolution()).toBeNull();
  });
});

describe('initSecretManager — source: remote (resolve + apply)', () => {
  it('resolves only pointer-shaped values and overwrites process.env with the real secret', async () => {
    process.env.OPENAI_KEY = 'OPENAI_AUTHORIZATION_KEY_V5';
    process.env.STRIPE_KEY = 'STRIPE_SECRET_KEY_V2';
    process.env.PLAIN_VALUE = 'not-a-pointer';
    const fetchImpl = okFetch({
      OPENAI_AUTHORIZATION_KEY_V5: 'sk-real',
      STRIPE_SECRET_KEY_V2: 'rk-real',
    });

    await initSecretManager(baseConfig({ fetchImpl }));

    expect(process.env.OPENAI_KEY).toBe('sk-real');
    expect(process.env.STRIPE_KEY).toBe('rk-real');
    //? Literal value untouched and never sent to the server.
    expect(process.env.PLAIN_VALUE).toBe('not-a-pointer');
    const sent = bodyOf(fetchImpl).keys ?? [];
    expect([...sent].sort()).toEqual(['OPENAI_AUTHORIZATION_KEY_V5', 'STRIPE_SECRET_KEY_V2']);
  });

  it('POSTs to /resolve with bearer auth and a keys body', async () => {
    process.env.A_KEY = 'A_SECRET_V1';
    const fetchImpl = okFetch({ A_SECRET_V1: 'value' });

    await initSecretManager(baseConfig({ fetchImpl, url: 'https://secrets.example.com///' }));

    const [url, init] = callsOf(fetchImpl)[0] as [string, RequestInit];
    expect(url).toBe('https://secrets.example.com/resolve');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-123');
    expect(bodyOf(fetchImpl).keys).toEqual(['A_SECRET_V1']);
  });

  it('sends each unique pointer once even when two env names share a pointer', async () => {
    process.env.PRIMARY = 'SHARED_SECRET_V3';
    process.env.ALIAS = 'SHARED_SECRET_V3';
    const fetchImpl = okFetch({ SHARED_SECRET_V3: 'shared' });

    await initSecretManager(baseConfig({ fetchImpl }));

    expect(bodyOf(fetchImpl).keys).toEqual(['SHARED_SECRET_V3']);
    expect(process.env.PRIMARY).toBe('shared');
    expect(process.env.ALIAS).toBe('shared');
  });

  it('caches the pointer -> value map with a fetchedAt timestamp', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(42);
    process.env.X_KEY = 'X_SECRET_V1';
    const fetchImpl = okFetch({ X_SECRET_V1: 'y' });

    await initSecretManager(baseConfig({ fetchImpl }));

    expect(getCachedResolution()).toEqual({ fetchedAt: 42, values: { X_SECRET_V1: 'y' } });
    nowSpy.mockRestore();
  });

  it('no-ops cleanly (empty cache) when there are no pointers to resolve', async () => {
    process.env.JUST_LITERAL = 'hello';
    const fetchImpl = okFetch({});

    await initSecretManager(baseConfig({ fetchImpl }));

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(getCachedResolution()).toEqual({ fetchedAt: expect.any(Number), values: {} });
  });
});

describe('initSecretManager — source: remote (hard failures)', () => {
  it('throws and does NOT mutate process.env when a pointer is unresolved', async () => {
    process.env.GOOD_KEY = 'GOOD_SECRET_V1';
    process.env.MISSING_KEY = 'MISSING_SECRET_V1';
    const fetchImpl = okFetch({ GOOD_SECRET_V1: 'good' });

    await expect(initSecretManager(baseConfig({ fetchImpl }))).rejects.toThrow(
      /did not resolve: MISSING_SECRET_V1/,
    );
    //? Atomic: the resolvable key must not have been written before the throw.
    expect(process.env.GOOD_KEY).toBe('GOOD_SECRET_V1');
  });

  it('throws on a non-2xx response and does not cache', async () => {
    process.env.K = 'SECRET_V1';
    const fetchImpl = jsonFetch({ values: {} }, 503, 'Service Unavailable');

    await expect(initSecretManager(baseConfig({ fetchImpl }))).rejects.toThrow(
      /Resolve request failed: 503 Service Unavailable/,
    );
    expect(getCachedResolution()).toBeNull();
  });

  it('throws when the response body has no values object', async () => {
    process.env.K = 'SECRET_V1';
    const fetchImpl = jsonFetch({});

    await expect(initSecretManager(baseConfig({ fetchImpl }))).rejects.toThrow(
      /missing `values` object/,
    );
  });

  it('re-throws transport errors in remote mode', async () => {
    process.env.K = 'SECRET_V1';
    const fetchImpl = rejectingFetch(new Error('network down'));

    await expect(initSecretManager(baseConfig({ fetchImpl }))).rejects.toThrow('network down');
  });
});

describe('initSecretManager — source: hybrid (soft failure)', () => {
  it('warns and leaves the pointer as-is when the fetch rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(swallowWarn);
    process.env.HKEY = 'H_SECRET_V1';
    const fetchImpl = rejectingFetch(new Error('boom'));

    await expect(
      initSecretManager(baseConfig({ source: 'hybrid', fetchImpl })),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledOnce();
    expect(process.env.HKEY).toBe('H_SECRET_V1');
    expect(getCachedResolution()).toBeNull();
  });

  it('applies resolved pointers and warns per unresolved one (no throw)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(swallowWarn);
    process.env.OK_KEY = 'OK_SECRET_V1';
    process.env.GONE_KEY = 'GONE_SECRET_V1';
    const fetchImpl = okFetch({ OK_SECRET_V1: 'ok' });

    await initSecretManager(baseConfig({ source: 'hybrid', fetchImpl }));

    expect(process.env.OK_KEY).toBe('ok');
    expect(process.env.GONE_KEY).toBe('GONE_SECRET_V1');
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('refreshSecretManager — rotation', () => {
  it('re-resolves the captured pointers and overwrites with the new value', async () => {
    process.env.ROT_KEY = 'ROT_SECRET_V5';
    const first = okFetch({ ROT_SECRET_V5: 'old' });
    await initSecretManager(baseConfig({ fetchImpl: first }));
    expect(process.env.ROT_KEY).toBe('old');

    //? The first resolve overwrote ROT_KEY with the literal secret, so the
    //? pointer is no longer in process.env — refresh must reuse the captured map.
    const second = okFetch({ ROT_SECRET_V5: 'rotated' });
    await initSecretManager(baseConfig({ fetchImpl: second }));
    await refreshSecretManager();

    expect(process.env.ROT_KEY).toBe('rotated');
    expect(second).toHaveBeenCalled();
  });

  it('is a no-op before init / in local mode', async () => {
    await expect(refreshSecretManager()).resolves.toBeUndefined();
    await initSecretManager(baseConfig({ source: 'local' }));
    await expect(refreshSecretManager()).resolves.toBeUndefined();
  });
});

describe('token resolution', () => {
  it('reads a fromFile token and sends it as the bearer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sm-token-'));
    const tokenFile = join(dir, 'token');
    writeFileSync(tokenFile, '  file-token-xyz\n');
    process.env.FKEY = 'F_SECRET_V1';
    const fetchImpl = okFetch({ F_SECRET_V1: 'v' });

    try {
      await initSecretManager(baseConfig({ fetchImpl, token: { fromFile: tokenFile } }));
      const init = callsOf(fetchImpl)[0]?.[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer file-token-xyz');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('dev hot reload', () => {
  it('poll re-resolves on the interval in dev', async () => {
    vi.useFakeTimers();
    try {
      process.env.NODE_ENV = 'development';
      process.env.PKEY = 'P_SECRET_V1';
      const fetchImpl = okFetch({ P_SECRET_V1: 'v' });

      await initSecretManager(baseConfig({ fetchImpl, dev: { watch: false, pollIntervalMs: 1000 } }));
      expect(fetchImpl).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not start the poll timer in production', async () => {
    vi.useFakeTimers();
    try {
      process.env.NODE_ENV = 'production';
      process.env.PKEY = 'P_SECRET_V1';
      const fetchImpl = okFetch({ P_SECRET_V1: 'v' });

      await initSecretManager(baseConfig({ fetchImpl, dev: { watch: false, pollIntervalMs: 1000 } }));
      expect(fetchImpl).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(5000);
      expect(fetchImpl).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('reloadSecretManagerFromFiles — dev file reload', () => {
  it('injects plain .env values and resolves pointer .env.local values', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sm-reload-'));
    const envFile = join(dir, 'env');
    const localFile = join(dir, 'env.local');
    writeFileSync(envFile, 'ENVIRONMENT=production\nPORT=123 # inline comment\n');
    writeFileSync(localFile, 'OPENAI_KEY=OPENAI_AUTHORIZATION_KEY_V5\n');
    process.env.NODE_ENV = 'production'; //? avoid starting real fs.watchers
    const fetchImpl = okFetch({ OPENAI_AUTHORIZATION_KEY_V5: 'sk-real' });

    try {
      await initSecretManager(baseConfig({ fetchImpl, dev: { envFiles: [envFile, localFile] } }));
      //? Nothing pointer-shaped in process.env at boot, so no boot fetch yet.
      expect(fetchImpl).not.toHaveBeenCalled();

      await reloadSecretManagerFromFiles();

      //? Plain .env values injected live (dotenv strips the inline comment).
      expect(process.env.ENVIRONMENT).toBe('production');
      expect(process.env.PORT).toBe('123');
      //? Pointer from .env.local resolved against the server.
      expect(process.env.OPENAI_KEY).toBe('sk-real');
      expect(bodyOf(fetchImpl).keys).toEqual(['OPENAI_AUTHORIZATION_KEY_V5']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is a no-op before init / in local mode', async () => {
    await expect(reloadSecretManagerFromFiles()).resolves.toBeUndefined();
    await initSecretManager(baseConfig({ source: 'local' }));
    await expect(reloadSecretManagerFromFiles()).resolves.toBeUndefined();
  });
});

describe('resetSecretManagerForTests', () => {
  it('clears the cache so a subsequent init re-resolves', async () => {
    process.env.RKEY = 'R_SECRET_V1';
    const fetchImpl = okFetch({ R_SECRET_V1: 'v' });

    await initSecretManager(baseConfig({ fetchImpl }));
    expect(getCachedResolution()).not.toBeNull();

    resetSecretManagerForTests();
    expect(getCachedResolution()).toBeNull();
  });
});
