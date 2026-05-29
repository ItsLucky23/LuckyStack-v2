/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
import { asOAuthUserData, getOAuthProviders, isFullOAuthProvider, type FullOAuthProvider } from './oauthProviders';
import { getPostLoginRedirect } from './redirectResolver';
import { IncomingMessage, ServerResponse } from 'node:http';
import { URLSearchParams } from 'node:url';
import { tryCatch, redis as redisClient, getUploadsDir, dispatchHook, getLogger, getProjectName } from '@luckystack/core';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { saveSession } from "./session"
import validator from 'validator';
import type { BaseSessionLayout as SessionLayout } from './sessionLayout';
import { getProjectConfig } from '@luckystack/core';
import { getUserAdapter } from './userAdapter';
import { validatePassword } from './passwordPolicy';
import path from 'node:path';
import { existsSync } from 'node:fs';

interface paramsType {
  email?: string,
  password?: string,
  name?: string,
  confirmPassword?: string,
}

//? Resolved at call time via getUploadsDir() so consumer path overrides win.
const uploadsFolder = (): string => getUploadsDir();
//? Resolve at call time so dotenv/test-setup timing can't capture a stale
//? value at module load. Routes through `projectConfig.logging.devLogs`
//? which is the standard predicate everywhere else in the codebase.
const isDevMode = (): boolean => getProjectConfig().logging.devLogs;
const { compare, genSalt, hash } = bcrypt;
const { escape, isEmail } = validator;

//? Use the shared `getProjectName()` helper so the OAuth state Redis key
//? prefix matches the namespace used everywhere else (sessions, activeUsers,
//? rate-limit, password-reset). Previously this used a separate
//? `auth.oauthStateProjectNameFallback` config field which could silently
//? drift from `session.projectName`.
const getOAuthStateKey = (providerName: string, state: string): string => {
  return `${getProjectName()}-oauth-state:${providerName}:${state}`;
};

export const createOAuthState = async (providerName: string): Promise<string | null> => {
  const state = randomBytes(32).toString('hex');
  const key = getOAuthStateKey(providerName, state);
  const result = await redisClient.set(key, '1', 'EX', getProjectConfig().auth.oauthStateTtlSeconds, 'NX');

  if (result !== 'OK') {
    return null;
  }

  return state;
};

const consumeOAuthState = async (providerName: string, state: string): Promise<boolean> => {
  if (!state) {
    return false;
  }

  const key = getOAuthStateKey(providerName, state);
  const txResult = await redisClient.multi().get(key).del(key).exec();
  if (!txResult || txResult.length < 2) {
    return false;
  }

  const getResult = txResult[0];
  if (!getResult || getResult[0]) {
    return false;
  }

  return getResult[1] === '1';
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return {};
};

const sanitizeUserForSession = <T extends { password?: unknown }>(user: T): Omit<T, 'password'> => {
  const { password: _password, ...safeUser } = user;
  return safeUser;
};

const toReasonKey = (error: unknown, fallback = 'api.internalServerError'): string => {
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }

  if (error instanceof Error && error.message) {
    const message = error.message.toLowerCase();
    if (message.includes('authentication failed') || message.includes('scram failure')) {
      return 'api.internalServerError';
    }
  }

  return fallback;
};

interface NormalizedCredentials {
  email: string;
  password: string;
  name: string | undefined;
  confirmPassword: string | undefined;
}

const normalizeCredentials = (params: paramsType): NormalizedCredentials => ({
  //? Don't HTML-escape password OR confirmPassword before bcrypt — neither
  //? reaches HTML, and they're memory-compared for equality during register.
  //? Escaping confirmPassword while leaving password raw made any password
  //? containing `& < > " '` fail the `password !== confirmPassword` check
  //? (regression introduced in pass-1 fix #9 which only un-escaped password).
  //? Email is normalized (lowercase + trim) and validated via `isEmail`;
  //? HTML-escaping it would make legacy raw rows unfindable.
  email: (params.email || '').trim().toLowerCase(),
  password: params.password || '',
  name: params.name ? escape(params.name) : undefined,
  confirmPassword: params.confirmPassword || undefined,
});

const validateCredentialsShape = (creds: NormalizedCredentials): { status: false; reason: string } | null => {
  const authLimits = getProjectConfig().auth;
  if (!creds.email || !creds.password) return { status: false, reason: 'login.empty' };
  if (creds.email.length > authLimits.emailMaxLength) return { status: false, reason: 'login.emailCharacterLimit' };
  if (creds.name && creds.name.length > authLimits.nameMaxLength) return { status: false, reason: 'login.nameCharacterLimit' };
  if (!isEmail(creds.email)) return { status: false, reason: 'login.invalidEmailFormat' };
  //? Full password-policy check (length, complexity, common-list, customValidator).
  //? Policy lives in `projectConfig.auth.passwordPolicy`; the deprecated
  //? `passwordMinLength`/`passwordMaxLength` top-level fields are still read
  //? from the policy's `minLength`/`maxLength` defaults.
  const passwordReason = validatePassword(creds.password);
  if (passwordReason) return { status: false, reason: passwordReason };
  return null;
};

const registerWithCredentials = async ({
  email,
  password,
  name,
  confirmPassword,
}: {
  email: string;
  password: string;
  name: string;
  confirmPassword: string;
}) => {
  if (password !== confirmPassword) {
    return { status: false, reason: 'login.passwordNotMatch' };
  }

  const preRegisterResult = await dispatchHook('preRegister', { email, provider: 'credentials', name });
  if (preRegisterResult.stopped) {
    return { status: false, reason: preRegisterResult.signal.errorCode };
  }

  const userAdapter = getUserAdapter();
  const [checkEmailError, checkEmailResponse] = await tryCatch(() =>
    userAdapter.findByEmail({ email, provider: 'credentials' })
  );
  if (checkEmailError) {
    getLogger().error('login: findByEmail failed during register', checkEmailError);
    return { status: false, reason: toReasonKey(checkEmailError) };
  }
  if (checkEmailResponse) return { status: false, reason: 'login.emailExists' };

  const createNewUser = async () => {
    const salt = await genSalt(getProjectConfig().auth.bcryptRounds);
    const hashedPassword = await hash(password, salt);
    return await userAdapter.create({
      email,
      provider: 'credentials',
      name,
      password: hashedPassword,
      avatar: '',
      avatarFallback: `#${Math.floor(Math.random() * 0xFF_FF_FF).toString(16).padStart(6, "0")}`,
      language: getProjectConfig().defaultLanguage,
    });
  };

  const [createNewUserError, createNewUserResponse] = await tryCatch(createNewUser);
  if (createNewUserError) return { status: false, reason: toReasonKey(createNewUserError) };
  if (!createNewUserResponse) return { status: false, reason: 'login.createUserFailed' };

  await dispatchHook('postRegister', { userId: createNewUserResponse.id, provider: 'credentials' });
  return {
    status: true,
    reason: 'login.userCreated',
    session: sanitizeUserForSession(createNewUserResponse),
  };
};

const loginWithCredentialsCore = async ({ email, password }: { email: string; password: string }) => {
  const preLoginResult = await dispatchHook('preLogin', { email, provider: 'credentials' });
  if (preLoginResult.stopped) {
    return { status: false, reason: preLoginResult.signal.errorCode };
  }

  const userAdapter = getUserAdapter();
  const [findUserError, findUserResponse] = await tryCatch(() =>
    userAdapter.findByEmail({ email, provider: 'credentials' })
  );
  if (findUserError) {
    getLogger().error('login: findByEmail failed', findUserError);
    return { status: false, reason: toReasonKey(findUserError) };
  }
  if (!findUserResponse) return { status: false, reason: 'login.userNotFound' };

  const [checkPasswordError, checkPasswordResponse] = await tryCatch(() =>
    compare(password, findUserResponse.password!)
  );
  if (checkPasswordError) {
    getLogger().error('login: bcrypt compare failed', checkPasswordError);
    return { status: false, reason: checkPasswordError };
  }
  if (!checkPasswordResponse) return { status: false, reason: 'login.wrongPassword' };

  const newToken = randomBytes(32).toString('hex');
  const previousLogin = (findUserResponse as { lastLogin?: Date | null }).lastLogin ?? null;
  const nowLogin = new Date();

  // Best-effort lastLogin update — silently no-ops if the user adapter
  // (or User schema) doesn't accept the field.
  await tryCatch(() => userAdapter.update(findUserResponse.id, { lastLogin: nowLogin } as never));

  const newUser: SessionLayout = {
    ...sanitizeUserForSession(findUserResponse),
    token: newToken,
    lastLogin: nowLogin,
    previousLogin,
  };

  const filePath = path.join(uploadsFolder(), `${newUser.id}.webp`);
  if (existsSync(filePath)) {
    newUser.avatar = `${newUser.id}.webp`;
  }

  await saveSession(newToken, newUser, true);
  await dispatchHook('postLogin', { userId: newUser.id, provider: 'credentials', isNewUser: false, token: newToken });
  if (isDevMode()) {
    getLogger().debug(`credentials login success for user ${newUser.id}`);
  }
  return { status: true, reason: 'login.loggedIn', newToken, session: newUser };
};

//? Thin dispatcher: keeps the existing single-entry HTTP surface but forwards
//? to the dedicated register / login functions. `name && confirmPassword`
//? present in the body means the client is registering; otherwise it's a
//? login.
const loginWithCredentials = async (params: paramsType) => {
  const creds = normalizeCredentials(params);

  if (isDevMode()) {
    getLogger().debug(`credentials auth attempt for ${creds.email || 'unknown-email'}`);
  }

  const validationError = validateCredentialsShape(creds);
  if (validationError) return validationError;

  if (creds.name && creds.confirmPassword) {
    return registerWithCredentials({
      email: creds.email,
      password: creds.password,
      name: creds.name,
      confirmPassword: creds.confirmPassword,
    });
  }
  return loginWithCredentialsCore({ email: creds.email, password: creds.password });
};

export interface OAuthCallbackResult {
  token: string;
  redirectUrl: string;
  userId: string;
  provider: string;
  isNewUser: boolean;
}

const isAllowedRedirectUrl = (url: string): boolean => {
  if (!URL.canParse(url, 'http://placeholder')) return false;
  const parsed = new URL(url, 'http://placeholder');
  if (parsed.origin === 'http://placeholder') {
    // relative URL — same-origin, always safe
    return true;
  }
  //? `allowedOrigins` is `string[] | (origin: string) => boolean` since we
  //? added the function-resolver variant. Branch on the shape.
  const allowed = getProjectConfig().http.cors.allowedOrigins ?? [];
  if (typeof allowed === 'function') {
    return allowed(parsed.origin);
  }
  return allowed.some((origin) => {
    if (!URL.canParse(origin)) return false;
    return new URL(origin).origin === parsed.origin;
  });
};

const exchangeOAuthToken = async (provider: FullOAuthProvider, code: string): Promise<string | null> => {
  const values = {
    code,
    client_id: provider.clientID,
    client_secret: provider.clientSecret,
    redirect_uri: provider.callbackURL,
    grant_type: 'authorization_code',
  };

  const getToken = async () => {
    if (provider.tokenExchangeMethod === 'json') {
      const response = await fetch(provider.tokenExchangeURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(values),
      });
      return await response.json();
    }
    if (provider.tokenExchangeMethod === 'form') {
      const formParams = new URLSearchParams();
      formParams.append('client_id', provider.clientID);
      formParams.append('client_secret', provider.clientSecret);
      formParams.append('code', values.code);
      formParams.append('grant_type', 'authorization_code');
      formParams.append('redirect_uri', provider.callbackURL);

      if (isDevMode()) {
        getLogger().debug('oauth: token-exchange form params', { params: formParams.toString() });
      }
      const response = await fetch(provider.tokenExchangeURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: formParams.toString(),
      });
      return await response.json();
    }
    return null;
  };

  const [error, response] = await tryCatch(getToken);
  if (error) {
    getLogger().error('oauth: token exchange failed', error);
    return null;
  }
  const tokenData = asRecord(response);
  const accessToken = typeof tokenData.access_token === 'string' ? tokenData.access_token : '';
  if (!accessToken) {
    getLogger().warn('oauth: no access_token in token response', { provider: provider.name });
    return null;
  }
  return accessToken;
};

interface OAuthProfile {
  email: string | undefined;
  name: string;
  avatar: string;
}

const fetchOAuthProfile = async (
  provider: FullOAuthProvider,
  accessToken: string,
): Promise<OAuthProfile | null> => {
  const getUserData = async () => {
    const response = await fetch(provider.userInfoURL, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
    });
    return await response.json();
  };

  const [error, response] = await tryCatch(getUserData);
  if (error) {
    getLogger().error('oauth: userInfo fetch failed', error);
    return null;
  }

  const userData = asRecord(response);
  const name = String(userData[provider.nameKey] || 'didnt find a name');
  const emailValue = userData[provider.emailKey];
  let email: string | undefined = typeof emailValue === 'string' ? emailValue : undefined;

  const avatarId = provider.avatarCodeKey ? userData[provider.avatarCodeKey] : undefined;
  const avatarValue = provider?.avatarKey
    ? String(userData[provider.avatarKey] || '')
    : (provider.getAvatar
      ? await provider.getAvatar({ userData, avatarId: typeof avatarId === 'string' ? avatarId : '', accessToken })
      : '');
  const avatar = typeof avatarValue === 'string' ? avatarValue : '';

  //? Some providers (GitHub) don't return email in /userinfo — fall back to the
  //? provider's `getEmail` accessor.
  if (!email && provider.getEmail) {
    const selectedEmail = await provider.getEmail(accessToken);
    if (!selectedEmail) {
      getLogger().warn('oauth: no email found via provider.getEmail', { provider: provider.name });
      return null;
    }
    email = selectedEmail;
  }

  return { email, name, avatar };
};

interface ResolvedOAuthUser {
  user: SessionLayout;
  isNewUser: boolean;
}

const findOrCreateOAuthUser = async (
  provider: FullOAuthProvider,
  profile: OAuthProfile,
): Promise<ResolvedOAuthUser | null> => {
  const { email, name, avatar } = profile;
  if (!email) return null;

  const preLoginResult = await dispatchHook('preLogin', { email, provider: provider.name });
  if (preLoginResult.stopped) {
    getLogger().warn(`oauth login aborted by preLogin hook`, { errorCode: preLoginResult.signal.errorCode });
    return null;
  }

  const userAdapter = getUserAdapter();
  const [findError, findResponse] = await tryCatch(() =>
    userAdapter.findByEmail({ email, provider: provider.name })
  );
  if (findError) {
    getLogger().error('oauth: findByEmail failed', findError);
    return null;
  }

  if (findResponse?.id) {
    const filePath = path.join(uploadsFolder(), `${findResponse.id}.webp`);
    if (existsSync(filePath)) {
      findResponse.avatar = `${findResponse.id}.webp`;
    }

    const previousLogin = (findResponse as { lastLogin?: Date | null }).lastLogin ?? null;
    const nowLogin = new Date();
    await tryCatch(() => userAdapter.update(findResponse.id, { lastLogin: nowLogin } as never));

    return {
      user: {
        ...sanitizeUserForSession(findResponse),
        token: '',
        lastLogin: nowLogin,
        previousLogin,
      },
      isNewUser: false,
    };
  }

  const preRegisterResult = await dispatchHook('preRegister', { email, provider: provider.name, name });
  if (preRegisterResult.stopped) {
    getLogger().warn(`oauth register aborted by preRegister hook`, { errorCode: preRegisterResult.signal.errorCode });
    return null;
  }

  const createNewUser = async () => userAdapter.create({
    email,
    provider: provider.name,
    name,
    avatar,
    avatarFallback: `#${Math.floor(Math.random() * 0xFF_FF_FF).toString(16).padStart(6, "0")}`,
    language: getProjectConfig().defaultLanguage,
  });
  const [createError, createResponse] = await tryCatch(createNewUser);
  if (createError) {
    getLogger().error('oauth: user create failed', createError);
    return null;
  }
  if (!createResponse) return null;

  return {
    user: { ...sanitizeUserForSession(createResponse), token: '' },
    isNewUser: true,
  };
};

const resolvePostLoginRedirect = async ({
  fallbackUrl,
  userId,
  providerName,
  isNewUser,
}: {
  fallbackUrl: string;
  userId: string;
  providerName: string;
  isNewUser: boolean;
}): Promise<string> => {
  const resolver = getPostLoginRedirect();
  if (!resolver) return fallbackUrl;

  const [resolverError, resolved] = await tryCatch(() => resolver({
    userId,
    provider: providerName,
    isNewUser,
    defaultUrl: fallbackUrl,
  }));
  if (resolverError) {
    getLogger().warn(`[oauth] postLoginRedirect resolver threw`, { message: (resolverError as Error).message });
    return fallbackUrl;
  }
  if (resolved && isAllowedRedirectUrl(resolved)) return resolved;
  if (resolved) {
    getLogger().warn(
      `[oauth] postLoginRedirect returned a URL not in allowed origins — falling back`,
      { resolved, fallbackUrl },
    );
  }
  return fallbackUrl;
};

// Route that handles the callback from the OAuth provider
const loginCallback = async (
  pathname: string,
  req: IncomingMessage,
  _res: ServerResponse,
  options: { defaultRedirectUrl?: string } = {},
): Promise<OAuthCallbackResult | false> => {
  const providerName = pathname.split('/')[3]; // google/github/etc.
  if (!providerName) return false;
  const provider = getOAuthProviders().find(p => p.name === providerName);
  if (!provider || !req.url) return false;
  if (!isFullOAuthProvider(provider)) return false;

  const queryString = req.url.split('?')[1] ?? '';
  const params = new URLSearchParams(queryString);
  const code = params.get('code');
  const state = params.get('state');

  const stateIsValid = await consumeOAuthState(provider.name, state || '');
  if (!stateIsValid) {
    getLogger().warn('oauth: invalid or missing state', { provider: provider.name });
    return false;
  }

  if (!code) {
    getLogger().warn('oauth: no code provided in callback url', { provider: provider.name });
    return false;
  }

  const accessToken = await exchangeOAuthToken(provider, code);
  if (!accessToken) return false;

  const profile = await fetchOAuthProfile(provider, accessToken);
  if (!profile) return false;

  const resolved = await findOrCreateOAuthUser(provider, profile);
  if (!resolved) return false;

  const newToken = randomBytes(32).toString('hex');
  resolved.user.token = newToken;

  //? Per-provider runtime extras (calendar tokens, tenant ids, etc.) are
  //? merged into the session BEFORE save so saveSession + the resulting
  //? sessionStorage broadcast see the final shape. Errors are logged but
  //? do not block login — a missing extra is not worth keeping the user
  //? from signing in.
  const extraSessionFields = provider.extraSessionFields;
  if (extraSessionFields) {
    const [extraErr, extra] = await tryCatch(async () =>
      extraSessionFields({ userData: asOAuthUserData(profile), accessToken }),
    );
    if (extraErr) {
      getLogger().warn(`[oauth:${providerName}] extraSessionFields hook threw — continuing without extras`, { err: extraErr });
    } else if (extra) {
      Object.assign(resolved.user, extra);
    }
  }

  await saveSession(newToken, resolved.user, true);

  if (resolved.isNewUser) {
    await dispatchHook('postRegister', { userId: resolved.user.id, provider: providerName });
  }
  await dispatchHook('postLogin', {
    userId: resolved.user.id,
    provider: providerName,
    isNewUser: resolved.isNewUser,
    token: newToken,
  });

  if (isDevMode()) {
    getLogger().debug(`oauth login success for user ${resolved.user.id}`);
  }

  const fallbackUrl =
    options.defaultRedirectUrl
    ?? getProjectConfig().loginRedirectUrl
    ?? '/';

  const redirectUrl = await resolvePostLoginRedirect({
    fallbackUrl,
    userId: resolved.user.id,
    providerName,
    isNewUser: resolved.isNewUser,
  });

  return {
    token: newToken,
    redirectUrl,
    userId: resolved.user.id,
    provider: providerName,
    isNewUser: resolved.isNewUser,
  };
};

export { loginWithCredentials, loginCallback, registerWithCredentials, loginWithCredentialsCore }
