//? @luckystack/env-resolver — remote env-server client with .env fallback.
//?
//? Idea: env-config lives in a central server with version management,
//? audit history, and git-able exports. Apps fetch their resolved env-map
//? at boot using a single LUCKYSTACK_ENV_TOKEN, eliminating per-app .env
//? sprawl while keeping traditional .env loading as an opt-in fallback.
//?
//? Three modes:
//?   1. `source: 'local'` — no remote calls. The resolver writes nothing,
//?      lets your existing dotenv setup keep running. Useful for tests +
//?      local dev when the remote server isn't reachable.
//?   2. `source: 'remote'` — fetch from the remote server. Failure throws.
//?      Suitable for production where misconfigured env is a hard stop.
//?   3. `source: 'hybrid'` — try remote, fall back to local on failure.
//?      Suitable for staging / canary deployments where you want best-effort.
//?
//? After init, every fetched key is written to `process.env` so downstream
//? code that reads `process.env.FOO` works without any code changes.

export interface RemoteEnvOptions {
  /** URL of the remote env server (no trailing slash). */
  url: string;
  /** Auth token. Read from `LUCKYSTACK_ENV_TOKEN` by default. */
  authToken: string;
  /** Project key on the remote (`my-app`). Read from `LUCKYSTACK_ENV_PROJECT`. */
  project: string;
  /** Environment slug (`production`, `staging`, etc.). Read from `LUCKYSTACK_ENV_ENVIRONMENT`. */
  environment: string;
  /** Local cache TTL in ms. Default 60s. */
  cacheTtlMs?: number;
  /**
   * Fetch implementation. Defaults to the global `fetch` (Node 20+).
   * Override for tests or for environments without global fetch.
   */
  fetchImpl?: typeof fetch;
}

export interface InitEnvResolverOptions {
  source: 'remote' | 'local' | 'hybrid';
  remote?: RemoteEnvOptions;
  /** Behavior on remote failure when source !== 'local'. */
  fallback?: 'local' | 'throw';
}

interface CachedResolution {
  fetchedAt: number;
  values: Record<string, string>;
}

let cachedResolution: CachedResolution | null = null;

const readEnv = (key: string): string | undefined => process.env[key];

const buildOptionsFromEnv = (): RemoteEnvOptions | null => {
  const url = readEnv('LUCKYSTACK_ENV_URL');
  const authToken = readEnv('LUCKYSTACK_ENV_TOKEN');
  const project = readEnv('LUCKYSTACK_ENV_PROJECT');
  const environment = readEnv('LUCKYSTACK_ENV_ENVIRONMENT');
  if (!url || !authToken || !project || !environment) return null;
  return { url, authToken, project, environment };
};

const applyValues = (values: Record<string, string>): void => {
  for (const [key, value] of Object.entries(values)) {
    //? Do not overwrite a key that was set explicitly via .env or shell.
    //? Local overrides win — this lets developers shadow individual remote
    //? values during debugging without affecting their team.
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
};

const fetchRemoteEnv = async (opts: RemoteEnvOptions): Promise<Record<string, string>> => {
  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  if (!fetchFn) {
    throw new Error('[env-resolver] No fetch implementation available. Pass `fetchImpl` or run on Node 20+.');
  }

  const endpoint = `${opts.url.replace(/\/+$/, '')}/projects/${encodeURIComponent(opts.project)}/environments/${encodeURIComponent(opts.environment)}`;
  const response = await fetchFn(endpoint, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${opts.authToken}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`[env-resolver] Remote env fetch failed: ${String(response.status)} ${response.statusText}`);
  }

  const body = await response.json() as { values?: Record<string, string> };
  if (!body.values || typeof body.values !== 'object') {
    throw new Error('[env-resolver] Remote env response missing `values` object.');
  }

  return body.values;
};

/**
 * Initialize the env resolver. Call once at the very top of `server.ts`
 * BEFORE any other framework code reads `process.env`. In 'remote' /
 * 'hybrid' mode, the function writes fetched values into `process.env`
 * before returning, so downstream code sees them via the standard
 * `process.env.FOO` lookup.
 *
 * Idempotent within the cache TTL — repeated calls reuse the cached
 * resolution and don't re-hit the remote server.
 */
export const initEnvResolver = async (options: InitEnvResolverOptions): Promise<void> => {
  if (options.source === 'local') {
    return;
  }

  const resolvedOpts = options.remote ?? buildOptionsFromEnv();
  if (!resolvedOpts) {
    if (options.fallback === 'local') {
      return;
    }
    throw new Error(
      '[env-resolver] Remote source selected but no remote options + no LUCKYSTACK_ENV_URL/TOKEN/PROJECT/ENVIRONMENT in env.',
    );
  }

  const cacheTtlMs = resolvedOpts.cacheTtlMs ?? 60_000;
  const now = Date.now();
  if (cachedResolution && now - cachedResolution.fetchedAt < cacheTtlMs) {
    applyValues(cachedResolution.values);
    return;
  }

  try {
    const values = await fetchRemoteEnv(resolvedOpts);
    cachedResolution = { fetchedAt: now, values };
    applyValues(values);
  } catch (err) {
    if (options.fallback === 'local' || options.source === 'hybrid') {
      //? Soft failure — fall back to whatever the existing process.env
      //? already contains. Log so the operator sees a hybrid degradation.
      console.warn('[env-resolver] Remote fetch failed, falling back to local env:', err);
      return;
    }
    throw err;
  }
};

/**
 * Force a re-fetch from the remote server, ignoring the local cache. Use
 * during long-running processes when env-server admins push a hot config
 * change. The new values are applied to `process.env` immediately.
 */
export const refreshEnvResolver = async (options: InitEnvResolverOptions): Promise<void> => {
  cachedResolution = null;
  await initEnvResolver(options);
};

/** Read the cached resolution (or null when source === 'local' / never initialized). */
export const getCachedResolution = (): CachedResolution | null => cachedResolution;

/** Test-only helper — clear the in-memory cache between integration tests. */
export const resetEnvResolverForTests = (): void => {
  cachedResolution = null;
};
