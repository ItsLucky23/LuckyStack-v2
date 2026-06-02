//? @luckystack/secret-manager — rotation-aware secret resolver client.
//?
//? Idea: secrets live in a central secret-manager server (append-only,
//? versioned, one shared bearer token). Apps commit their `.env` to git, but
//? instead of real secrets it holds POINTERS:
//?
//?   OPENAI_KEY=OPENAI_AUTHORIZATION_KEY_V5
//?
//? A pointer has the shape `<BASE>_V<number>`. At boot this client scans
//? `process.env`, collects every pointer-shaped value, asks the server to
//? resolve them in ONE request, and overwrites each `process.env` entry with
//? the real secret — so downstream code reads `process.env.OPENAI_KEY` and gets
//? the resolved value, not the pointer. Rotating a secret means publishing a
//? new version (`..._V6`) on the server, never editing an old one, so old git
//? branches that still point at `..._V5` keep booting.
//?
//? Three modes:
//?   1. `source: 'remote'` (default) — resolve from the server. A missing
//?      pointer or an unreachable server throws — production hard-stop.
//?   2. `source: 'local'` — no network. Pointers are left untouched. Use in
//?      tests / offline dev when the server isn't reachable.
//?   3. `source: 'hybrid'` — try the server, but on failure warn and leave
//?      whatever `process.env` already holds. Use for staging / canary.
//?
//? Optional dev-only hot reload (`config.dev`) re-resolves on `.env` file
//? changes and/or on an interval, so server-side rotations are picked up
//? without restarting a long-running dev process. It is a no-op in production.

import { readFileSync, watch as fsWatch, type FSWatcher } from 'node:fs';

/** Bearer token: a literal string, or a file whose entire contents are the token. */
export type SecretManagerToken = string | { fromFile: string };

export interface SecretManagerConfig {
  /** Base URL of the secret-manager server (trailing slash optional). */
  url: string;
  /**
   * Shared bearer token. Either the literal string or `{ fromFile }` pointing
   * at a gitignored file whose entire contents are the token (read at resolve
   * time, so rotating the file is picked up by the next poll / refresh).
   */
  token: SecretManagerToken;
  /** Resolution mode. Default `'remote'`. */
  source?: 'remote' | 'local' | 'hybrid';
  /**
   * Override the pointer-shape detector. Any `process.env` value matching this
   * is treated as a pointer; anything else is a literal and left untouched.
   * Default `/^(.+)_V(\d+)$/`.
   */
  pointerPattern?: RegExp;
  /** Override the global `fetch` (tests / non-Node-20 hosts). */
  fetchImpl?: typeof fetch;
  /**
   * Opt-in dev-only hot reload. Ignored when `NODE_ENV === 'production'`.
   * Provide an (even empty) object to enable it.
   */
  dev?: {
    /**
     * Watch the env files and hot-reload on change. Default `true`. On change
     * the files are re-parsed and applied: plain (non-pointer) values are
     * injected straight into `process.env` (live config reload), and
     * pointer-shaped values are re-resolved against the server. Requires the
     * optional `dotenv` peer to parse the files.
     */
    watch?: boolean;
    /** Re-resolve the current pointers every N ms (server-rotation poll). Default `0` (disabled). */
    pollIntervalMs?: number;
    /** Env files to watch + reparse, in load order (later overrides earlier). Default `['.env', '.env.local']`. */
    envFiles?: string[];
  };
}

export interface CachedResolution {
  /** `Date.now()` of the last successful resolve. */
  fetchedAt: number;
  /** Map of pointer string -> resolved value (what the server returned). */
  values: Record<string, string>;
}

const DEFAULT_POINTER_PATTERN = /^(.+)_V(\d+)$/;
const DEFAULT_ENV_FILES = ['.env', '.env.local'];

//? Module state. The resolver is meant to run once per process at boot; these
//? bindings keep it idempotent and let dev hot-reload re-resolve later.
let cachedResolution: CachedResolution | null = null;
//? envName -> pointer string, captured once on first resolve. Reused on every
//? refresh because the first resolve OVERWRITES the env value with the real
//? secret, after which it no longer looks like a pointer.
let pointerMap: Record<string, string> | null = null;
let activeConfig: SecretManagerConfig | null = null;

//? Dev hot-reload handles, torn down by resetSecretManagerForTests.
let devReloadStarted = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const fileWatchers: FSWatcher[] = [];

const capturePointers = (pattern: RegExp): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (typeof value === 'string' && pattern.test(value)) {
      map[name] = value;
    }
  }
  return map;
};

const resolveToken = (token: SecretManagerToken): string =>
  typeof token === 'string' ? token : readFileSync(token.fromFile, 'utf8').trim();

const fetchResolve = async (
  config: SecretManagerConfig,
  pointers: string[],
): Promise<Record<string, string>> => {
  //? Defaults to the Node 20+ global fetch; pass fetchImpl for older hosts.
  const fetchFn = config.fetchImpl ?? globalThis.fetch;
  const endpoint = `${config.url.replace(/\/+$/, '')}/resolve`;
  const response = await fetchFn(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resolveToken(config.token)}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ keys: pointers }),
  });

  if (!response.ok) {
    throw new Error(`[secret-manager] Resolve request failed: ${String(response.status)} ${response.statusText}`);
  }

  const body = await response.json() as { values?: Record<string, string> };
  if (!body.values || typeof body.values !== 'object') {
    throw new Error('[secret-manager] Resolve response missing `values` object.');
  }

  return body.values;
};

const applyResolved = (
  map: Record<string, string>,
  values: Record<string, string>,
  source: 'remote' | 'hybrid',
): void => {
  //? In remote mode a single unresolved pointer is a hard boot failure. Check
  //? everything BEFORE mutating process.env so the failure is atomic.
  if (source === 'remote') {
    const missing = Object.entries(map).filter(([, pointer]) => values[pointer] === undefined);
    if (missing.length > 0) {
      const detail = missing.map(([name, pointer]) => `${pointer} (referenced by ${name})`).join(', ');
      throw new Error(`[secret-manager] Server did not resolve: ${detail}.`);
    }
  }

  for (const [name, pointer] of Object.entries(map)) {
    const value = values[pointer];
    if (value === undefined) {
      //? hybrid only — leave the pointer in place and warn so the operator sees it.
      console.warn(`[secret-manager] Pointer "${pointer}" (referenced by ${name}) not resolved; leaving "${name}" as-is.`);
      continue;
    }
    process.env[name] = value;
  }
};

const doResolve = async (config: SecretManagerConfig): Promise<void> => {
  const source = config.source ?? 'remote';
  if (source === 'local') return;

  pointerMap ??= capturePointers(config.pointerPattern ?? DEFAULT_POINTER_PATTERN);
  const pointers = [...new Set(Object.values(pointerMap))];
  if (pointers.length === 0) {
    cachedResolution = { fetchedAt: Date.now(), values: {} };
    return;
  }

  try {
    const values = await fetchResolve(config, pointers);
    applyResolved(pointerMap, values, source);
    cachedResolution = { fetchedAt: Date.now(), values };
  } catch (error) {
    if (source === 'hybrid') {
      console.warn('[secret-manager] Resolve failed, leaving local env as-is:', error);
      return;
    }
    throw error;
  }
};

//? Minimal .env parser kept in-package so the resolver stays dependency-free.
//? Handles standard `KEY=VALUE` lines, full-line + inline (` #`) comments, and
//? single/double-quoted values. Not multi-line values or escape sequences.
const parseEnvFile = (content: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[\w.-]+$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1);
    } else {
      const commentAt = value.indexOf(' #');
      if (commentAt !== -1) value = value.slice(0, commentAt).trim();
      if (value.startsWith('#')) value = '';
    }
    out[key] = value;
  }
  return out;
};

const scheduleReload = (): void => {
  //? Debounce — fs.watch can fire several events for one save.
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void reloadSecretManagerFromFiles().catch((error: unknown) => {
      console.warn('[secret-manager] dev reload failed:', error);
    });
  }, 200);
  debounceTimer.unref();
};

const startDevReload = (config: SecretManagerConfig): void => {
  if (devReloadStarted || config.dev === undefined) return;
  if (process.env.NODE_ENV === 'production') return;

  const watch = config.dev.watch ?? true;
  const pollIntervalMs = config.dev.pollIntervalMs ?? 0;
  if (!watch && pollIntervalMs <= 0) return;
  devReloadStarted = true;

  if (watch) {
    for (const file of config.dev.envFiles ?? DEFAULT_ENV_FILES) {
      try {
        const watcher = fsWatch(file, () => {
          scheduleReload();
        });
        watcher.unref();
        fileWatchers.push(watcher);
      } catch {
        //? The file may not exist (e.g. no .env.local) — nothing to watch.
      }
    }
  }

  if (pollIntervalMs > 0) {
    pollTimer = setInterval(() => {
      void refreshSecretManager().catch((error: unknown) => {
        console.warn('[secret-manager] poll refresh failed:', error);
      });
    }, pollIntervalMs);
    pollTimer.unref();
  }
};

/**
 * Initialize the secret-manager resolver. Call once as the very first line of
 * `server.ts`, BEFORE any other framework code reads `process.env`. In
 * `'remote'` / `'hybrid'` mode the resolved secrets are written into
 * `process.env` before this resolves, so downstream code sees them via the
 * standard `process.env.FOO` lookup. In `'local'` mode it is a no-op.
 */
export const initSecretManager = async (config: SecretManagerConfig): Promise<void> => {
  activeConfig = config;
  if ((config.source ?? 'remote') === 'local') return;
  await doResolve(config);
  startDevReload(config);
};

/**
 * Re-resolve against the server, ignoring nothing — used by the dev hot-reload
 * watch/poll and callable manually when an admin rotates a secret and you want
 * a long-running process to pick it up without a restart.
 */
export const refreshSecretManager = async (): Promise<void> => {
  if (!activeConfig || (activeConfig.source ?? 'remote') === 'local') return;
  await doResolve(activeConfig);
};

/**
 * Dev hot-reload entry: re-parse the configured env files and apply them — plain
 * (non-pointer) values are injected straight into `process.env` (live config
 * reload), pointer-shaped values are re-resolved against the server. Wired to the
 * `.env` / `.env.local` file watch; also callable manually.
 */
export const reloadSecretManagerFromFiles = async (): Promise<void> => {
  const config = activeConfig;
  if (!config || (config.source ?? 'remote') === 'local') return;

  const files = config.dev?.envFiles ?? DEFAULT_ENV_FILES;
  const pattern = config.pointerPattern ?? DEFAULT_POINTER_PATTERN;

  //? Re-read every file in load order; later files (e.g. .env.local) override.
  const merged: Record<string, string> = {};
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue; //? file may not exist (e.g. no .env.local)
    }
    Object.assign(merged, parseEnvFile(content));
  }

  //? Plain values inject directly (live config reload); pointer-shaped values go
  //? to the server. Swap in the fresh pointer set so this resolve + later polls
  //? use it (this is also how a pointer added after boot gets picked up).
  const freshPointerMap: Record<string, string> = {};
  for (const [name, value] of Object.entries(merged)) {
    if (pattern.test(value)) {
      freshPointerMap[name] = value;
    } else {
      process.env[name] = value;
    }
  }
  pointerMap = freshPointerMap;
  await doResolve(config);
};

/** Read the last `{ fetchedAt, values }` resolution (pointer -> value), or `null`. */
export const getCachedResolution = (): CachedResolution | null => cachedResolution;

/** Test-only — clear module state and tear down any dev watchers / timers. */
export const resetSecretManagerForTests = (): void => {
  cachedResolution = null;
  pointerMap = null;
  activeConfig = null;
  devReloadStarted = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  for (const watcher of fileWatchers) {
    watcher.close();
  }
  fileWatchers.length = 0;
};
