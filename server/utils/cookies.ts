const escapeRegExp = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

export const getCookieValue = (cookieHeader: string | undefined, cookieName: string): string | null => {
  if (!cookieHeader || !cookieName) {
    return null;
  }

  const safeCookieName = escapeRegExp(cookieName);
  const cookieRegex = new RegExp(`(?:^|;\\s*)${safeCookieName}=([^;]*)`);
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
