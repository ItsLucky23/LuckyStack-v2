/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
import { getOAuthProviders, isFullOAuthProvider } from './oauthProviders';
import { getPostLoginRedirect } from './redirectResolver';
import { IncomingMessage, ServerResponse } from 'node:http';
import { URLSearchParams } from 'node:url';
import { tryCatch, redis as redisClient, getUploadsDir, dispatchHook } from '@luckystack/core';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { saveSession } from "./session"
import validator from 'validator';
import type { BaseSessionLayout as SessionLayout } from './sessionLayout';
import { getProjectConfig } from '@luckystack/core';
import { getUserAdapter } from './userAdapter';
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
const isDevMode = process.env.NODE_ENV === 'development';
const { compare, genSalt, hash } = bcrypt;
const { escape, isEmail } = validator;

const getOAuthStateKey = (providerName: string, state: string): string => {
  const projectName = process.env.PROJECT_NAME || getProjectConfig().auth.oauthStateProjectNameFallback;
  return `${projectName}-oauth-state:${providerName}:${state}`;
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

// Route that starts the OAuth flow for the specified provider and redirects to the callback endpoint
const loginWithCredentials = async (params: paramsType) => {

  const email = escape(params.email || '');
  const password = escape(params.password || '');
  const name = params.name ? escape(params.name) : undefined;
  const confirmPassword = params.confirmPassword ? escape(params.confirmPassword) : undefined;

  if (isDevMode) {
    console.log(`credentials auth attempt for ${email || 'unknown-email'}`, 'gray');
  }

  const authLimits = getProjectConfig().auth;
  if (!email || !password) { return { status: false, reason: 'login.empty' }; }
  if (email.length > authLimits.emailMaxLength) { return { status: false, reason: 'login.emailCharacterLimit' }; }
  if (password.length < authLimits.passwordMinLength) { return { status: false, reason: 'login.passwordCharacterMinimum' }; }
  if (password.length > authLimits.passwordMaxLength) { return { status: false, reason: 'login.passwordCharacterLimit' }; }
  if (name && name.length > authLimits.nameMaxLength) { return { status: false, reason: 'login.nameCharacterLimit' }; }
  if (!isEmail(email)) { return { status: false, reason: 'login.invalidEmailFormat' }; }

  const userAdapter = getUserAdapter();

  if (name && confirmPassword) { //? register
    if (password != confirmPassword) { return { status: false, reason: 'login.passwordNotMatch' }; }

    const preRegisterResult = await dispatchHook('preRegister', { email, provider: 'credentials', name });
    if (preRegisterResult.stopped) {
      return { status: false, reason: preRegisterResult.signal.errorCode };
    }

    //? check if email already exists
    const [checkEmailError, checkEmailResponse] = await tryCatch(() =>
      userAdapter.findByEmail({ email, provider: 'credentials' })
    );
    if (checkEmailError) {
      console.log(checkEmailError);
      return { status: false, reason: toReasonKey(checkEmailError) };
    }
    if (checkEmailResponse) { return { status: false, reason: 'login.emailExists' }; }

    //? email is not in use, create the new user
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
    }

    //? here we create the new user
    const [createNewUserError, createNewUserResponse] = await tryCatch(createNewUser);
    if (createNewUserError) { return { status: false, reason: toReasonKey(createNewUserError) }; }
    if (createNewUserResponse) {
      await dispatchHook('postRegister', { userId: createNewUserResponse.id, provider: 'credentials' });
      return {
        status: true,
        reason: 'login.userCreated',
        session: sanitizeUserForSession(createNewUserResponse),
      };
    }
    return { status: false, reason: 'login.createUserFailed' };

  } else { //? login
    const preLoginResult = await dispatchHook('preLogin', { email, provider: 'credentials' });
    if (preLoginResult.stopped) {
      return { status: false, reason: preLoginResult.signal.errorCode };
    }

    //? attempt to find the user
    const [findUserError, findUserResponse] = await tryCatch(() =>
      userAdapter.findByEmail({ email, provider: 'credentials' })
    );
    if (findUserError) {
      console.log(findUserError, 'findUserError');
      return { status: false, reason: toReasonKey(findUserError) };
    }
    if (!findUserResponse) { return { status: false, reason: 'login.userNotFound' }; }

    //? if we found a user we check if the password matches the hashed one in the db
    const checkPassword = async () => { return await compare(password, findUserResponse.password!); }
    const [checkPasswordError, checkPasswordResponse] = await tryCatch(checkPassword);
    if (checkPasswordError) {
      console.log(checkPasswordError, 'checkPasswordError');
      return { status: false, reason: checkPasswordError };
    }
    if (!checkPasswordResponse) { return { status: false, reason: 'login.wrongPassword' }; }

    //? if the password matches we return the user
    if (checkPasswordResponse) {
      const newToken = randomBytes(32).toString("hex")
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
      }

      const filePath = path.join(uploadsFolder(), `${newUser.id}.webp`);
      if (existsSync(filePath)) {
        newUser.avatar = `${newUser.id}.webp`;
      }

      await saveSession(newToken, newUser, true);
      await dispatchHook('postLogin', { userId: newUser.id, provider: 'credentials', isNewUser: false, token: newToken });
      if (isDevMode) {
        console.log(`credentials login success for user ${newUser.id}`, 'green');
      }
      return { status: true, reason: 'login.loggedIn', newToken, session: newUser };
    }
  }
}

export interface OAuthCallbackResult {
  token: string;
  redirectUrl: string;
  userId: string;
  provider: string;
  isNewUser: boolean;
}

const isAllowedRedirectUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url, 'http://placeholder');
    if (parsed.origin === 'http://placeholder') {
      // relative URL — same-origin, always safe
      return true;
    }
    const allowed = getProjectConfig().http.cors.allowedOrigins ?? [];
    return allowed.some((origin) => {
      try {
        return new URL(origin).origin === parsed.origin;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
};

// Route that handles the callback from the OAuth provider
const loginCallback = async (
  pathname: string,
  req: IncomingMessage,
  _res: ServerResponse,
  options: { defaultRedirectUrl?: string } = {},
): Promise<OAuthCallbackResult | false> => {
  //? check if provider exists
  const providerName = pathname.split('/')[3]; // Extract the provider (google/github)
  const provider = getOAuthProviders().find(p => p.name === providerName);
  if (!provider || !req.url) { return false }
  if (!isFullOAuthProvider(provider)) { return false }

  const queryString = req.url.split('?')[1]; // Get the part after '?'
  const params = new URLSearchParams(queryString);
  const code = params.get('code');
  const state = params.get('state');

  const stateIsValid = await consumeOAuthState(provider.name, state || '');
  if (!stateIsValid) {
    console.log('invalid or missing oauth state');
    return false;
  }

  //? if no code provided in the url we return false (the code is used to get the access token and should be provided by the oauth provider)
  if (!code || code == '') {
    console.log('no code provided in callback url')
    return false
  }

  const values = {
    code,
    client_id: provider.clientID,
    client_secret: provider.clientSecret,
    redirect_uri: provider.callbackURL,
    grant_type: 'authorization_code'
  }

  //? with the code we can get the access token
  const getToken = async () => {
    if (provider.tokenExchangeMethod == 'json') {
      const url = provider.tokenExchangeURL;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(values),
      })
      return await response.json();
    } else if (provider.tokenExchangeMethod == 'form') {
      const url = provider.tokenExchangeURL;
      const params = new URLSearchParams();
      params.append('client_id', provider.clientID);
      params.append('client_secret', provider.clientSecret);
      params.append('code', values.code);
      params.append('grant_type', 'authorization_code');
      params.append('redirect_uri', provider.callbackURL);

      if (isDevMode) {
        console.log(params)
      }
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: params.toString()
      });

      return await response.json();
    }
  }

  const [getTokenError, getTokenResponse] = await tryCatch(getToken)
  if (getTokenError) {
    console.log(getTokenError, 'getTokenError');
    return false;
  }

  //? here we get the access token
  const tokenData = asRecord(getTokenResponse);
  const access_token = typeof tokenData.access_token === 'string' ? tokenData.access_token : '';
  if (!access_token) {
    console.log('no access token found in oauth token response');
    return false;
  }
  const getUserData = async () => {
    const url = provider.userInfoURL;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${access_token}`
      },
    })
    return await response.json();
  }

  //? with the access_token token we get the user data
  const [getUserDataError, getUserDataResponse] = await tryCatch(getUserData);
  if (getUserDataError) {
    console.log(getUserDataError);
    return false;
  }

  const userData = asRecord(getUserDataResponse);

  const name = String(userData[provider.nameKey] || 'didnt find a name')

  const emailValue = userData[provider.emailKey];
  let email: string | undefined = typeof emailValue === 'string' ? emailValue : undefined;
  const avatarId = provider.avatarCodeKey ? userData[provider.avatarCodeKey] : undefined;
  const avatarValue = provider?.avatarKey
    ? String(userData[provider.avatarKey] || '')
    : (provider.getAvatar
      ? await provider.getAvatar({ userData, avatarId: typeof avatarId === 'string' ? avatarId : '' })
      : '');
  const avatar = typeof avatarValue === 'string' ? avatarValue : '';

  //? if we didnt find the email we try to get it with a external link if this one is provided
  if (!email && provider.getEmail) {
    const selectedEmail = await provider.getEmail(access_token);

    if (!selectedEmail) {
      console.log('no email found');
      return false;
    }

    email = selectedEmail;
  }

  let tempUser: SessionLayout | undefined;
  let isNewOAuthUser = false;

  if (email) {
    const preLoginResult = await dispatchHook('preLogin', { email, provider: provider.name });
    if (preLoginResult.stopped) {
      console.log(`oauth login aborted by preLogin hook: ${preLoginResult.signal.errorCode}`, 'yellow');
      return false;
    }

    const userAdapter = getUserAdapter();

    //? here we check if the user exists in the db
    const [userDataError, userDataResponse] = await tryCatch(() =>
      userAdapter.findByEmail({ email: email!, provider: provider.name })
    );
    if (userDataError) {
      console.log(userDataError);
      return false;
    }

    //? if the user exists we assign it to the tempUser variable
    if (userDataResponse?.id) {
      const filePath = path.join(uploadsFolder(), `${userDataResponse.id}.webp`);
      if (existsSync(filePath)) {
        userDataResponse.avatar = `${userDataResponse.id}.webp`;
      }

      const previousLogin = (userDataResponse as { lastLogin?: Date | null }).lastLogin ?? null;
      const nowLogin = new Date();
      await tryCatch(() => userAdapter.update(userDataResponse.id, { lastLogin: nowLogin } as never));

      tempUser = {
        ...sanitizeUserForSession(userDataResponse),
        token: '',
        lastLogin: nowLogin,
        previousLogin,
      };
    }

    //? if the user doesnt exist we create a new one
    if (!tempUser) {
      const preRegisterResult = await dispatchHook('preRegister', { email, provider: provider.name, name });
      if (preRegisterResult.stopped) {
        console.log(`oauth register aborted by preRegister hook: ${preRegisterResult.signal.errorCode}`, 'yellow');
        return false;
      }

      const createNewUser = async () => {
        if (!email) { return null; }
        return await userAdapter.create({
          email,
          provider: provider.name,
          name,
          avatar,
          avatarFallback: `#${Math.floor(Math.random() * 0xFF_FF_FF).toString(16).padStart(6, "0")}`,
          language: getProjectConfig().defaultLanguage,
        });
      }
      const [createNewUserError, createNewUserResponse] = await tryCatch(createNewUser);
      if (createNewUserError) {
        console.log(createNewUserError);
        return false;
      }

      if (createNewUserResponse) {
        isNewOAuthUser = true;
        tempUser = {
          ...sanitizeUserForSession(createNewUserResponse),
          token: ''
        };
      }
    }
  }

  if (!tempUser) {
    return false;
  }

  //? here we create a new token, create the users session and return the token as a sign of success
  const newToken = randomBytes(32).toString("hex")
  tempUser.token = newToken;
  await saveSession(newToken, tempUser, true);

  if (isNewOAuthUser) {
    await dispatchHook('postRegister', { userId: tempUser.id, provider: providerName });
  }
  await dispatchHook('postLogin', { userId: tempUser.id, provider: providerName, isNewUser: isNewOAuthUser, token: newToken });

  if (isDevMode) {
    console.log(`oauth login success for user ${tempUser.id}`, 'green');
  }

  //? Resolve the redirect URL: project-supplied resolver wins, falls back to
  //? the static `loginRedirectUrl` in ProjectConfig. Any URL that fails the
  //? allowed-origin check is rejected as a defense against open-redirect.
  const fallbackUrl =
    options.defaultRedirectUrl
    ?? getProjectConfig().loginRedirectUrl
    ?? '/';

  let redirectUrl = fallbackUrl;
  const resolver = getPostLoginRedirect();
  if (resolver) {
    try {
      const resolved = await resolver({
        userId: tempUser.id,
        provider: providerName,
        isNewUser: isNewOAuthUser,
        defaultUrl: fallbackUrl,
      });
      if (resolved && isAllowedRedirectUrl(resolved)) {
        redirectUrl = resolved;
      } else if (resolved) {
        console.log(
          `[oauth] postLoginRedirect returned a URL not in allowed origins: ${resolved} — falling back to ${fallbackUrl}`,
          'yellow',
        );
      }
    } catch (err) {
      console.log(`[oauth] postLoginRedirect resolver threw: ${(err as Error).message}`, 'yellow');
    }
  }

  return {
    token: newToken,
    redirectUrl,
    userId: tempUser.id,
    provider: providerName,
    isNewUser: isNewOAuthUser,
  };
}

export { loginWithCredentials, loginCallback }
