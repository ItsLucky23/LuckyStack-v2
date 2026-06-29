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

import { resolveEnvKey, sleep, tryCatchSync } from '@luckystack/core';

/**
 * Bearer token: a literal string, or a file whose entire contents are the token.
 *
 * When using `{ fromFile }`, the path MUST NOT be derived from untrusted input.
 * No path-traversal check is applied — the caller is responsible for ensuring
 * the path is a fixed, gitignored file (e.g. `.secret-manager-token`) next to
 * the project root. Paths like `/etc/passwd` or `../../.ssh/id_rsa` would be
 * read without error.
 */
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
   * Default `/^(.+)_V(\d+)$/`. A `g`/`y` flag is stripped (a stateful regex would
   * misclassify alternating entries).
   */
  pointerPattern?: RegExp;
  /**
   * Scope which `process.env` entries are pointer-eligible by NAME. This allowlist
   * is REQUIRED to resolve anything off-host: an array of names or a predicate.
   *
   * SECURE DEFAULT: when unset, NOTHING is resolved off-host (a clear boot warning
   * is emitted instead). Scanning the entire inherited environment would POST any
   * unrelated, pointer-shaped inherited value (`RELEASE_TAG=build_2024_V2`) to the
   * secret-manager server — so an explicit allowlist is mandatory. To opt back into
   * scanning every name, pass `() => true` as a deliberate, auditable choice.
   */
  envNames?: string[] | ((name: string) => boolean);
  /**
   * Allow a plain-`http:` server `url`. By default only `https:` is accepted for
   * non-loopback hosts (the channel carries the bearer token + plaintext secrets);
   * loopback (`localhost`/`127.0.0.1`/`[::1]`) is always permitted. Set `true` to
   * permit `http:` to any host — a loud warning is still emitted.
   */
  allowInsecureHttp?: boolean;
  /**
   * Abort a resolve request that has not responded within this many ms. Prevents a
   * black-hole server (accepts the TCP connection, never responds) from hanging boot
   * until undici's ~300s default — and, in `'hybrid'`, from never reaching the
   * warn-and-keep-local fallback (a hang never rejects). Default `10_000`. Set `0`
   * to disable the timeout.
   */
  timeoutMs?: number;
  /**
   * Retry a failed resolve before giving up (transport error or non-2xx). Default
   * `{ count: 0 }` (no retry). After exhaustion `'remote'` still throws and
   * `'hybrid'` still warns-and-keeps-local.
   */
  retries?: { count: number; delayMs?: number };
  /** Override the resolve path appended to `url`. Default `'/resolve'`. */
  resolvePath?: string;
  /** Extra request headers merged onto every resolve request (cannot override `Authorization`). */
  headers?: Record<string, string>;
  /**
   * Called after a resolve writes new values into `process.env`, with ONLY the env
   * NAMES whose value actually changed (never the secret values). A client that
   * captured a secret at construction time (Prisma from `DATABASE_URL`, a Redis /
   * Stripe / OpenAI SDK) can re-create its pool/client here so a rotation lands.
   */
  onApplied?: (changes: { name: string; pointer: string }[]) => void | Promise<void>;
  /**
   * Called when a resolve fails, alongside the existing `console.warn` (current
   * behavior is unchanged when unset). Route the failure to Sentry/metrics —
   * useful for `'hybrid'`/dev where a failure otherwise silently keeps stale env.
   */
  onResolveError?: (error: unknown, context: { phase: 'boot' | 'refresh' | 'file-reload' }) => void;
  /** Override the global `fetch` (tests / non-Node-20 hosts). */
  fetchImpl?: typeof fetch;
  /**
   * Re-resolve the current pointers every N ms in ALL environments (the production
   * rotation poll), distinct from the dev-only `dev.pollIntervalMs` file-watch
   * channel. Default `0` (disabled). Unref'd, so it never blocks process exit.
   */
  pollIntervalMs?: number;
  /**
   * Opt-in dev-only hot reload. Ignored when `NODE_ENV === 'production'`.
   * Provide an (even empty) object to enable it.
   */
  dev?: {
    /**
     * Watch the env files and hot-reload on change. Default `true`. On change
     * the files are re-parsed and applied: plain (non-pointer) values are
     * injected straight into `process.env` (live config reload), and
     * pointer-shaped values are re-resolved against the server.
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
//? path is treated as an explicit, allowed choice (e.g. a shared secrets file on
//? a developer machine). A RELATIVE path, however, must stay within the project
//? root — reject `..` traversal (the plausible "injected via a relative path"
//? escape). The caller skips + warns on a rejected entry (fail-open, consistent
//? with the package's swallow-on-missing-file behaviour).
//? Note: absolute paths are accepted without further validation. Consumers who
//? configure `dev.envFiles` with absolute paths take responsibility for ensuring
//? those paths are appropriate (e.g. a shared developer-machine secrets file).
//? A loud warn is emitted so the choice is never silent in logs.
const isSafeEnvFile = (file: string, warnAbsolute = false): boolean => {
  if (path.isAbsolute(file)) {
    if (warnAbsolute) {
      console.warn(
        `[secret-manager] dev.envFiles contains an absolute path: "${file}". Absolute paths are permitted as an explicit choice (e.g. a shared secrets file) but are not checked for safety. Ensure this path is intentional.`,
      );
    }
    return true;
  }
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

//? In-flight resolve, used to SERIALIZE concurrent resolves. Four channels can
//? funnel into `doResolve` (boot, the production rotation poll, the dev poll, the
//? dev file-watch + a manual `refreshSecretManager()`); without a guard a slow
//? in-flight resolve can land AFTER a newer one, leaving `process.env` and
//? `cachedResolution` disagreeing (stale secrets). Each call awaits the previous
//? one's settlement before starting, so resolves apply strictly in order.
let resolveChain: Promise<void> = Promise.resolve();

//? Dev hot-reload + rotation-poll handles, torn down by stopSecretManager.
let devReloadStarted = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let rotationPollTimer: ReturnType<typeof setInterval> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const fileWatchers: FSWatcher[] = [];

//? A consumer-supplied `pointerPattern` with a `g`/`y` flag makes `.test()`
//? stateful (advances `lastIndex`), silently misclassifying alternating entries.
//? Strip those flags up front; everything else is preserved.
const stripStatefulFlags = (pattern: RegExp): RegExp => {
  const flags = pattern.flags.replaceAll(/[gy]/g, '');
  return flags === pattern.flags ? pattern : new RegExp(pattern.source, flags);
};

//? No-op used to settle the in-flight resolve chain tail regardless of outcome.
const noop = (): void => {
  /* intentionally empty */
};

//? Reduce any thrown value to a safe message string for logging — never log the
//? raw error object (its `cause`/own-properties can carry a URL/token/PII string).
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

//? Invoke a consumer callback in isolation: a throwing hook must never abort an
//? otherwise-successful resolve or mask the original error. Failures are warned,
//? not propagated.
const runHook = (fn: () => void, label: string): void => {
  const [error] = tryCatchSync(fn);
  if (error) console.warn(`[secret-manager] ${label} callback threw (ignored):`, errorMessage(error));
};

//? Bound how long an async consumer hook may run before the resolve chain stops
//? waiting on it. A hook that NEVER resolves (a stuck `onApplied` awaiting a dead
//? pool) would otherwise wedge `resolveChain` forever, so every later resolve
//? (boot poll, dev watch, manual refresh) deadlocks behind it.
const HOOK_TIMEOUT_MS = 30_000;

//? Async sibling of `runHook` for a callback that may return a Promise (onApplied
//? re-creates pools/SDK clients). Awaited but isolated AND time-bounded — a
//? rejection/throw is warned (never propagated, so the resolve that already
//? applied stays successful), and a hook that HANGS is abandoned after
//? `timeoutMs` via a `Promise.race` (mirrors the fetch `AbortSignal.timeout`
//? black-hole guard) so a stuck hook can't deadlock the serialized resolve chain.
//? The race only stops AWAITING the hook — it cannot cancel the consumer's
//? promise, so a still-running hook keeps going in the background; we just no
//? longer block on it. `timeoutMs <= 0` disables the bound.
//? CC-7 exemption (no-raw-try-catch): `tryCatchSync` can't wrap an `await`, and
//? the async framework `tryCatch` would auto-capture to the error tracker — a
//? deliberate non-goal here (a consumer hook failure must stay a local warn in
//? this dependency-light client, not a tracked event).
const runHookAsync = async (
  fn: () => void | Promise<void>,
  label: string,
  timeoutMs = HOOK_TIMEOUT_MS,
): Promise<void> => {
  try {
    if (timeoutMs <= 0) {
      await fn();
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        console.warn(
          `[secret-manager] ${label} callback did not settle within ${String(timeoutMs)}ms; continuing without waiting (the hook may still be running in the background).`,
        );
        resolve();
      }, timeoutMs);
      timer.unref();
    });
    try {
      await Promise.race([Promise.resolve(fn()), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (error) {
    console.warn(`[secret-manager] ${label} callback threw (ignored):`, errorMessage(error));
  }
};

//? RFC-style loopback hosts: plain http to these never leaves the machine, so it
//? is always permitted regardless of `allowInsecureHttp`.
const isLoopbackHost = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname === '::1' ||
  hostname === '[::1]';

const validateUrl = (url: string, allowInsecureHttp: boolean): void => {
  //? Reject relative / non-http(s) URLs (e.g. `file://`) up front so the resolve
  //? endpoint can't be pointed at the local filesystem or another protocol.
  const [parseError, parsed] = tryCatchSync(() => new URL(url));
  if (parseError || !parsed) {
    throw new Error(`[secret-manager] Invalid \`url\`: "${url}" is not an absolute URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`[secret-manager] Invalid \`url\` scheme "${parsed.protocol}": only http(s) is supported.`);
  }
  //? The channel carries the bearer token + plaintext secrets, so plain http is a
  //? cleartext leak. Permit it only for loopback, or behind an explicit opt-in
  //? (still warned loudly) — otherwise reject before any secret is sent.
  if (parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname)) {
    if (!allowInsecureHttp) {
      throw new Error(
        `[secret-manager] Refusing plain-http \`url\` "${url}": the bearer token and resolved secrets would travel in cleartext. Use https, point at a loopback host, or set \`allowInsecureHttp: true\` to override.`,
      );
    }
    console.warn(
      `[secret-manager] Using plain-http transport to a non-loopback host ("${parsed.hostname}"): the bearer token and resolved secrets travel in CLEARTEXT. Prefer https.`,
    );
  }
};

//? Build the name-eligibility predicate from `envNames` (allowlist array or
//? predicate). SECURE DEFAULT: when `envNames` is unset, NOTHING is eligible —
//? the resolver must never scan the whole inherited environment and POST every
//? pointer-shaped value off-host. An explicit allowlist (or `() => true`) is
//? required to opt in. The boot-time warning for the unset case is emitted by
//? `warnIfEnvNamesUnset` at the resolve path.
const toNameFilter = (
  envNames: SecretManagerConfig['envNames'],
): ((name: string) => boolean) => {
  if (envNames === undefined) return () => false;
  if (typeof envNames === 'function') return envNames;
  const allow = new Set(envNames);
  return (name) => allow.has(name);
};

//? Warn ONCE per process when `envNames` is unset: the resolver is deny-all in
//? that state, so an operator who expected secrets to resolve gets a clear,
//? actionable boot message instead of a silent no-op. Guarded so the production
//? rotation poll (`refreshSecretManager` on an interval) doesn't re-emit it every
//? cycle and flood the log sink.
let warnedEnvNamesUnset = false;
const warnIfEnvNamesUnset = (envNames: SecretManagerConfig['envNames']): void => {
  if (envNames !== undefined || warnedEnvNamesUnset) return;
  warnedEnvNamesUnset = true;
  console.warn(
    '[secret-manager] `envNames` is not set: NO environment values will be resolved off-host. Set `envNames` to an allowlist of the env names to resolve (or `() => true` to deliberately scan every name).',
  );
};

//? Split a set of `{ name -> value }` entries into pointer-shaped vs plain
//? values, applying the `envNames` allowlist FIRST so a name excluded by
//? `envNames` is treated as neither a pointer nor a plain value (it is dropped
//? entirely). Shared by both ingest paths (boot `capturePointers` + the dev
//? file-reload split) so the scoping rule can never drift between them.
const splitPointers = (
  entries: Iterable<[string, string]>,
  pattern: RegExp,
  envNames: SecretManagerConfig['envNames'],
): { pointers: Record<string, string>; plain: Record<string, string> } => {
  const nameAllowed = toNameFilter(envNames);
  const pointers: Record<string, string> = {};
  const plain: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!nameAllowed(name)) continue;
    if (pattern.test(value)) pointers[name] = value;
    else plain[name] = value;
  }
  return { pointers, plain };
};

const capturePointers = (
  pattern: RegExp,
  envNames: SecretManagerConfig['envNames'],
): Record<string, string> => {
  const entries: [string, string][] = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (typeof value === 'string') entries.push([name, value]);
  }
  return splitPointers(entries, pattern, envNames).pointers;
};

const validateToken = (token: string): string => {
  //? An empty/whitespace token yields an `Authorization: Bearer ` header that
  //? silently auth-fails (and in hybrid mode falls back to local env) — reject it.
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    throw new Error('[secret-manager] Bearer token is empty or whitespace-only.');
  }
  //? The `Bearer ` scheme is added at the call site. A token that already carries
  //? it would produce a malformed double-prefix `Bearer Bearer <...>` header —
  //? strip the redundant prefix (case-insensitive) and warn so the operator knows
  //? their config is wrong. Stripping is the forgiving path: a warn-but-pass-through
  //? would silently break every request, making this a very hard-to-debug boot issue.
  if (/^bearer\s/i.test(trimmed)) {
    const stripped = trimmed.replace(/^bearer\s+/i, '');
    console.warn(
      '[secret-manager] Token starts with a "Bearer " prefix; the scheme is added automatically — the prefix was stripped. Drop it from your configured token to silence this warning.',
    );
    return stripped;
  }
  return trimmed;
};

const resolveToken = (token: SecretManagerToken): string => {
  if (typeof token === 'string') return validateToken(token);
  //? Distinguish a missing/deleted file from other I/O errors so a dev
  //? hot-reload poll over a transiently-absent token file gives a clear log.
  //? Note: error messages include `token.fromFile`. In hybrid mode these propagate
  //? to console.warn via `errorMessage(error)` (line ~597). If the path contains
  //? sensitive directory names (e.g. /home/admin/.keys/prod-token), those names
  //? will appear in log aggregators. Treat the token file path as infrastructure
  //? metadata and ensure your log sink is appropriately access-controlled.
  const [readError, raw] = tryCatchSync(() => readFileSync(token.fromFile, 'utf8'));
  if (readError) {
    const code = readError instanceof Error && 'code' in readError ? (readError as { code?: string }).code : undefined;
    if (code === 'ENOENT') {
      throw new Error(`[secret-manager] Token file not found: "${token.fromFile}".`);
    }
    throw new Error(`[secret-manager] Failed to read token file "${token.fromFile}": ${errorMessage(readError)}`);
  }
  if (raw === null) {
    throw new Error(`[secret-manager] Token file "${token.fromFile}" could not be read.`);
  }
  return validateToken(raw);
};

const DEFAULT_TIMEOUT_MS = 10_000;

//? Hard cap on the resolve response body. The server returns a flat
//? `{ pointer -> secret }` map; even hundreds of secrets stay well under 1 MB.
//? A response larger than this is a compromised/buggy server (or a MITM on an
//? `allowInsecureHttp` channel) and is rejected BEFORE it can OOM the client.
const MAX_RESOLVE_BODY_BYTES = 1_048_576;

//? Read the response body as text, aborting once more than `maxBytes` have been
//? received — so a server that lies about (or omits) Content-Length still can't
//? stream an unbounded body into memory. Falls back to `response.text()` when the
//? body isn't a readable stream (e.g. a mocked Response).
const readBodyCapped = async (response: Response, maxBytes: number): Promise<string> => {
  const body = response.body;
  if (!body) return response.text();
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      void reader.cancel();
      throw new Error(`[secret-manager] Resolve response exceeded the ${String(maxBytes)}-byte cap.`);
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
};

//? Drop any case-variant of `authorization` from consumer-supplied headers so the
//? framework bearer token always wins. A plain record passed as `fetch` `headers`
//? is filled with `append` (per the Fetch spec), so a lowercase `authorization`
//? key would NOT be overwritten by the later `Authorization` entry — both survive
//? and combine into `Bearer <consumer>, Bearer <framework>`. A server reading the
//? first token would then honour the consumer's value, bypassing the documented
//? "cannot override Authorization" guard. Stripping here makes the guard real for
//? every casing; all other consumer headers are preserved untouched.
const stripAuthorizationHeaders = (
  headers: Record<string, string> | undefined,
): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'authorization') continue;
    out[key] = value;
  }
  return out;
};

//? One resolve round-trip: POST the pointers, validate the response, return the
//? filtered `{ pointer -> value }` map. No retry/timeout orchestration here — the
//? caller (`fetchResolve`) owns that so a hang can't slip past the abort signal.
const fetchResolveOnce = async (
  config: SecretManagerConfig,
  pointers: string[],
): Promise<Record<string, string>> => {
  //? Defaults to the Node 20+ global fetch; pass fetchImpl for older hosts.
  const fetchFn = config.fetchImpl ?? globalThis.fetch;
  const resolvePath = config.resolvePath ?? '/resolve';
  const suffix = resolvePath.startsWith('/') ? resolvePath : `/${resolvePath}`;
  const endpoint = `${config.url.replace(/\/+$/, '')}${suffix}`;

  //? Abort a black-hole server (accepts the TCP connection, never responds) so a
  //? hang surfaces as a rejection — boot can't freeze, and 'hybrid' reaches its
  //? warn-and-keep-local fallback. `timeoutMs: 0` disables the abort entirely.
  //? Coerce defensively: a NaN/Infinity timeoutMs (e.g. a bad env parse) would
  //? make `timeoutMs > 0` false and silently DISABLE the black-hole abort,
  //? reintroducing the boot hang this guard exists to prevent. Mirror the retry
  //? path's finite-coercion.
  const rawTimeout = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutMs = Number.isFinite(rawTimeout) ? Math.max(0, rawTimeout) : DEFAULT_TIMEOUT_MS;
  const signal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;

  //? Consumer `headers` are merged first, with any case-variant of `authorization`
  //? stripped (`stripAuthorizationHeaders`) so the framework bearer token always
  //? wins — see that helper for why a lowercase key would otherwise leak through.
  //? `redirect: 'error'` fails closed on any 30x: `validateUrl` pins only the
  //? configured host, so following a redirect would carry the bearer token +
  //? request body to — and consume the resolved secrets from — an origin that was
  //? never validated (scheme/loopback/https checks don't re-apply to the hop). A
  //? legitimate `/resolve` endpoint never redirects; a 30x is a misconfig or an
  //? attack, and rejecting it keeps the whole exchange pinned to the checked origin.
  const response = await fetchFn(endpoint, {
    method: 'POST',
    headers: {
      ...stripAuthorizationHeaders(config.headers),
      'Authorization': `Bearer ${resolveToken(config.token)}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ keys: pointers }),
    redirect: 'error',
    signal,
  });

  if (!response.ok) {
    //? Discard the unconsumed error body so a long-lived poll loop can't leave
    //? response bodies pending GC; failures carry only status text upward.
    void response.body?.cancel();
    throw new Error(`[secret-manager] Resolve request failed: ${String(response.status)} ${response.statusText}`);
  }

  //? The resolve response is the network input this client trusts least (a
  //? compromised/buggy server, or a MITM on an `allowInsecureHttp` channel).
  //? Reject an oversized body BEFORE buffering/parsing it so a hostile server
  //? can't OOM the booting client. A Content-Length header is advisory (can be
  //? absent/lying), so it is a fast pre-check only — the real guard is the
  //? streamed byte cap below.
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESOLVE_BODY_BYTES) {
    void response.body?.cancel();
    throw new Error(`[secret-manager] Resolve response too large (${String(declaredLength)} bytes > ${String(MAX_RESOLVE_BODY_BYTES)} cap).`);
  }
  const raw = await readBodyCapped(response, MAX_RESOLVE_BODY_BYTES);

  //? Parse as `unknown`, then narrow `values` with a runtime guard rather than
  //? trusting an up-front cast — the response is attacker-influenced (a
  //? compromised/buggy server) so its shape is not assumed.
  const [parseError, body] = tryCatchSync((): unknown => JSON.parse(raw));
  if (parseError) {
    throw new Error('[secret-manager] Resolve response was not valid JSON.');
  }
  const values = (body as { values?: unknown } | null)?.values;
  if (values === null || typeof values !== 'object') {
    throw new Error('[secret-manager] Resolve response missing `values` object.');
  }

  //? Filter the response down to the pointers we actually requested, and require
  //? each value to be a string. A compromised/buggy server could otherwise inject
  //? extra keys (cached + surfaced via getCachedResolution) or a non-string that
  //? coerces to '123' / '[object Object]' once written into process.env — only
  //? requested, string-valued pointers are trusted; a non-string is dropped (and
  //? thus treated as an unresolved pointer downstream: fatal in 'remote', warned
  //? in 'hybrid').
  const requested = new Set(pointers);
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
    if (!requested.has(key)) continue;
    if (typeof value !== 'string') {
      console.warn(`[secret-manager] Pointer "${key}" resolved to a non-string value (${typeof value}); ignoring.`);
      continue;
    }
    filtered[key] = value;
  }
  return filtered;
};

const fetchResolve = async (
  config: SecretManagerConfig,
  pointers: string[],
): Promise<Record<string, string>> => {
  //? Defensive normalization: a configured `NaN` would make `attempt <= NaN` always
  //? false, so the loop body would never run. `lastError` is now pre-initialized
  //? (below) so we wouldn't `throw undefined` anymore, but coercing to a finite
  //? non-negative value is still the right guard — NaN retries is a config bug, not
  //? a valid "zero retries" signal.
  const rawRetryCount = config.retries?.count ?? 0;
  const retryCount = Number.isFinite(rawRetryCount) ? Math.max(0, rawRetryCount) : 0;
  const rawDelayMs = config.retries?.delayMs ?? 0;
  const delayMs = Number.isFinite(rawDelayMs) ? Math.max(0, rawDelayMs) : 0;

  let lastError: unknown = new Error('[secret-manager] resolve failed: no attempt was made');
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      return await fetchResolveOnce(config, pointers);
    } catch (error) {
      lastError = error;
      if (attempt < retryCount && delayMs > 0) await sleep(delayMs);
    }
  }
  throw lastError;
};

const applyResolved = (
  map: Record<string, string>,
  values: Record<string, string>,
  source: 'remote' | 'hybrid',
): { name: string; pointer: string }[] => {
  //? In remote mode a single unresolved pointer is a hard boot failure. Check
  //? everything BEFORE mutating process.env so the failure is atomic.
  if (source === 'remote') {
    const missing = Object.entries(map).filter(([, pointer]) => values[pointer] === undefined);
    if (missing.length > 0) {
      const detail = missing.map(([name, pointer]) => `${pointer} (referenced by ${name})`).join(', ');
      throw new Error(`[secret-manager] Server did not resolve: ${detail}.`);
    }
  }

  //? Track only the env NAMES whose value actually changed — surfaced to
  //? `onApplied` so a client that captured a secret at construction time can
  //? re-create its pool/SDK client. Never carries the secret values themselves.
  const changes: { name: string; pointer: string }[] = [];
  for (const [name, pointer] of Object.entries(map)) {
    const value = values[pointer];
    if (value === undefined) {
      //? hybrid only — leave the pointer in place and warn so the operator sees it.
      console.warn(`[secret-manager] Pointer "${pointer}" (referenced by ${name}) not resolved; leaving "${name}" as-is.`);
      continue;
    }
    if (process.env[name] !== value) changes.push({ name, pointer });
    process.env[name] = value;
  }
  return changes;
};

//? Public resolve entry: SERIALIZE every resolve behind a single in-flight chain
//? so a slow resolve can never land after a newer one (TOCTOU on `process.env` /
//? `cachedResolution`). We chain off `resolveChain.then(...)` regardless of whether
//? the prior resolve resolved or rejected, then re-publish the tail so the next
//? caller waits on THIS one. The returned promise mirrors the inner outcome so
//? `'remote'` still rejects the caller on a hard failure.
const doResolve = (
  config: SecretManagerConfig,
  phase: 'boot' | 'refresh' | 'file-reload',
): Promise<void> => {
  const run = resolveChain.then(
    () => doResolveInner(config, phase),
    () => doResolveInner(config, phase),
  );
  //? Keep the chain alive even if this resolve rejects (swallow on the tail copy
  //? only — the returned `run` keeps the original rejection for the caller).
  resolveChain = run.then(noop, noop);
  return run;
};

const doResolveInner = async (
  config: SecretManagerConfig,
  phase: 'boot' | 'refresh' | 'file-reload',
): Promise<void> => {
  const source = config.source ?? 'remote';
  if (source === 'local') return;

  //? Secure default: an unset `envNames` resolves NOTHING off-host — warn loudly
  //? on every resolve so the deny-all state is never silent (an operator who
  //? expected secrets to resolve sees exactly what to set).
  warnIfEnvNamesUnset(config.envNames);

  //? Capture once on first resolve and reuse: the first resolve OVERWRITES the
  //? env value with the real secret, after which it no longer looks like a pointer.
  //? Re-capture when the map is empty so a pointer that wasn't present at boot
  //? (e.g. set into `process.env` after init) is still picked up by a later
  //? refresh — a non-empty `{}` would otherwise pin the resolver to zero pointers.
  if (pointerMap === null || Object.keys(pointerMap).length === 0) {
    pointerMap = capturePointers(
      stripStatefulFlags(config.pointerPattern ?? DEFAULT_POINTER_PATTERN),
      config.envNames,
    );
  }
  const activePointerMap = pointerMap;
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
  let values: Record<string, string>;
  let changes: { name: string; pointer: string }[];
  try {
    values = await fetchResolve(config, pointers);
    changes = applyResolved(activePointerMap, values, source);
    cachedResolution = { fetchedAt: Date.now(), values };
  } catch (error) {
    //? Opt-in observability seam: route the failure to Sentry/metrics. Kept
    //? alongside (not replacing) the warn below so the fail-open default is unchanged.
    //? Hooks run isolated: a throwing/hanging `onResolveError` must not mask the
    //? original resolve error (it is re-thrown below in 'remote').
    runHook(() => config.onResolveError?.(error, { phase }), 'onResolveError');
    if (source === 'hybrid') {
      //? Log the message only — never the raw error object: error objects are the
      //? classic accidental channel for a URL/token/PII string reaching a log sink.
      //? Full-fidelity routing is the `onResolveError` hook's job.
      console.warn('[secret-manager] Resolve failed, leaving local env as-is:', errorMessage(error));
      return;
    }
    throw error;
  }

  //? Notify AFTER the cache + process.env are coherent so a consumer that reads
  //? process.env inside the callback sees the applied values. Isolated AND
  //? time-bounded by `runHookAsync` so a throwing `onApplied` can't abort an
  //? otherwise-successful resolve, AND a HANGING `onApplied` can't wedge the
  //? serialized resolve chain forever (it is abandoned after `HOOK_TIMEOUT_MS`,
  //? with a warn) — process.env + the cache are already written by this point.
  if (changes.length > 0) await runHookAsync(() => config.onApplied?.(changes), 'onApplied');
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
    if (quote === '"' || quote === "'") {
      //? Quoted value. The closing quote is the LAST occurrence of the same quote
      //? char; anything after it (whitespace + `# ...`) is an inline comment and is
      //? dropped (`KEY="v" # note` → `v`). A `#` BEFORE the closing quote is literal
      //? and preserved (`KEY="a#b"` → `a#b`).
      const closeIdx = value.lastIndexOf(quote);
      if (closeIdx > 0) {
        value = value.slice(1, closeIdx);
      } else {
        //? Opening quote with no matching closing quote on this line means a
        //? multi-line value (dotenv supports it, this parser does not). Warn so the
        //? value isn't silently truncated, then strip any inline comment from the
        //? raw remainder so a trailing `# ...` doesn't leak into the value.
        console.warn(
          `[secret-manager] parseEnvFile: "${key}" starts with a quote but has no matching closing quote on the same line. Multi-line values are not supported — the raw text will be used as-is. If this is a multi-line value (e.g. a PEM key), do not rely on this parser.`,
        );
        const commentAt = value.indexOf(' #');
        if (commentAt !== -1) value = value.slice(0, commentAt).trim();
      }
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
      console.warn('[secret-manager] dev reload failed:', errorMessage(error));
    });
  }, 200);
  debounceTimer.unref();
};

const startDevReload = (config: SecretManagerConfig): void => {
  if (devReloadStarted || config.dev === undefined) return;
  //? Allowlist the dev environments rather than exact-matching 'production': a
  //? 'prod' / 'staging' env must NOT silently start fs watchers + a poll on a
  //? host the operator believes is production. Only an explicit 'development' or
  //? 'test' enables dev hot reload (an unset env resolves to 'development' via
  //? the canonical `resolveEnvKey()`, so it counts as dev).
  const nodeEnv = resolveEnvKey();
  if (nodeEnv !== 'development' && nodeEnv !== 'test') return;

  const watch = config.dev.watch ?? true;
  const pollIntervalMs = config.dev.pollIntervalMs ?? 0;
  if (!watch && pollIntervalMs <= 0) return;
  devReloadStarted = true;

  if (watch) {
    for (const file of config.dev.envFiles ?? DEFAULT_ENV_FILES) {
      if (!isSafeEnvFile(file, true)) {
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
        console.warn('[secret-manager] poll refresh failed:', errorMessage(error));
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
  //? Validate the URL BEFORE recording activeConfig, so a failed init can't leave
  //? a later refreshSecretManager() resolving against an invalid config.
  if ((config.source ?? 'remote') !== 'local') {
    //? Only validate the URL when we'll actually hit the network ('remote' /
    //? 'hybrid'); 'local' may carry a placeholder url.
    validateUrl(config.url, config.allowInsecureHttp ?? false);
  }
  activeConfig = config;
  if ((config.source ?? 'remote') === 'local') return;
  await doResolve(config, 'boot');
  startRotationPoll(config);
  startDevReload(config);
};

//? Production-capable rotation poll: re-resolve every `config.pollIntervalMs` ms
//? in ALL environments (distinct from the dev-only `dev.pollIntervalMs` file-watch
//? channel, which is gated off in production). Unref'd so it never blocks exit.
const startRotationPoll = (config: SecretManagerConfig): void => {
  const intervalMs = config.pollIntervalMs ?? 0;
  if (intervalMs <= 0 || rotationPollTimer) return;
  rotationPollTimer = setInterval(() => {
    void refreshSecretManager().catch((error: unknown) => {
      console.warn('[secret-manager] rotation poll refresh failed:', errorMessage(error));
    });
  }, intervalMs);
  rotationPollTimer.unref();
};

/**
 * Re-resolve against the server, ignoring nothing — used by the dev hot-reload
 * watch/poll and callable manually when an admin rotates a secret and you want
 * a long-running process to pick it up without a restart.
 */
export const refreshSecretManager = async (): Promise<void> => {
  if (!activeConfig || (activeConfig.source ?? 'remote') === 'local') return;
  await doResolve(activeConfig, 'refresh');
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
  const pattern = stripStatefulFlags(config.pointerPattern ?? DEFAULT_POINTER_PATTERN);

  //? Re-read every file in load order; later files (e.g. .env.local) override.
  //? `warnAbsolute=false`: the absolute-path notice already fired once at boot
  //? (startDevReload). Repeating it on every debounced hot-reload would flood the
  //? dev log for anyone legitimately using an absolute envFile path.
  const merged: Record<string, string> = {};
  for (const file of files) {
    if (!isSafeEnvFile(file, false)) {
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

  //? Split plain (live config reload) from pointer-shaped values through the SAME
  //? `envNames` allowlist the boot path uses (`capturePointers`), so a name excluded
  //? by `envNames` is dropped on BOTH channels — never POSTed off-host as a pointer,
  //? never injected into `process.env` as a plain value. This closes the scoping
  //? drift where a file-reload could send/apply names the boot scan rejected.
  const { pointers: freshPointerMap, plain: plainValues } = splitPointers(
    Object.entries(merged),
    pattern,
    config.envNames,
  );

  //? MERGE the fresh file-sourced pointers over the existing map (don't replace):
  //? a pointer captured at boot from the inherited shell/CI env that isn't in a
  //? watched file would otherwise be dropped and stop rotating. A file-sourced
  //? pointer with the same name still wins.
  //? Build the merged map locally and commit it ONLY after a successful resolve so
  //? a failed remote reload can't permanently poison the in-memory pointer map and
  //? cause every subsequent refreshSecretManager / poll to resolve the bad set.
  const previousPointerMap = pointerMap;
  pointerMap = { ...pointerMap, ...freshPointerMap };

  //? Resolve the pointers FIRST. In 'remote' mode an unresolved pointer throws —
  //? mirror the atomic boot path and inject the plain values only AFTER a
  //? successful resolve, so a throw never leaves half-applied state. On failure
  //? roll back the pointer map to its pre-reload snapshot.
  try {
    await doResolve(config, 'file-reload');
  } catch (error) {
    pointerMap = previousPointerMap;
    throw error;
  }
  for (const [name, value] of Object.entries(plainValues)) {
    process.env[name] = value;
  }
};

/**
 * Read the last `{ fetchedAt, values }` resolution (pointer -> value), or `null`.
 *
 * ⚠️ SENSITIVE: `values` maps each pointer to its RAW resolved secret. The result
 * is a shallow copy (values are flat strings, so mutating the returned object does
 * not corrupt the cache), but the values are still the real secrets — NEVER
 * serialize the result into an HTTP response, a `/health` payload, or a log line.
 * For a safe diagnostic use {@link getCachedResolutionMeta}, which never exposes
 * the values.
 *
 * If you need to act on changed secrets (e.g. to rebuild a DB pool after rotation),
 * use the `onApplied` callback in `SecretManagerConfig` instead — it receives only
 * the changed env NAMES, never the secret values, and is called automatically after
 * each successful resolve.
 */
export const getCachedResolution = (): CachedResolution | null =>
  cachedResolution === null
    ? null
    : { fetchedAt: cachedResolution.fetchedAt, values: { ...cachedResolution.values } };

/** Values-free view of {@link getCachedResolution}: the timestamp + resolved pointer NAMES only. */
export interface CachedResolutionMeta {
  /** `Date.now()` of the last successful resolve. */
  fetchedAt: number;
  /** The resolved pointer strings (never the secret values). */
  pointerNames: string[];
  /** How many pointers were resolved. */
  pointerCount: number;
}

/**
 * Safe diagnostic accessor: the last resolution's timestamp + resolved pointer
 * NAMES, with the secret values stripped. Use this on any surface that might be
 * logged or served (`/health`, metrics) so the convenient path is also the safe
 * one — {@link getCachedResolution} is the values-carrying escape hatch.
 */
export const getCachedResolutionMeta = (): CachedResolutionMeta | null => {
  if (cachedResolution === null) return null;
  const pointerNames = Object.keys(cachedResolution.values);
  return { fetchedAt: cachedResolution.fetchedAt, pointerNames, pointerCount: pointerNames.length };
};

/**
 * Tear down the dev file watchers, the dev poll, the rotation poll, and the
 * debounce timer WITHOUT wiping the resolved cache / active config. Use for a
 * graceful shutdown of an embedded resolver (worker / CLI) so no timers keep
 * firing; the last resolved `process.env` values stay in place.
 *
 * **Note:** `activeConfig` is intentionally left set after `stopSecretManager`,
 * so that `reloadSecretManagerFromFiles` can still use it for a final manual
 * reload. As a consequence, calling `refreshSecretManager()` after `stop` will
 * issue a live network request (the `!activeConfig` no-op guard is not met).
 * If you want to prevent ANY further resolution after `stop`, call
 * `resetSecretManagerForTests()` instead (which also clears `activeConfig`).
 */
export const stopSecretManager = (): void => {
  devReloadStarted = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (rotationPollTimer) {
    clearInterval(rotationPollTimer);
    rotationPollTimer = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  for (const watcher of fileWatchers) {
    watcher.close();
  }
  fileWatchers.length = 0;
  //? Reset the "warned once" guard so a subsequent initSecretManager() call that
  //? also omits envNames re-emits the boot warning rather than silently silencing it
  //? (the first, valid config could have set envNames correctly while the second,
  //? broken one doesn't — the guard must not carry across a full stop-and-reinit).
  warnedEnvNamesUnset = false;
};

/** Test-only — clear module state and tear down any dev watchers / timers. */
export const resetSecretManagerForTests = (): void => {
  stopSecretManager();
  cachedResolution = null;
  pointerMap = null;
  activeConfig = null;
  resolveChain = Promise.resolve();
  warnedEnvNamesUnset = false;
};
