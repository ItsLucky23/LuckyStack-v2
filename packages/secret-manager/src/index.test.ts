import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  initSecretManager,
  refreshSecretManager,
  reloadSecretManagerFromFiles,
  getCachedResolution,
  getCachedResolutionMeta,
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

//? `envNames: () => true` opts these tests back into scanning every name — the
//? secure default (unset `envNames`) now resolves NOTHING off-host, so the
//? behavioral tests that assert resolution must explicitly opt in. The unset-default
//? deny-all + warning is covered by its own describe block below.
const baseConfig = (overrides: Partial<SecretManagerConfig> = {}): SecretManagerConfig => ({
  url: 'https://secrets.example.com',
  token: 'tok-123',
  source: 'remote',
  envNames: () => true,
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

      //? Plain .env values injected live (the in-package parser strips the inline comment).
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

//? SM-07 — the security validators (validateUrl / validateToken / isSafeEnvFile /
//? env-key regex) are not exported; drive them through the public surface.
describe('url validation (validateUrl)', () => {
  it('throws on a non-absolute url', async () => {
    await expect(initSecretManager(baseConfig({ url: 'not-a-url' }))).rejects.toThrow(
      /is not an absolute URL/,
    );
  });

  it('throws on a file:// scheme', async () => {
    await expect(initSecretManager(baseConfig({ url: 'file:///etc/passwd' }))).rejects.toThrow(
      /only http\(s\) is supported/,
    );
  });

  it('does not validate the url in local mode (placeholder allowed)', async () => {
    await expect(
      initSecretManager(baseConfig({ source: 'local', url: 'not-a-url' })),
    ).resolves.toBeUndefined();
  });
});

describe('transport security — plain-http guard (SM-01)', () => {
  it('rejects plain http to a non-loopback host by default', async () => {
    process.env.K = 'SECRET_V1';
    await expect(
      initSecretManager(baseConfig({ url: 'http://secrets.example.com' })),
    ).rejects.toThrow(/Refusing plain-http/);
  });

  it('allows plain http to loopback without the override', async () => {
    process.env.K = 'LOOP_SECRET_V1';
    const fetchImpl = okFetch({ LOOP_SECRET_V1: 'v' });
    await expect(
      initSecretManager(baseConfig({ url: 'http://localhost:8080', fetchImpl })),
    ).resolves.toBeUndefined();
    expect(process.env.K).toBe('v');
  });

  it('allows plain http to any host with allowInsecureHttp + warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(swallowWarn);
    process.env.K = 'INSEC_SECRET_V1';
    const fetchImpl = okFetch({ INSEC_SECRET_V1: 'v' });
    await initSecretManager(
      baseConfig({ url: 'http://secrets.example.com', allowInsecureHttp: true, fetchImpl }),
    );
    expect(process.env.K).toBe('v');
    expect(warn).toHaveBeenCalled();
  });
});

describe('token validation (validateToken)', () => {
  it('throws on a whitespace-only token', async () => {
    process.env.K = 'SECRET_V1';
    await expect(initSecretManager(baseConfig({ token: '   ' }))).rejects.toThrow(
      /token is empty or whitespace-only/,
    );
  });

  it('strips a Bearer prefix and warns — the resulting header must not be double-prefixed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(swallowWarn);
    process.env.K = 'SECRET_V1';
    const fetchImpl = okFetch({ SECRET_V1: 'v' });
    await initSecretManager(baseConfig({ token: 'Bearer abc', fetchImpl }));
    expect(warn).toHaveBeenCalled();
    //? The stripped token must NOT produce `Bearer Bearer abc`.
    const init = callsOf(fetchImpl)[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer abc');
  });
});

describe('parseEnvFile — env-key regex (SM-07)', () => {
  it('warns and skips an invalid env-var name', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(swallowWarn);
    const dir = mkdtempSync(join(tmpdir(), 'sm-key-'));
    const envFile = join(dir, 'env');
    writeFileSync(envFile, 'BAD-KEY=value\nGOOD_KEY=ok\n');
    process.env.NODE_ENV = 'production'; //? avoid real fs.watchers
    const fetchImpl = okFetch({});

    try {
      await initSecretManager(baseConfig({ fetchImpl, dev: { envFiles: [envFile] } }));
      await reloadSecretManagerFromFiles();
      expect(process.env.GOOD_KEY).toBe('ok');
      expect(process.env['BAD-KEY']).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Ignoring env key "BAD-KEY"'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('strips quotes AND a trailing inline comment from quoted values', async () => {
    vi.spyOn(console, 'warn').mockImplementation(swallowWarn);
    const dir = mkdtempSync(join(tmpdir(), 'sm-quote-'));
    const envFile = join(dir, 'env');
    writeFileSync(
      envFile,
      [
        'Q_PLAIN="quoted value"',
        'Q_COMMENT="quoted with comment" # trailing note',
        "Q_SINGLE='single quoted' # note",
        'Q_HASH="has#hash inside"',
        'Q_BARE=plain value # inline',
      ].join('\n') + '\n',
    );
    process.env.NODE_ENV = 'production'; //? avoid real fs.watchers
    const fetchImpl = okFetch({});

    try {
      await initSecretManager(baseConfig({ fetchImpl, dev: { envFiles: [envFile] } }));
      await reloadSecretManagerFromFiles();
      expect(process.env.Q_PLAIN).toBe('quoted value');
      //? Regression: a quoted value followed by an inline comment must keep only
      //? the quoted content (the `endsWith(quote)` check used to misclassify these
      //? as unterminated and store the raw `"..." # ...` text).
      expect(process.env.Q_COMMENT).toBe('quoted with comment');
      expect(process.env.Q_SINGLE).toBe('single quoted');
      //? A `#` INSIDE the quotes is literal, not a comment.
      expect(process.env.Q_HASH).toBe('has#hash inside');
      expect(process.env.Q_BARE).toBe('plain value');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('unsafe dev envFile path (isSafeEnvFile, SM-07)', () => {
  it('warns and skips a relative path that escapes the project root', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(swallowWarn);
    process.env.NODE_ENV = 'production'; //? drive reload without fs.watch
    const fetchImpl = okFetch({});

    await initSecretManager(
      baseConfig({ fetchImpl, dev: { envFiles: ['../outside.env'] } }),
    );
    await reloadSecretManagerFromFiles();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unsafe dev envFile path'));
  });
});

describe('non-string resolved values (SM-05)', () => {
  it('drops a non-string value: fatal in remote mode (treated as unresolved)', async () => {
    process.env.NK = 'N_SECRET_V1';
    //? Server returns a number for the requested pointer.
    const fetchImpl = okFetch({ N_SECRET_V1: 123 });

    await expect(initSecretManager(baseConfig({ fetchImpl }))).rejects.toThrow(
      /did not resolve: N_SECRET_V1/,
    );
    expect(process.env.NK).toBe('N_SECRET_V1');
  });
});

describe('envNames scoping (SM-06)', () => {
  it('only resolves names on the allowlist; an unrelated pointer-shaped value is ignored', async () => {
    process.env.WANTED = 'WANTED_SECRET_V1';
    process.env.RELEASE_TAG = 'build_2024_V2'; //? pointer-shaped but unrelated
    const fetchImpl = okFetch({ WANTED_SECRET_V1: 'real' });

    await initSecretManager(baseConfig({ fetchImpl, envNames: ['WANTED'] }));

    expect(process.env.WANTED).toBe('real');
    //? Never sent to the server.
    expect(bodyOf(fetchImpl).keys).toEqual(['WANTED_SECRET_V1']);
    expect(process.env.RELEASE_TAG).toBe('build_2024_V2');
  });
});

describe('envNames secure default (SM-06 — unset = deny-all + warn)', () => {
  it('resolves NOTHING off-host and warns when envNames is unset', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(swallowWarn);
    process.env.WANTED = 'WANTED_SECRET_V1';
    process.env.RELEASE_TAG = 'build_2024_V2';
    const fetchImpl = okFetch({ WANTED_SECRET_V1: 'real' });

    //? Raw config (no `envNames`, and NOT the permissive `baseConfig` default).
    await initSecretManager({
      url: 'https://secrets.example.com',
      token: 'tok-123',
      source: 'remote',
      fetchImpl,
    });

    //? Deny-all: nothing pointer-shaped is captured, so the server is never hit.
    expect(fetchImpl).not.toHaveBeenCalled();
    //? Both pointer-shaped values are left exactly as-is (never POSTed off-host).
    expect(process.env.WANTED).toBe('WANTED_SECRET_V1');
    expect(process.env.RELEASE_TAG).toBe('build_2024_V2');
    //? A clear, actionable boot warning names `envNames`.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('`envNames` is not set'));
    //? Empty cache — a zero-pointer resolve, not a failure.
    expect(getCachedResolution()).toEqual({ fetchedAt: expect.any(Number), values: {} });
  });

  it('does NOT throw in remote mode when envNames is unset (deny-all, not a hard stop)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(swallowWarn);
    process.env.WANTED = 'WANTED_SECRET_V1';
    const fetchImpl = okFetch({ WANTED_SECRET_V1: 'real' });

    //? Even in 'remote' (hard-stop) mode, an unset allowlist is a clean no-op +
    //? warn — the fail-OPEN-when-URL-unset contract is unchanged, this is the new
    //? deny-all-when-envNames-unset secure default.
    await expect(
      initSecretManager({
        url: 'https://secrets.example.com',
        token: 'tok-123',
        source: 'remote',
        fetchImpl,
      }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('`envNames` is not set'));
  });
});

describe('onApplied rotation hook (SM-10)', () => {
  it('fires with changed env NAMES (never the secret values)', async () => {
    process.env.OA_KEY = 'OA_SECRET_V1';
    const onApplied = vi.fn();
    const fetchImpl = okFetch({ OA_SECRET_V1: 'sk-real' });

    await initSecretManager(baseConfig({ fetchImpl, onApplied }));

    expect(onApplied).toHaveBeenCalledWith([{ name: 'OA_KEY', pointer: 'OA_SECRET_V1' }]);
    //? The payload carries the name + pointer, not the resolved secret.
    const arg = onApplied.mock.calls[0]?.[0] as { name: string; pointer: string }[];
    expect(JSON.stringify(arg)).not.toContain('sk-real');
  });

  it('does not fire when no value changed on a refresh', async () => {
    process.env.OA2_KEY = 'OA2_SECRET_V1';
    const onApplied = vi.fn();
    const fetchImpl = okFetch({ OA2_SECRET_V1: 'same' });

    await initSecretManager(baseConfig({ fetchImpl, onApplied }));
    expect(onApplied).toHaveBeenCalledTimes(1);

    await refreshSecretManager();
    //? Same value resolved again — no change, no second callback.
    expect(onApplied).toHaveBeenCalledTimes(1);
  });
});

describe('onResolveError hook (SM-11)', () => {
  it('fires with the phase when a hybrid resolve fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(swallowWarn);
    process.env.OE_KEY = 'OE_SECRET_V1';
    const onResolveError = vi.fn();
    const fetchImpl = rejectingFetch(new Error('boom'));

    await initSecretManager(
      baseConfig({ source: 'hybrid', fetchImpl, onResolveError }),
    );

    expect(onResolveError).toHaveBeenCalledWith(expect.any(Error), { phase: 'boot' });
    expect(warn).toHaveBeenCalled();
  });
});

describe('request timeout (SM-02)', () => {
  it('passes an AbortSignal to fetch by default', async () => {
    process.env.T_KEY = 'T_SECRET_V1';
    const fetchImpl = okFetch({ T_SECRET_V1: 'v' });

    await initSecretManager(baseConfig({ fetchImpl }));

    const init = callsOf(fetchImpl)[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('omits the signal when timeoutMs is 0', async () => {
    process.env.T2_KEY = 'T2_SECRET_V1';
    const fetchImpl = okFetch({ T2_SECRET_V1: 'v' });

    await initSecretManager(baseConfig({ fetchImpl, timeoutMs: 0 }));

    const init = callsOf(fetchImpl)[0]?.[1] as RequestInit;
    expect(init.signal).toBeUndefined();
  });
});

describe('retries (SM-02)', () => {
  it('retries a transient transport failure then succeeds', async () => {
    process.env.RT_KEY = 'RT_SECRET_V1';
    let calls = 0;
    const fetchImpl = vi.fn<typeof fetch>(() => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('transient'));
      return Promise.resolve(Response.json({ values: { RT_SECRET_V1: 'v' } }));
    });

    await initSecretManager(baseConfig({ fetchImpl, retries: { count: 1 } }));

    expect(calls).toBe(2);
    expect(process.env.RT_KEY).toBe('v');
  });
});

describe('resolvePath + headers (SM-12)', () => {
  it('uses a custom resolve path and merges extra headers (cannot override Authorization)', async () => {
    process.env.RP_KEY = 'RP_SECRET_V1';
    const fetchImpl = okFetch({ RP_SECRET_V1: 'v' });

    await initSecretManager(
      baseConfig({
        fetchImpl,
        resolvePath: 'v2/resolve',
        headers: { 'X-Tenant': 'acme', Authorization: 'Bearer hijack' },
      }),
    );

    const [url, init] = callsOf(fetchImpl)[0] as [string, RequestInit];
    expect(url).toBe('https://secrets.example.com/v2/resolve');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Tenant']).toBe('acme');
    //? Consumer headers cannot override the bearer auth.
    expect(headers.Authorization).toBe('Bearer tok-123');
  });
});

describe('getCachedResolution defensive copy (SM-03)', () => {
  it('returns a copy that cannot corrupt the internal cache', async () => {
    process.env.GC_KEY = 'GC_SECRET_V1';
    const fetchImpl = okFetch({ GC_SECRET_V1: 'v' });

    await initSecretManager(baseConfig({ fetchImpl }));

    const snap = getCachedResolution();
    expect(snap?.values.GC_SECRET_V1).toBe('v');
    if (snap) snap.values.GC_SECRET_V1 = 'tampered';
    //? A second read still reflects the real cached value.
    expect(getCachedResolution()?.values.GC_SECRET_V1).toBe('v');
  });
});

describe('stateful pointerPattern flags stripped (SM-16)', () => {
  it('classifies every entry even with a /g pattern', async () => {
    process.env.S1 = 'S1_SECRET_V1';
    process.env.S2 = 'S2_SECRET_V1';
    process.env.S3 = 'S3_SECRET_V1';
    const fetchImpl = okFetch({
      S1_SECRET_V1: 'a',
      S2_SECRET_V1: 'b',
      S3_SECRET_V1: 'c',
    });

    await initSecretManager(
      baseConfig({ fetchImpl, pointerPattern: /^(.+)_V(\d+)$/g }),
    );

    //? Without flag-stripping a /g pattern's stateful lastIndex would skip
    //? alternating entries — all three must resolve.
    expect(process.env.S1).toBe('a');
    expect(process.env.S2).toBe('b');
    expect(process.env.S3).toBe('c');
  });
});

describe('init validates url before recording config (SM-16)', () => {
  it('a refresh after a failed init is a no-op (config not recorded)', async () => {
    process.env.K = 'SECRET_V1';
    await expect(initSecretManager(baseConfig({ url: 'not-a-url' }))).rejects.toThrow();
    //? activeConfig must not have been set, so refresh does nothing (no throw).
    await expect(refreshSecretManager()).resolves.toBeUndefined();
  });
});

describe('envNames scoping on file-reload (SM-06 drift)', () => {
  it('drops a pointer-shaped file value excluded by envNames (not POSTed) and skips its plain injection too', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sm-reload-scope-'));
    const envFile = join(dir, 'env');
    //? WANTED is allowlisted; RELEASE_TAG (pointer-shaped) + UNSCOPED_PLAIN are not.
    writeFileSync(
      envFile,
      'WANTED=WANTED_SECRET_V1\nRELEASE_TAG=build_2024_V2\nUNSCOPED_PLAIN=hello\n',
    );
    process.env.NODE_ENV = 'production'; //? avoid real fs.watchers
    const fetchImpl = okFetch({ WANTED_SECRET_V1: 'real' });

    try {
      await initSecretManager(
        baseConfig({ fetchImpl, envNames: ['WANTED'], dev: { envFiles: [envFile] } }),
      );
      await reloadSecretManagerFromFiles();

      expect(process.env.WANTED).toBe('real');
      //? Only the allowlisted pointer is sent off-host.
      expect(bodyOf(fetchImpl).keys).toEqual(['WANTED_SECRET_V1']);
      //? An excluded pointer-shaped value is never POSTed.
      expect(process.env.RELEASE_TAG).toBeUndefined();
      //? An excluded plain value is not injected into process.env either.
      expect(process.env.UNSCOPED_PLAIN).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('file-reload merges pointers (SM — drop inherited pointer fix)', () => {
  it('keeps a boot-captured pointer that is not in any watched file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sm-reload-merge-'));
    const envFile = join(dir, 'env');
    writeFileSync(envFile, 'FROM_FILE=FILE_SECRET_V1\n');
    process.env.NODE_ENV = 'production'; //? avoid real fs.watchers
    //? Inherited pointer NOT present in the watched file.
    process.env.INHERITED = 'INHERITED_SECRET_V1';
    const fetchImpl = okFetch({
      INHERITED_SECRET_V1: 'inh',
      FILE_SECRET_V1: 'fil',
    });

    try {
      await initSecretManager(baseConfig({ fetchImpl, dev: { envFiles: [envFile] } }));
      //? Boot resolved the inherited pointer.
      expect(process.env.INHERITED).toBe('inh');

      await reloadSecretManagerFromFiles();
      //? The inherited pointer survives the reload (merge, not replace) and the
      //? file pointer is added.
      const sent = bodyOf(fetchImpl, 1).keys ?? [];
      expect(sent.toSorted()).toEqual(['FILE_SECRET_V1', 'INHERITED_SECRET_V1']);
      expect(process.env.FROM_FILE).toBe('fil');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('refresh re-captures pointers added after an empty boot', () => {
  it('picks up a pointer set into process.env after a zero-pointer boot', async () => {
    Reflect.deleteProperty(process.env, 'LATE_KEY');
    const fetchImpl = okFetch({ LATE_SECRET_V1: 'late' });

    //? Boot finds no pointers.
    await initSecretManager(baseConfig({ fetchImpl }));
    expect(fetchImpl).not.toHaveBeenCalled();

    //? A pointer appears after init.
    process.env.LATE_KEY = 'LATE_SECRET_V1';
    await refreshSecretManager();

    expect(process.env.LATE_KEY).toBe('late');
    expect(bodyOf(fetchImpl).keys).toEqual(['LATE_SECRET_V1']);
  });
});

describe('response body size cap (SM — OOM guard)', () => {
  it('rejects a response whose Content-Length exceeds the cap', async () => {
    process.env.BIG_KEY = 'BIG_SECRET_V1';
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json(
          { values: { BIG_SECRET_V1: 'v' } },
          { status: 200, headers: { 'content-length': String(2_000_000) } },
        ),
      ),
    );

    await expect(initSecretManager(baseConfig({ fetchImpl }))).rejects.toThrow(/too large/);
    expect(process.env.BIG_KEY).toBe('BIG_SECRET_V1');
  });
});

describe('hook isolation (onApplied / onResolveError)', () => {
  it('a throwing onApplied does not abort an otherwise-successful resolve', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(swallowWarn);
    process.env.HI_KEY = 'HI_SECRET_V1';
    const fetchImpl = okFetch({ HI_SECRET_V1: 'real' });
    const onApplied = vi.fn(() => {
      throw new Error('hook boom');
    });

    await expect(
      initSecretManager(baseConfig({ fetchImpl, onApplied })),
    ).resolves.toBeUndefined();
    //? Resolve still applied + cached despite the throwing hook.
    expect(process.env.HI_KEY).toBe('real');
    expect(getCachedResolution()?.values.HI_SECRET_V1).toBe('real');
    expect(onApplied).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('a throwing onResolveError does not mask the original remote-mode error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(swallowWarn);
    process.env.HE_KEY = 'HE_SECRET_V1';
    const fetchImpl = rejectingFetch(new Error('network down'));
    const onResolveError = vi.fn(() => {
      throw new Error('hook boom');
    });

    //? The ORIGINAL transport error must surface, not the hook's throw.
    await expect(
      initSecretManager(baseConfig({ fetchImpl, onResolveError })),
    ).rejects.toThrow('network down');
    expect(warn).toHaveBeenCalled();
  });
});

describe('getCachedResolutionMeta — values-free diagnostic', () => {
  it('returns pointer names + count without exposing secret values', async () => {
    process.env.MK_KEY = 'MK_SECRET_V1';
    const fetchImpl = okFetch({ MK_SECRET_V1: 'sk-real' });

    expect(getCachedResolutionMeta()).toBeNull();
    await initSecretManager(baseConfig({ fetchImpl }));

    const meta = getCachedResolutionMeta();
    expect(meta?.pointerNames).toEqual(['MK_SECRET_V1']);
    expect(meta?.pointerCount).toBe(1);
    expect(typeof meta?.fetchedAt).toBe('number');
    //? The secret value never appears in the meta view.
    expect(JSON.stringify(meta)).not.toContain('sk-real');
  });
});

describe('production rotation poll (SM-14)', () => {
  it('polls in production via top-level pollIntervalMs', async () => {
    vi.useFakeTimers();
    try {
      process.env.NODE_ENV = 'production';
      process.env.PR_KEY = 'PR_SECRET_V1';
      const fetchImpl = okFetch({ PR_SECRET_V1: 'v' });

      await initSecretManager(baseConfig({ fetchImpl, pollIntervalMs: 1000 }));
      expect(fetchImpl).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('dev hot-reload env gate (SM-04)', () => {
  it('does not start the dev poll in a non-dev env', async () => {
    vi.useFakeTimers();
    const prevNodeEnv = process.env.NODE_ENV;
    const prevLuckyEnv = process.env.LUCKYSTACK_ENV;
    try {
      //? Resolve a non-dev env through the canonical `resolveEnvKey()`
      //? (`LUCKYSTACK_ENV ?? NODE_ENV ?? 'development'`): clear the higher-priority
      //? override and set an explicit 'staging' so the gate sees non-dev. An UNSET
      //? env would resolve to 'development' and (correctly) start the poll.
      Reflect.deleteProperty(process.env, 'LUCKYSTACK_ENV');
      process.env.NODE_ENV = 'staging';
      process.env.DG_KEY = 'DG_SECRET_V1';
      const fetchImpl = okFetch({ DG_SECRET_V1: 'v' });

      await initSecretManager(
        baseConfig({ fetchImpl, dev: { watch: false, pollIntervalMs: 1000 } }),
      );
      expect(fetchImpl).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(5000);
      //? Non-dev env is gated out — poll never starts.
      expect(fetchImpl).toHaveBeenCalledOnce();
    } finally {
      if (prevNodeEnv === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevLuckyEnv === undefined) Reflect.deleteProperty(process.env, 'LUCKYSTACK_ENV');
      else process.env.LUCKYSTACK_ENV = prevLuckyEnv;
      vi.useRealTimers();
    }
  });
});

describe('reloadSecretManagerFromFiles atomicity (SM-09a)', () => {
  it('does not inject plain values when a pointer fails to resolve in remote mode', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sm-atomic-'));
    const envFile = join(dir, 'env');
    writeFileSync(envFile, 'PLAIN_CFG=injected\nNEEDS=NEEDS_SECRET_V9\n');
    process.env.NODE_ENV = 'production'; //? avoid real fs.watchers
    //? Server resolves nothing -> remote-mode throw.
    const fetchImpl = okFetch({});

    try {
      await initSecretManager(baseConfig({ fetchImpl, dev: { envFiles: [envFile] } }));
      await expect(reloadSecretManagerFromFiles()).rejects.toThrow(/did not resolve/);
      //? Atomic: the plain value must NOT have been applied before the throw.
      expect(process.env.PLAIN_CFG).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

//? The decoupled framework channel (ADR 0026): after resolving, secret-manager
//? fires every listener published on the well-known global-symbol array — this is
//? what makes `@luckystack/core` rebuild the Redis client from the resolved env
//? with zero consumer code, without secret-manager importing core.
describe('framework secrets-resolved channel (global symbol)', () => {
  const SYMBOL = Symbol.for('luckystack.secretsResolved.listeners');

  it('fires the global listeners with the CHANGED env NAMES after a resolve', async () => {
    process.env.REDIS_PASSWORD = 'REDIS_PASSWORD_V1';
    const seen: (readonly string[])[] = [];
    const listener = (names: readonly string[]): void => {
      seen.push(names);
    };
    const list: unknown[] = Array.isArray(Reflect.get(globalThis, SYMBOL))
      ? (Reflect.get(globalThis, SYMBOL) as unknown[])
      : [];
    Reflect.set(globalThis, SYMBOL, list);
    list.push(listener);
    try {
      await initSecretManager(
        baseConfig({ fetchImpl: okFetch({ REDIS_PASSWORD_V1: 'sk-resolved' }) }),
      );
      expect(process.env.REDIS_PASSWORD).toBe('sk-resolved');
      expect(seen).toHaveLength(1);
      expect(seen[0]).toContain('REDIS_PASSWORD');
    } finally {
      const idx = list.indexOf(listener);
      if (idx >= 0) list.splice(idx, 1);
    }
  });

  it('does NOT fire when nothing actually changed (no pointers resolved)', async () => {
    let fired = 0;
    const listener = (): void => {
      fired += 1;
    };
    const list: unknown[] = Array.isArray(Reflect.get(globalThis, SYMBOL))
      ? (Reflect.get(globalThis, SYMBOL) as unknown[])
      : [];
    Reflect.set(globalThis, SYMBOL, list);
    list.push(listener);
    try {
      //? No pointer-shaped env value → zero changes → no fire.
      await initSecretManager(baseConfig({ fetchImpl: okFetch({}) }));
      expect(fired).toBe(0);
    } finally {
      const idx = list.indexOf(listener);
      if (idx >= 0) list.splice(idx, 1);
    }
  });
});
