import { applyCookiePrefixConstraints, getProjectConfig, isProductionRuntime } from '@luckystack/core';

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
  return isProductionRuntime();
};

//? The session cookie builder. Every place that sets, refreshes or clears the
//? session cookie (login, OAuth callback, 2FA/email-code, sliding refresh,
//? logout) goes through these, so `http.sessionCookiePrefix` and
//? `http.sessionCookieDomain` apply everywhere: a clear that differs in name,
//? Path or Domain from the set would leave the session cookie in the browser.
//? The token extractors in core resolve the same prefixed name.

/** Effective session cookie name: `http.sessionCookieName` plus any `__Host-`/`__Secure-` prefix. */
export const resolveSessionCookieName = (): string => {
  const { http } = getProjectConfig();
  return applyCookiePrefixConstraints(http.sessionCookieName, http.sessionCookiePrefix).name;
};

/** Attribute string for the session cookie with the given lifetime (0 clears it). */
export const buildSessionCookieOptions = (maxAgeSeconds: number): string => {
  const { http } = getProjectConfig();
  const constraints = applyCookiePrefixConstraints(
    http.sessionCookieName,
    http.sessionCookiePrefix,
    resolveCookieSecure(http.sessionCookieSecure, process.env.SECURE),
  );
  const path = constraints.forcePathRoot ? '/' : http.sessionCookiePath;
  const domain = http.sessionCookieDomain && !constraints.forbidDomain ? `Domain=${http.sessionCookieDomain}; ` : '';
  return `HttpOnly; SameSite=${http.sessionCookieSameSite}; Path=${path}; Max-Age=${maxAgeSeconds}; ${domain}${constraints.secure ? 'Secure;' : ''}`;
};

/** Full `Set-Cookie` value carrying `token` under the effective session cookie name. */
export const buildSessionCookie = (token: string, cookieOptions: string): string =>
  `${resolveSessionCookieName()}=${token}; ${cookieOptions}`;

/** `Set-Cookie` value that expires the session cookie (same name, Path and Domain as when set). */
export const buildClearedSessionCookie = (): string => buildSessionCookie('', buildSessionCookieOptions(0));
