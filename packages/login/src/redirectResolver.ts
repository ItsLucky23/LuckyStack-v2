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
