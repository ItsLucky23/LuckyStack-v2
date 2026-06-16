//? Single source of truth for the session / OAuth-state cookie `Secure` flag:
//? honor the explicit `http.sessionCookieSecure` override (CORE-39), else fall
//? back to the `SECURE` env flag. Used by BOTH the session-token cookie
//? (`httpHandler`) and the OAuth state cookie (`authApiRoute`) so the two can
//? never drift again (WAVE4 — the M2 fix had updated only the OAuth cookie,
//? leaving the security-critical session cookie ignoring the override).
export const resolveCookieSecure = (
  sessionCookieSecure: boolean | undefined,
  secureEnv: string | undefined,
): boolean => sessionCookieSecure ?? secureEnv === 'true';
