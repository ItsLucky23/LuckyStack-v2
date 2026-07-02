import { resolveEnvKey } from '@luckystack/core';

//? Single source of truth for the session / OAuth-state cookie `Secure` flag:
//? honor the explicit `http.sessionCookieSecure` override (CORE-39), else the
//? `SECURE` env flag, else default ON in production (L5). Used by BOTH the
//? session-token cookie (`httpHandler`) and the OAuth state cookie
//? (`authApiRoute`) so the two can never drift again (WAVE4 — the M2 fix had
//? updated only the OAuth cookie, leaving the session cookie ignoring the override).
//?
//? L5: previously an HTTPS production deploy that set NEITHER
//? `http.sessionCookieSecure` NOR `SECURE=true` shipped the session + OAuth-state
//? cookies WITHOUT `Secure` — correct only if the operator remembered a flag.
//? Now production defaults `Secure` ON; a genuine plain-HTTP prod deploy (rare —
//? e.g. no TLS anywhere) must opt out with `http.sessionCookieSecure: false`.
export const resolveCookieSecure = (
  sessionCookieSecure: boolean | undefined,
  secureEnv: string | undefined,
): boolean => {
  if (sessionCookieSecure !== undefined) return sessionCookieSecure;
  if (secureEnv === 'true') return true;
  return resolveEnvKey() === 'production';
};
