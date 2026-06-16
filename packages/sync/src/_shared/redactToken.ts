//? SYNC-17 — token redaction for logs + error-tracker context.
//?
//? Raw session tokens are bearer credentials: anyone holding one can act as the
//? session. They must never be persisted verbatim into the error tracker
//? (`tryCatch` context → `captureException`) or stream debug logs, where they
//? defeat HttpOnly-cookie mode. This helper truncates a token to a short,
//? non-reversible prefix that is still useful for correlating log lines /
//? error events without exposing a usable credential.

const VISIBLE_PREFIX = 8;

/**
 * Truncate a session token to `<first 8 chars>…` for safe logging. Returns the
 * value unchanged when it is null/empty (nothing to redact) or already shorter
 * than the visible prefix.
 */
export const redactToken = (token: string | null): string | null => {
  if (!token) return token;
  if (token.length <= VISIBLE_PREFIX) return token;
  return `${token.slice(0, VISIBLE_PREFIX)}…`;
};

/**
 * Redact a list of tokens (e.g. the `streamTo` recipient list) for logging.
 */
export const redactTokens = (tokens: readonly string[]): string[] =>
  tokens.map((t) => redactToken(t) ?? t);
