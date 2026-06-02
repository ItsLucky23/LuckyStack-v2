//? Redis key formatter — the single, registerable authority for how every
//? framework Redis key is namespaced. Replaces the per-call-site
//? `${getProjectName()}-<area>:<id>` convention with one injectable hook, so a
//? multi-tenant consumer can prefix keys per tenant (e.g. read a tenant id
//? from AsyncLocalStorage) from ONE place instead of patching ~9 call sites.
//?
//? Contract: `formatKey(namespace, suffix)` builds a key. The DEFAULT
//? formatter reproduces the framework's historical key bytes EXACTLY, so
//? upgrading without registering a custom formatter requires NO key migration.
//? A namespace beginning with a separator (`-` or `:`) is appended verbatim —
//? this is how the framework preserves its legacy shapes (`-session`,
//? `:rate-limit`); any other namespace is colon-joined for clean app keys
//? (`formatKey('rag', id)` -> `<project>:rag:<id>`).
//?
//? Custom formatters MUST keep the `<namespace-root>:<suffix>` join, otherwise
//? the framework's session/rate-limit `SCAN` enumeration (which derives its
//? match pattern from `formatKey(namespace, '')`) cannot find the keys.

import { getProjectName } from './projectConfig';

export type RedisKeyFormatter = (namespace: string, suffix: string) => string;

export const defaultRedisKeyFormatter: RedisKeyFormatter = (namespace, suffix) => {
  const root = /^[-:]/.test(namespace) ? `${getProjectName()}${namespace}` : `${getProjectName()}:${namespace}`;
  return suffix === '' ? root : `${root}:${suffix}`;
};

let formatter: RedisKeyFormatter | null = null;

//? Register a custom key formatter (call once at boot, before the first Redis
//? key is built). Last-write-wins.
export const registerRedisKeyFormatter = (fn: RedisKeyFormatter): void => {
  formatter = fn;
};

export const getRedisKeyFormatter = (): RedisKeyFormatter => formatter ?? defaultRedisKeyFormatter;

//? Test-only — restore the default formatter between scenarios.
export const resetRedisKeyFormatterForTests = (): void => {
  formatter = null;
};

//? Build a namespaced Redis key through the active formatter. Suffix is
//? optional so callers can produce just the namespace root (used to derive
//? SCAN match patterns: `${formatKey('-session', '')}:*`).
export const formatKey = (namespace: string, suffix = ''): string =>
  getRedisKeyFormatter()(namespace, suffix);

//? Best-effort prefix for stray, un-namespaced keys passed to the `redis`
//? proxy's single-key commands. A key that already contains a `:` (every
//? framework key, plus any app key the caller chose to namespace) passes
//? through unchanged, so this can never double-prefix or corrupt a real key.
//? Project-level only — per-tenant scoping is the formatter's job, not the
//? net's (the net has no request context).
export const applyStrayKeyPrefix = (key: string): string =>
  key.includes(':') ? key : `${getProjectName()}:${key}`;
