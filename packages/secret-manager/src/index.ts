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
import path from 'node:path';

import { tryCatchSync } from '@luckystack/core';

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

//? Dev hot-reload reads these files and injects their values into `process.env`.
//? `dev.envFiles` is consumer config (not runtime user input), so an ABSOLUTE
//? path is treated as an explicit, allowed choice (e.g. a shared secrets file).
//? A RELATIVE path, however, must stay within the project root — reject `..`
//? traversal (the plausible "injected via a relative path" escape). The caller
//? skips + warns on a rejected entry (fail-open, consistent with the package's
//? swallow-on-missing-file behaviour).
const isSafeEnvFile = (file: string): boolean => {
  if (path.isAbsolute(file)) return true;
  const rel = path.relative(process.cwd(), path.resolve(process.cwd(), file));
  return !rel.startsWith('..');
};

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

const validateUrl = (url: string): void => {
  //? Reject relative / non-http(s) URLs (e.g. `file://`) up front so the resolve
  //? endpoint can't be pointed at the local filesystem or another protocol.
  const [parseError, parsed] = tryCatchSync(() => new URL(url));
  if (parseError || !parsed) {
    throw new Error(`[secret-manager] Invalid \`url\`: "${url}" is not an absolute URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`[secret-manager] Invalid \`url\` scheme "${parsed.protocol}": only http(s) is supported.`);
  }
};

const capturePointers = (pattern: RegExp): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (typeof value === 'string' && pattern.test(value)) {
      map[name] = value;
    }
  }
  return map;
};

const validateToken = (token: string): string => {
  //? An empty/whitespace token yields an `Authorization: Bearer ` header that
  //? silently auth-fails (and in hybrid mode falls back to local env) — reject it.
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    throw new Error('[secret-manager] Bearer token is empty or whitespace-only.');
  }
  //? The `Bearer ` scheme is added at the call site; a token that already carries
  //? it produces a malformed `Bearer Bearer <...>` header — warn but don't mutate.
  if (/^bearer\s/i.test(trimmed)) {
    console.warn('[secret-manager] Token starts with a "Bearer " prefix; the scheme is added automatically — drop the prefix from the configured token.');
  }
  return trimmed;
};

const resolveToken = (token: SecretManagerToken): string => {
  if (typeof token === 'string') return validateToken(token);
  let raw: string;
  try {
    raw = readFileSync(token.fromFile, 'utf8');
  } catch (error) {
    //? Distinguish a missing/deleted file from other I/O errors so a dev
    //? hot-reload poll over a transiently-absent token file gives a clear log.
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') {
      throw new Error(`[secret-manager] Token file not found: "${token.fromFile}".`);
    }
    throw new Error(`[secret-manager] Failed to read token file "${token.fromFile}": ${String((error as Error | undefined)?.message ?? error)}`);
  }
  return validateToken(raw);
};

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

  //? Parse as `unknown`, then narrow `values` with a runtime guard rather than
  //? trusting an up-front cast — the response is attacker-influenced (a
  //? compromised/buggy server) so its shape is not assumed.
  const body: unknown = await response.json();
  const values = (body as { values?: unknown } | null)?.values;
  if (values === null || typeof values !== 'object') {
    throw new Error('[secret-manager] Resolve response missing `values` object.');
  }

  //? Filter the response down to the pointers we actually requested. A
  //? compromised/buggy server could otherwise inject extra keys that get cached
  //? (and surfaced via getCachedResolution); only requested pointers are trusted.
  const requested = new Set(pointers);
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(values as Record<string, string>)) {
    if (requested.has(key)) filtered[key] = value;
  }
  return filtered;
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

  //? Capture once on first resolve and reuse: the first resolve OVERWRITES the
  //? env value with the real secret, after which it no longer looks like a pointer.
  const activePointerMap = (pointerMap ??= capturePointers(config.pointerPattern ?? DEFAULT_POINTER_PATTERN));
  const pointers = [...new Set(Object.values(activePointerMap))];
  if (pointers.length === 0) {
    cachedResolution = { fetchedAt: Date.now(), values: {} };
    return;
  }

  //? CC-7 exemption (no-raw-try-catch): the async framework `tryCatch` auto-captures
  //? to the error tracker, but this is a deliberate fail-OPEN boot-time guard in an
  //? intentionally dependency-light client — a 'hybrid' resolve failure must stay a
  //? silent warn with NO error-tracker side-effect (and 'remote' re-throws untouched
  //? for a hard boot stop). `tryCatchSync` can't wrap the `await`, so the raw
  //? try/catch is kept on purpose; the fail-OPEN contract is the load-bearing detail.
  try {
    const values = await fetchResolve(config, pointers);
    applyResolved(activePointerMap, values, source);
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
    //? Restrict to POSIX-shell env-var names. `.`/`-` keys can't be read via the
    //? normal `process.env.NAME` lookup, so accepting them is a silent footgun.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      console.warn(`[secret-manager] Ignoring env key "${key}": not a valid environment variable name (^[A-Za-z_][A-Za-z0-9_]*$).`);
      continue;
    }
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
      if (!isSafeEnvFile(file)) {
        console.warn(`[secret-manager] ignoring unsafe dev envFile path (must be relative + within the project): ${file}`);
        continue;
      }
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
  //? Only validate the URL when we'll actually hit the network ('remote' /
  //? 'hybrid'); 'local' short-circuits above and may carry a placeholder url.
  validateUrl(config.url);
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
    if (!isSafeEnvFile(file)) {
      console.warn(`[secret-manager] ignoring unsafe dev envFile path: ${file}`);
      continue;
    }
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
