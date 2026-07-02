//? Origin-exempt path registry. `enforceOriginPolicy` fail-closes every
//? state-changing POST that carries no browser-attributable Origin/Referer —
//? which is exactly a legitimate server-to-server webhook (GitLab, Stripe, ...).
//? Registering a path prefix here lets such an endpoint through the browser
//? CSRF/origin gate.
//?
//? SECURITY: origin exemption is NOT authentication. It only removes the
//? browser-origin check; the exempted handler MUST authenticate the caller
//? itself (HMAC over the raw body, a shared-secret header, mTLS, ...). Pair
//? with a `'pre-params'` custom route so the handler can read the raw body for
//? signature verification. Empty by default — opt-in only. Do NOT register a
//? prefix that overlaps framework routes (`/api`, `/auth`, `/sync`); keep
//? webhooks on a dedicated prefix like `/webhooks/`. See
//? docs/ARCHITECTURE_HTTP.md.

export interface OriginExemptMatcher {
  /**
   * A route is exempt when its path equals this prefix OR continues past it on a
   * path-SEGMENT boundary (i.e. `<prefix>/...`). Matching is boundary-aware so a
   * prefix can't bleed into a sibling route — `/webhooks` exempts `/webhooks` and
   * `/webhooks/stripe` but NOT `/webhooksadmin`.
   */
  pathPrefix: string;
}

const exemptPaths: OriginExemptMatcher[] = [];

export const registerOriginExemptPath = (matcher: OriginExemptMatcher): void => {
  exemptPaths.push(matcher);
};

export const getOriginExemptPaths = (): readonly OriginExemptMatcher[] => exemptPaths;

export const clearOriginExemptPaths = (): void => {
  exemptPaths.length = 0;
};

//? True when `routePath` matches a registered exempt prefix. Consulted by
//? `enforceOriginPolicy` before it can 403 a header-less request AND by the CSRF
//? middleware — so a single mis-matching prefix would drop BOTH protections.
//? Match on a path-SEGMENT boundary (exact, or `<prefix>/...`) so a prefix like
//? `/webhooks` can't silently exempt a sibling like `/webhooksadmin` (L5).
export const isOriginExemptPath = (routePath: string): boolean =>
  exemptPaths.some(({ pathPrefix }) => {
    if (!pathPrefix) return false;
    if (routePath === pathPrefix) return true;
    const boundary = pathPrefix.endsWith('/') ? pathPrefix : `${pathPrefix}/`;
    return routePath.startsWith(boundary);
  });
