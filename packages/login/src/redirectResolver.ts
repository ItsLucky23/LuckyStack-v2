//? Post-login redirect resolver. Lets consumers compute the OAuth callback
//? redirect URL dynamically (per-user, per-tenant, per-provider).
//?
//? Why a dedicated registry instead of a hook:
//?   The framework's hooks are "stop-or-continue" — handlers return undefined
//?   or a stop signal. They don't carry a value. A redirect-resolution
//?   handler must RETURN a string, so it lives in its own registry.
//?
//? Validation: the resolved URL is checked against
//? `ProjectConfig.http.cors.allowedOrigins` (plus the localhost convenience when
//? `http.cors.allowLocalhost` is on) before being used. An invalid URL falls back
//? to `ProjectConfig.loginRedirectUrl`.

export interface PostLoginRedirectInput {
  userId: string;
  provider: string;
  isNewUser: boolean;
  defaultUrl: string;
}

export type PostLoginRedirectResolver = (
  input: PostLoginRedirectInput,
) => string | Promise<string>;

let activeResolver: PostLoginRedirectResolver | null = null;

export const registerPostLoginRedirect = (
  resolver: PostLoginRedirectResolver,
): PostLoginRedirectResolver => {
  activeResolver = resolver;
  return resolver;
};

export const getPostLoginRedirect = (): PostLoginRedirectResolver | null => activeResolver;

const RELATIVE_BASE = 'http://luckystack-relative.invalid';

/**
 * Resolve a valid relative post-login result against the trusted absolute
 * default URL supplied by the HTTP callback layer. OAuth callbacks commonly
 * live on a separate backend origin; returning `/dashboard` unchanged would
 * make the browser resolve it against that backend instead of the frontend.
 *
 * Absolute candidates and callers that supplied only a relative default stay
 * byte-identical. Origin allowlisting happens in login.ts BEFORE this helper.
 */
export const resolvePostLoginRedirectAgainstDefault = (
  candidate: string,
  defaultUrl: string,
): string => {
  if (!URL.canParse(candidate, RELATIVE_BASE)) return candidate;
  const parsed = new URL(candidate, RELATIVE_BASE);
  if (parsed.origin !== RELATIVE_BASE) return candidate;
  if (!URL.canParse(defaultUrl)) return candidate;
  const fallback = new URL(defaultUrl);
  if (fallback.protocol !== 'http:' && fallback.protocol !== 'https:') return candidate;
  return new URL(candidate, fallback).toString();
};
