//? Registry of log keys that get masked when the framework prints request /
//? response payloads. Feature packages register their domain-specific
//? sensitive keys at boot (login → `password`, email → `apiKey`, etc.) so a
//? consumer of the package never has to remember to extend a static list in
//? core to keep their own data out of logs.
//?
//? Lookups are case-insensitive. Keys are merged with the framework defaults;
//? `registerRedactedLogKeys` is additive — duplicate calls are idempotent.

export const DEFAULT_REDACTED_LOG_KEYS: readonly string[] = [
  'password',
  'confirmpassword',
  'token',
  'newtoken',
  'authorization',
  'cookie',
  'set-cookie',
  'csrftoken',
  'apikey',
  'secret',
];

const redactedKeys = new Set<string>(DEFAULT_REDACTED_LOG_KEYS.map((key) => key.toLowerCase()));

//? Sensitive SUFFIXES (0.2.0 widening). Exact-match alone missed compound keys
//? a project naturally produces — `targetToken`, `sessionToken`, `clientSecret`,
//? `stripeApiKey` — leaving real secrets in logs/breadcrumbs. A key whose
//? lowercased form ENDS WITH one of these is redacted in addition to the exact
//? set above. Suffix (not arbitrary substring) is deliberate: it catches the
//? `<qualifier><Sensitive>` naming convention while a plain `substring` test
//? would over-redact benign keys (e.g. a `tokenCount` metric, a `secretSanta`
//? field). Kept conservative on purpose — register extra keys explicitly via
//? `registerRedactedLogKeys` for project-specific names that don't fit.
const SENSITIVE_KEY_SUFFIXES: readonly string[] = ['token', 'secret', 'apikey', 'password'];

export const registerRedactedLogKeys = (keys: readonly string[]): void => {
  for (const key of keys) {
    redactedKeys.add(key.toLowerCase());
  }
};

export const getRedactedLogKeys = (): readonly string[] => [...redactedKeys];

export const isRedactedLogKey = (key: string): boolean => {
  const lower = key.toLowerCase();
  if (redactedKeys.has(lower)) return true;
  return SENSITIVE_KEY_SUFFIXES.some((suffix) => lower.endsWith(suffix));
};

//? Test-only helper — restore the default seed set between integration tests.
//? Never call from production code; framework packages register their own
//? keys at boot and clearing would re-expose them.
export const resetRedactedLogKeysForTests = (): void => {
  redactedKeys.clear();
  for (const key of DEFAULT_REDACTED_LOG_KEYS) {
    redactedKeys.add(key.toLowerCase());
  }
};

/** Placeholder substituted for a redacted value. */
export const REDACTED_PLACEHOLDER = '[redacted]';

//? Distinct from REDACTED_PLACEHOLDER so an over-deep BENIGN value (a numeric id,
//? a timestamp) isn't mislabeled as a masked secret — the marker reads as
//? structural truncation, not redaction.
export const DEPTH_TRUNCATED_PLACEHOLDER = '[truncated: max depth]';

//? Depth cap so a self-referential / pathologically deep object can't make the
//? sanitize pass blow the stack on a hot log/capture path.
const MAX_SANITIZE_DEPTH = 8;

/**
 * Recursively deep-copy `value`, replacing any property whose key matches the
 * registered redacted-keys set (case-insensitive) with {@link REDACTED_PLACEHOLDER}
 * (SYNC-17 defense-in-depth). Use it at raw log / `captureException` context
 * sites so a token/password nested anywhere in a payload never lands verbatim in
 * a logger sink or error-tracker breadcrumb.
 *
 * - Primitives pass through unchanged.
 * - Arrays are mapped element-wise (array indices are never "keys", so an
 *   element is only redacted by its own nested object keys).
 * - Cycles / over-deep graphs are cut at {@link MAX_SANITIZE_DEPTH} with
 *   {@link DEPTH_TRUNCATED_PLACEHOLDER}; the input is never mutated.
 */
export const sanitizeForLog = (value: unknown, depth = 0, _seen?: WeakSet<object>): unknown => {
  if (depth > MAX_SANITIZE_DEPTH) return DEPTH_TRUNCATED_PLACEHOLDER;
  if (value === null || typeof value !== 'object') return value;

  //? Cycle detection: if we have already visited this reference higher up in the
  //? call stack, replace it with a marker rather than recursing into it — this
  //? prevents a stack overflow when `value` contains a circular reference (e.g.
  //? an Error whose `.cause` links back to itself, or a Node IncomingMessage
  //? with circular HTTP-socket references).
  const seen = _seen ?? new WeakSet<object>();
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item, depth + 1, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isRedactedLogKey(key) ? REDACTED_PLACEHOLDER : sanitizeForLog(nested, depth + 1, seen);
  }
  return out;
};
