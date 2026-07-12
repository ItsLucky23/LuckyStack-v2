import { getProjectConfig } from '@luckystack/core';
import { getLogin } from '../capabilities';
import type { HttpRouteHandler } from './types';

//? GET /auth/providers — public list of enabled auth-provider names, derived
//? from the env-driven OAuth registry (see the consumer's
//? `luckystack/login/oauthProviders.ts`, which registers a provider only when
//? its credentials env vars are present). The login form fetches this to decide
//? which OAuth buttons to render WITHOUT ever shipping client secrets to the
//? browser. Read-only + bodyless, so it runs in the pre-params phase.
export const handleAuthProvidersRoute: HttpRouteHandler = async ({ req, res, routePath }) => {
  if (routePath !== '/auth/providers' || req.method !== 'GET') return false;

  //? @luckystack/login optional: when absent there are no providers to advertise.
  const login = await getLogin();
  const providers = login ? login.getOAuthProviders().map((provider) => provider.name) : [];

  //? ADR 0024: advertise whether passwordless email-code login is enabled so
  //? the login form can render the "email me a code" entry point. A boolean
  //? config flag only — no secrets, same trust level as the provider names.
  const emailCodeLogin = Boolean(login) && getProjectConfig().auth.emailCodeLogin;

  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ providers, emailCodeLogin }));
  return true;
};
