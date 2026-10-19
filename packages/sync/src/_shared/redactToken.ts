//? SYNC-17 — token redaction for logs + error-tracker context.
//?
//? Raw session tokens are bearer credentials: anyone holding one can act as the
//? session. They must never be persisted verbatim into the error tracker
//? (`tryCatch` context → `captureException`) or stream debug logs, where they
//? defeat HttpOnly-cookie mode. This helper truncates a token to a short,
//? non-reversible prefix that is still useful for correlating log lines /
//? error events without exposing a usable credential.

//? 4 chars is sufficient for log-line correlation while preventing partial
//? brute-force of low-entropy tokens (audit finding SYNC-medium-5).
const VISIBLE_PREFIX = 4;

/**
 * Truncate a session token to `<first 4 chars>…` for safe logging. Returns the
 * value unchanged when it is null/empty (nothing to redact) or already shorter
 * than the visible prefix.
 */
export const redactToken = (token: string | null): string | null => {
  if (!token) return token;
  if (token.length <= VISIBLE_PREFIX) return token;
  return `${token.slice(0, VISIBLE_PREFIX)}…`;
};

/**
 * Redact a sync `receiver` for the error-tracker context when it is a session
 * token room. A token room's NAME is the bearer token, so a raw `receiver` there
 * leaks the credential exactly like a raw `targetToken` would. Ordinary room
 * codes pass through unchanged so tracker events stay debuggable. `knownTokens`
 * are the tokens the call site can compare against (requester and/or recipient).
 */
export const redactTokenRoom = (
  receiver: string,
  knownTokens: readonly (string | null | undefined)[],
): string => {
  if (!knownTokens.some((token) => Boolean(token) && token === receiver)) return receiver;
  return redactToken(receiver) ?? receiver;
};

/**
 * Redact a list of tokens (e.g. the `streamTo` recipient list) for logging.
 */
export const redactTokens = (tokens: readonly string[]): string[] =>
  tokens.map((t) => redactToken(t) ?? t);
