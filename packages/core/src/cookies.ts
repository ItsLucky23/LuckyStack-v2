const escapeRegExp = (value: string): string => {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
};

export const getCookieValue = (cookieHeader: string | undefined, cookieName: string): string | null => {
  if (!cookieHeader || !cookieName) {
    return null;
  }

  const safeCookieName = escapeRegExp(cookieName);
  const cookieRegex = new RegExp(String.raw`(?:^|;\s*)${safeCookieName}=([^;]*)`);
  const match = cookieHeader.match(cookieRegex);
  const rawValue = match?.[1];

  if (!rawValue) {
    return null;
  }

  try {
    return decodeURIComponent(rawValue);
  } catch {
    return rawValue;
  }
};

export const hasCookie = (cookieHeader: string | undefined, cookieName: string): boolean => {
  return getCookieValue(cookieHeader, cookieName) !== null;
};

/** Attributes a cookie-builder must honour, after applying any name prefix. */
export interface CookiePrefixConstraints {
  /** Effective cookie name (prefix prepended when applicable). */
  name: string;
  /** Whether `Secure` must be set (forced true by either prefix). */
  secure: boolean;
  /** Whether `Path=/` is forced (true under `__Host-`). */
  forcePathRoot: boolean;
  /** Whether a `Domain` attribute is FORBIDDEN (true under `__Host-`). */
  forbidDomain: boolean;
}

/**
 * Compute the attribute constraints a `__Host-` / `__Secure-` cookie-name prefix
 * imposes (CORE-10/39), so the server's session + CSRF cookie builders apply the
 * browser-enforced rules consistently:
 *
 *   - `'__Host-'`   → name prefixed, `Secure` forced, `Path=/` forced, `Domain` forbidden.
 *   - `'__Secure-'` → name prefixed, `Secure` forced.
 *   - `undefined`   → name unchanged, no forced attributes (today's behavior).
 *
 * Pure + deterministic — the builder still owns serialization; this only
 * resolves the constraints so server and any other cookie-site can't drift.
 * `secureOverride` lets the caller force `Secure` independent of a prefix
 * (mirrors `http.sessionCookieSecure`).
 */
export const applyCookiePrefixConstraints = (
  baseName: string,
  prefix: '__Host-' | '__Secure-' | undefined,
  secureOverride?: boolean,
): CookiePrefixConstraints => {
  if (prefix === '__Host-') {
    return { name: `__Host-${baseName}`, secure: true, forcePathRoot: true, forbidDomain: true };
  }
  if (prefix === '__Secure-') {
    return { name: `__Secure-${baseName}`, secure: true, forcePathRoot: false, forbidDomain: false };
  }
  return { name: baseName, secure: secureOverride ?? false, forcePathRoot: false, forbidDomain: false };
};
