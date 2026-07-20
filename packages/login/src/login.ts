import { getOAuthProviders, isFullOAuthProvider, type FullOAuthProvider, type OAuthUserData } from './oauthProviders';
import { getPostLoginRedirect } from './redirectResolver';
import { IncomingMessage, ServerResponse } from 'node:http';
import { URLSearchParams } from 'node:url';
import { tryCatch, tryCatchSync, redis as redisClient, getUploadsDir, dispatchHook, getLogger, formatKey, getProjectConfig, getCookieValue, resolveDevCallbackUrl } from '@luckystack/core';
import bcrypt from 'bcryptjs';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { saveSession } from "./session"
import validator from 'validator';
import type { BaseSessionLayout as SessionLayout } from './sessionLayout';
import { getUserAdapter, type UserRecord } from './userAdapter';
import { resolveUserByEmail } from './accountStrategy';
import { validatePassword } from './passwordPolicy';
import { isAccountLocked, clearAuthFailures } from './authLockout';
import path from 'node:path';
import { promises as fsPromises } from 'node:fs';

//? Combined login/register request body. When `name` + `confirmPassword` are
//? both present the dispatcher registers; otherwise it logs in.
interface LoginOrRegisterParams {
  email?: string,
  password?: string,
  name?: string,
  confirmPassword?: string,
}

//? Discriminated result of the credentials login/register surface (QUA-080).
//? Exporting this lets `@luckystack/server`'s auth route narrow on `status`
//? instead of casting the result to an inline shape. On a full success,
//? `newToken` + `session` are always present; on `status: false` only `reason`
//? is meaningful (the failure branch never mints a token). The CHALLENGE
//? member (ADR 0024) is the 2FA half-way state: the first factor was correct
//? but NO session exists yet — the route relays `challengeToken` to the client
//? and `/auth/api/2fa` completes the login. The `?: undefined` markers keep
//? property access legal across the whole union (`result.newToken`).
export type TwoFactorMethod = 'totp' | 'email-code' | 'recovery-code';
export interface CredentialsLoginSuccess {
  status: true;
  reason: string;
  newToken: string;
  session: SessionLayout;
  requiresTwoFactor?: undefined;
}
export interface CredentialsLoginChallenge {
  status: true;
  reason: string;
  requiresTwoFactor: true;
  challengeToken: string;
  twoFactorMethods: TwoFactorMethod[];
  newToken?: undefined;
  session?: undefined;
}
export interface CredentialsLoginFailure {
  status: false;
  reason: string;
  newToken?: undefined;
  session?: undefined;
  requiresTwoFactor?: undefined;
}
export type CredentialsLoginResult = CredentialsLoginSuccess | CredentialsLoginChallenge | CredentialsLoginFailure;

//? Resolved at call time via getUploadsDir() so consumer path overrides win.
const uploadsFolder = (): string => getUploadsDir();
//? Resolve at call time so dotenv/test-setup timing can't capture a stale
//? value at module load. Routes through `projectConfig.logging.devLogs`
//? which is the standard predicate everywhere else in the codebase.
const isDevMode = (): boolean => getProjectConfig().logging.devLogs;
const { compare, genSalt, hash } = bcrypt;

//? LOGIN-F22: the dummy hash used on the user-not-found path must be generated
//? at the CONFIGURED bcrypt rounds, not hard-pinned to cost 10. If the consumer
//? raises `auth.bcryptRounds` (e.g. to 12), a cost-10 dummy compare finishes in
//? ~80 ms while a real compare takes ~400 ms — the 5× difference reopens the
//? user-enumeration timing channel we closed with the dummy compare. We lazily
//? generate one hash per unique rounds value (cached so the per-request compare
//? stays O(1) after the first login at a given cost) and use that hash for all
//? subsequent not-found compares at the same cost.
const dummyHashCache = new Map<number, string>();
const getDummyBcryptHash = async (): Promise<string> => {
  const rounds = getProjectConfig().auth.bcryptRounds;
  const cached = dummyHashCache.get(rounds);
  if (cached) return cached;
  const salt = await genSalt(rounds);
  const generated = await hash(randomBytes(16).toString('hex'), salt);
  dummyHashCache.set(rounds, generated);
  return generated;
};
//? `validator` is a CommonJS module whose helpers hang off the default export;
//? destructuring the default is the documented usage. The named-export warning
//? is a false positive for this CJS interop shape.
// eslint-disable-next-line import-x/no-named-as-default-member
const { escape, isEmail } = validator;

//? Use the shared `getProjectName()` helper so the OAuth state Redis key
//? prefix matches the namespace used everywhere else (sessions, activeUsers,
//? rate-limit, password-reset). Previously this used a separate
//? `auth.oauthStateProjectNameFallback` config field which could silently
//? drift from `session.projectName`.
const getOAuthStateKey = (providerName: string, state: string): string => {
  return formatKey('-oauth-state', `${providerName}:${state}`);
};

//? Cookie the server sets at the OAuth-authorize step (F1). It carries a random
//? nonce bound to the Redis state entry; the callback requires the cookie nonce
//? to hash to the value stored alongside the state before it accepts the
//? callback. This proves the SAME browser that started the flow is completing it
//? (closes the login-CSRF / session-fixation hole where an attacker delivers
//? their own valid `code+state` to a victim). Server + login MUST agree on this
//? name — it is exported so `@luckystack/server`'s authorize route reuses it.
export const OAUTH_STATE_COOKIE_NAME = 'ls-oauth-state';

//? Hash the browser-binding nonce before persisting it in Redis: the Redis
//? state value is server-side-readable, so storing only the SHA-256 means a
//? leaked state entry can't be replayed without the matching cookie nonce.
const hashStateNonce = (nonce: string): string =>
  createHash('sha256').update(nonce).digest('hex');

//? Generate a PKCE verifier + its S256 challenge (RFC 7636). Only used when a
//? provider opts in via `usePkce` — default OAuth flows are byte-identical to
//? before. The verifier is stored server-side (in the Redis state value) and
//? replayed at token exchange; the challenge is handed to the authorize step.
const base64Url = (buf: Buffer): string =>
  buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const generatePkcePair = (): { verifier: string; challenge: string } => {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
};

//? Server-side payload persisted under the Redis state key. `nonceHash` binds
//? the flow to the initiating browser's cookie; `codeVerifier` (PKCE) is the
//? secret replayed at token exchange.
interface OAuthStateEntry {
  nonceHash: string;
  codeVerifier?: string;
  //? Frontend URL to redirect to after the OAuth callback completes. Stored
  //? server-side in Redis (never echoed from the client at callback time) so it
  //? is tamper-proof. Validated against allowedOrigins + allowLocalhost before
  //? use — see isAllowedRedirectUrl. Absent when the auth initiation did not
  //? carry a return_url param (falls back to the configured loginRedirectUrl).
  returnUrl?: string;
}

export interface CreateOAuthStateResult {
  /** Opaque `state` param put on the authorize URL + echoed back on callback. */
  state: string;
  /**
   * Random nonce the server must set as the value of the {@link OAUTH_STATE_COOKIE_NAME}
   * cookie (HttpOnly, SameSite=Lax, short TTL) at the authorize redirect. The
   * callback requires this back to accept the flow (browser-binding, F1).
   */
  stateCookie: string;
  /**
   * PKCE `code_challenge` (S256) when the provider opted into PKCE — the server
   * appends `code_challenge=<value>&code_challenge_method=S256` to the authorize
   * URL. `undefined` for non-PKCE providers (default).
   */
  codeChallenge?: string;
}

export const createOAuthState = async (
  providerName: string,
  options?: { usePkce?: boolean; returnUrl?: string },
): Promise<CreateOAuthStateResult | null> => {
  const state = randomBytes(32).toString('hex');
  const nonce = randomBytes(32).toString('hex');
  const key = getOAuthStateKey(providerName, state);

  const pkce = options?.usePkce ? generatePkcePair() : null;
  const entry: OAuthStateEntry = {
    nonceHash: hashStateNonce(nonce),
    ...(pkce ? { codeVerifier: pkce.verifier } : {}),
    ...(options?.returnUrl ? { returnUrl: options.returnUrl } : {}),
  };

  //? State TTL is consumer-configurable via `auth.oauthStateTtlSeconds`
  //? (default 600s / 10 min). Too short and a legitimate, slow provider
  //? round-trip expires mid-flow and the callback fails state validation
  //? (UX/soft-DoS); too long and a stolen state stays replayable. The `NX`
  //? guard keeps each state single-use even before the TTL elapses, and
  //? `consumeOAuthState` deletes it on first redemption. The value is now a
  //? JSON envelope (nonce hash + optional PKCE verifier) instead of the literal
  //? `'1'` so the flow can be bound to the initiating browser (F1) and carry a
  //? PKCE secret (F11).
  const result = await redisClient.set(
    key,
    JSON.stringify(entry),
    'EX',
    getProjectConfig().auth.oauthStateTtlSeconds,
    'NX',
  );

  if (result !== 'OK') {
    return null;
  }

  return {
    state,
    stateCookie: nonce,
    ...(pkce ? { codeChallenge: pkce.challenge } : {}),
  };
};

//? Atomically read + delete the state entry (single-use), then verify the
//? browser-binding nonce. Returns the parsed entry on success (so the caller can
//? read `codeVerifier` for the PKCE token exchange), or `null` on any failure:
//? missing state, missing/empty cookie nonce, Redis miss, malformed payload, or
//? a nonce that doesn't match the stored hash. `cookieNonce` is the value the
//? server read from the {@link OAUTH_STATE_COOKIE_NAME} cookie on the callback
//? request.
const consumeOAuthState = async (
  providerName: string,
  state: string,
  cookieNonce: string,
): Promise<OAuthStateEntry | null> => {
  if (!state || !cookieNonce) {
    return null;
  }

  const key = getOAuthStateKey(providerName, state);
  const txResult = await redisClient.multi().get(key).del(key).exec();
  if (!txResult || txResult.length < 2) {
    return null;
  }

  const getResult = txResult[0];
  if (!getResult || getResult[0]) {
    return null;
  }

  //? Verify the DEL also succeeded (txResult[1][0] is the per-command error slot).
  //? If DEL failed the state key was not consumed — fail closed so the OAuth state
  //? cannot be replayed with the same nonce before its TTL expires (mirrors the
  //? consumeOneTimeToken hardening in @luckystack/core).
  const delResult = txResult[1];
  if (!delResult || delResult[0]) {
    return null;
  }

  const rawValue = getResult[1];
  if (typeof rawValue !== 'string') {
    return null;
  }

  const [parseErr, entry] = tryCatchSync(() => JSON.parse(rawValue) as OAuthStateEntry);
  if (parseErr || !entry || typeof entry.nonceHash !== 'string') {
    return null;
  }

  //? Constant-time compare of the two fixed-length (SHA-256) hex digests via
  //? `timingSafeEqual` (QUA-21). Both operands are 64-char hex strings, so their
  //? byte buffers are equal-length; a length mismatch (malformed stored value)
  //? falls through to reject. A mismatch means the browser completing the flow is
  //? NOT the one that started it — reject (F1).
  const incomingHash = Buffer.from(hashStateNonce(cookieNonce));
  const storedHash = Buffer.from(entry.nonceHash);
  if (incomingHash.length !== storedHash.length || !timingSafeEqual(incomingHash, storedHash)) {
    return null;
  }

  return entry;
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return {};
};

//? Read a string-ish field from an untyped provider JSON record. Strings pass
//? through; finite numbers / booleans are coerced (preserving the previous
//? `String(value)` behaviour for primitive fields); objects, arrays, null and
//? undefined collapse to `fallback` instead of stringifying to `[object Object]`.
const readStringField = (record: Record<string, unknown>, key: string, fallback = ''): string => {
  const value = record[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return fallback;
};

//? Random 6-digit hex color used as the avatar placeholder for users without
//? an uploaded image. Shared by the credentials-register and OAuth-create paths.
const generateAvatarFallbackColor = (): string =>
  `#${Math.floor(Math.random() * 0xFF_FF_FF).toString(16).padStart(6, "0")}`;

//? LOGIN-F18: check whether a user has an uploaded webp avatar on disk and
//? return the filename when found. Used by both the credentials and OAuth login
//? paths to avoid duplicating the async stat pattern.
const resolveUploadedAvatar = async (userId: string): Promise<string | null> => {
  const filePath = path.join(uploadsFolder(), `${userId}.webp`);
  const [, avatarStat] = await tryCatch(() => fsPromises.stat(filePath));
  return avatarStat ? `${userId}.webp` : null;
};

//? Strips every column that must never reach Redis or the client: the bcrypt
//? hash AND the 2FA material (ADR 0024). Consumers with more sensitive columns
//? add a `registerSessionSanitizer` on top; this is the always-on floor.
const sanitizeUserForSession = <T extends { password?: unknown; totpSecret?: unknown; recoveryCodes?: unknown }>(
  user: T,
): Omit<T, 'password' | 'totpSecret' | 'recoveryCodes'> => {
  const { password: _password, totpSecret: _totpSecret, recoveryCodes: _recoveryCodes, ...safeUser } = user;
  return safeUser;
};

//? Fire-and-forget observational failure signal. Dispatched on every failed
//? login/register/OAuth attempt so consumers can audit, feed a SIEM, or build
//? per-account lockout (HOK-10). Never awaited and never throws — a failing
//? handler must not change the auth outcome the user already got.
const emitLoginFailed = (payload: {
  email?: string;
  userId?: string;
  provider: string;
  reason: string;
  stage: 'login' | 'register' | 'oauth';
  //? DD-LOGIN-F5: optional resolved client IP — threaded from the HTTP auth
  //? route so the per-account lockout can build an IP+account composite key.
  requesterIp?: string;
}): void => {
  void dispatchHook('loginFailed', payload);
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

const normalizeCredentials = (params: LoginOrRegisterParams): NormalizedCredentials => ({
  //? Don't HTML-escape password OR confirmPassword before bcrypt — neither
  //? reaches HTML, and they're memory-compared for equality during register.
  //? Escaping confirmPassword while leaving password raw made any password
  //? containing `& < > " '` fail the `password !== confirmPassword` check
  //? (regression introduced in pass-1 fix #9 which only un-escaped password).
  //? Email is normalized (lowercase + trim) and validated via `isEmail`;
  //? HTML-escaping it would make legacy raw rows unfindable.
  email: (params.email ?? '').trim().toLowerCase(),
  password: params.password ?? '',
  name: params.name ? escape(params.name) : undefined,
  //? Empty-string confirmPassword must collapse to `undefined` so the
  //? register-vs-login dispatcher's truthiness check treats a blank field as
  //? "absent". `??` would keep the empty string (only nullish collapses), so the
  //? falsy-coercing `||` is deliberate here.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional empty-string → undefined collapse
  confirmPassword: params.confirmPassword || undefined,
});

//? Shape-validate normalized credentials. `mode` decides whether the
//? password-POLICY check runs:
//?  - `'register'` enforces the full policy (length, complexity, common-list,
//?    customValidator) — a new account MUST meet the active policy.
//?  - `'login'` does NOT run the policy (M-15). A login must accept ANY password
//?    string and let the bcrypt compare decide pass/fail. Running the policy on
//?    login is both a lockout-DoS vector (an attacker POSTing policy-violating
//?    passwords for a victim's email could otherwise feed the per-account
//?    failed-attempt counter) AND a correctness bug (tightening the policy would
//?    lock out existing users whose stored password no longer meets it). Empty /
//?    email-shape checks still run in both modes.
const validateCredentialsShape = (
  creds: NormalizedCredentials,
  mode: 'login' | 'register',
): { status: false; reason: string } | null => {
  const authLimits = getProjectConfig().auth;
  if (!creds.email || !creds.password) return { status: false, reason: 'login.empty' };
  if (creds.email.length > authLimits.emailMaxLength) return { status: false, reason: 'login.emailCharacterLimit' };
  if (creds.name && creds.name.length > authLimits.nameMaxLength) return { status: false, reason: 'login.nameCharacterLimit' };
  if (!isEmail(creds.email)) return { status: false, reason: 'login.invalidEmailFormat' };
  if (mode === 'register') {
    //? Full password-policy check (length, complexity, common-list, customValidator).
    //? Policy lives in `projectConfig.auth.passwordPolicy`; the deprecated
    //? `passwordMinLength`/`passwordMaxLength` top-level fields are still read
    //? from the policy's `minLength`/`maxLength` defaults. REGISTER-only — see the
    //? function doc for why the login branch skips it (M-15).
    const passwordReason = validatePassword(creds.password);
    if (passwordReason) return { status: false, reason: passwordReason };
  }
  return null;
};

const registerWithCredentials = async (
  {
    email,
    password,
    name,
    confirmPassword,
  }: {
    email: string;
    password: string;
    name: string;
    confirmPassword: string;
  },
  options?: { supersedeToken?: string },
): Promise<CredentialsLoginResult> => {
  if (password !== confirmPassword) {
    emitLoginFailed({ email, provider: 'credentials', reason: 'login.passwordNotMatch', stage: 'register' });
    return { status: false, reason: 'login.passwordNotMatch' };
  }

  const preRegisterResult = await dispatchHook('preRegister', { email, provider: 'credentials', name });
  if (preRegisterResult.stopped) {
    emitLoginFailed({ email, provider: 'credentials', reason: preRegisterResult.signal.errorCode, stage: 'register' });
    return { status: false, reason: preRegisterResult.signal.errorCode };
  }

  //? LOGIN-F15: apply the per-account lockout check before the email-existence
  //? lookup. Without this an attacker can call the register endpoint repeatedly
  //? for a victim's email and perform unbounded `resolveUserByEmail` probes —
  //? effectively bypassing the lockout by choosing the register code path. A
  //? locked account means the credentials flow is temporarily suspended for that
  //? email; the same sentinel applies regardless of which surface (login vs
  //? register) is being used. No-op when `rateLimiting.auth.enabled` is false.
  if (await isAccountLocked(email)) {
    emitLoginFailed({ email, provider: 'credentials', reason: 'login.accountLocked', stage: 'register' });
    return { status: false, reason: 'login.accountLocked' };
  }

  const userAdapter = getUserAdapter();
  const [checkEmailError, checkEmailResponse] = await tryCatch(() =>
    resolveUserByEmail(userAdapter, { email, provider: 'credentials' })
  );
  if (checkEmailError) {
    getLogger().error('login: findByEmail failed during register', checkEmailError);
    const reason = toReasonKey(checkEmailError);
    emitLoginFailed({ email, provider: 'credentials', reason, stage: 'register' });
    return { status: false, reason };
  }
  if (checkEmailResponse) {
    emitLoginFailed({ email, provider: 'credentials', reason: 'login.emailExists', stage: 'register' });
    return { status: false, reason: 'login.emailExists' };
  }

  const createNewUser = async () => {
    const salt = await genSalt(getProjectConfig().auth.bcryptRounds);
    const hashedPassword = await hash(password, salt);
    return await userAdapter.create({
      email,
      provider: 'credentials',
      name,
      password: hashedPassword,
      avatar: '',
      avatarFallback: generateAvatarFallbackColor(),
      language: getProjectConfig().defaultLanguage,
    });
  };

  const [createNewUserError, createNewUserResponse] = await tryCatch(createNewUser);
  if (createNewUserError) {
    //? LOGIN-F7: treat a unique-constraint violation as a TOCTOU race — another
    //? concurrent request created this row between our findFirst and our create.
    //? Under the `'unified'` strategy (where `email @unique` is recommended) this
    //? is the expected concurrent-registration signal; return `login.emailExists`
    //? so the client can prompt the user to log in instead.
    const errorMessage =
      createNewUserError instanceof Error ? createNewUserError.message : String(createNewUserError);
    const isUniqueViolation =
      errorMessage.includes('Unique constraint') ||
      errorMessage.includes('unique constraint') ||
      // Prisma error code P2002 covers all DB engines
      (createNewUserError as { code?: unknown }).code === 'P2002';
    if (isUniqueViolation) {
      emitLoginFailed({ email, provider: 'credentials', reason: 'login.emailExists', stage: 'register' });
      return { status: false, reason: 'login.emailExists' };
    }
    const reason = toReasonKey(createNewUserError);
    emitLoginFailed({ email, provider: 'credentials', reason, stage: 'register' });
    return { status: false, reason };
  }
  if (!createNewUserResponse) {
    emitLoginFailed({ email, provider: 'credentials', reason: 'login.createUserFailed', stage: 'register' });
    return { status: false, reason: 'login.createUserFailed' };
  }

  await dispatchHook('postRegister', { userId: createNewUserResponse.id, provider: 'credentials' });

  //? Auto-login after register (ARCHITECTURE_AUTH.md: both flows return
  //? `{ status, session, newToken }`). Mirrors the login branch: mint a token,
  //? persist the session, and hand the token back so the route can set the
  //? cookie / the client can store it and land on `loginRedirectUrl`.
  const newToken = randomBytes(32).toString('hex');
  const nowLogin = new Date();
  const newUser: SessionLayout = {
    ...sanitizeUserForSession(createNewUserResponse),
    token: newToken,
    lastLogin: nowLogin,
    previousLogin: null,
  };

  const saved = await saveSession(newToken, newUser, true, { supersedeToken: options?.supersedeToken });
  if (!saved.ok) {
    //? Account exists but the session never persisted — surface the failure so
    //? the route does not report an authenticated state it cannot back up. The
    //? user can recover by logging in normally.
    emitLoginFailed({ email, userId: newUser.id, provider: 'credentials', reason: saved.errorCode, stage: 'register' });
    return { status: false, reason: saved.errorCode };
  }
  await dispatchHook('postLogin', { userId: newUser.id, provider: 'credentials', isNewUser: true, token: newToken });

  return {
    status: true,
    reason: 'login.userCreated',
    newToken,
    session: newUser,
  };
};

//? ─── 2FA gate slot (ADR 0024) ───
//? DI registry (same idiom as registerUserAdapter / registerSessionAdapter)
//? instead of importing twoFactor.ts here — that would be a login ↔ twoFactor
//? module cycle. twoFactor.ts registers the gate at module init (pulled in via
//? the package index); with nothing registered, first-factor logins complete
//? directly — which is also why every existing unit test keeps its behavior.
export type TwoFactorGate = (
  user: UserRecord,
  context: { requesterIp?: string },
) => Promise<CredentialsLoginChallenge | null>;
let twoFactorGate: TwoFactorGate | null = null;
export const registerTwoFactorGate = (gate: TwoFactorGate): void => {
  twoFactorGate = gate;
};
const applyTwoFactorGate: TwoFactorGate = async (user, context) =>
  (twoFactorGate ? twoFactorGate(user, context) : null);

//? Shared post-authentication tail (ADR 0024): every first-factor-verified
//? path — password login, email-code login, and the completed 2FA challenge —
//? funnels through here so the session-minting behavior can never drift
//? between them. Mint token → best-effort lastLogin → session layout →
//? saveSession → postLogin hook → clear lockout counters (when email known).
export const finalizeLogin = async (
  user: UserRecord,
  options: { provider: string; email?: string; supersedeToken?: string; requesterIp?: string },
): Promise<CredentialsLoginResult> => {
  const newToken = randomBytes(32).toString('hex');
  const previousLogin = user.lastLogin ?? null;
  const nowLogin = new Date();

  // Best-effort lastLogin update — silently no-ops if the user adapter
  // (or User schema) doesn't accept the field.
  await tryCatch(() => getUserAdapter().update(user.id, { lastLogin: nowLogin }));

  const newUser: SessionLayout = {
    ...sanitizeUserForSession(user),
    token: newToken,
    lastLogin: nowLogin,
    previousLogin,
  };

  const uploadedAvatar = await resolveUploadedAvatar(newUser.id);
  if (uploadedAvatar) {
    newUser.avatar = uploadedAvatar;
  }

  const saved = await saveSession(newToken, newUser, true, { supersedeToken: options.supersedeToken });
  if (!saved.ok) {
    //? Session never persisted (adapter blip / preSessionCreate veto). Fail the
    //? login so the route does NOT set a cookie or delete the prior session for
    //? a token that getSession() can't resolve.
    emitLoginFailed({ email: options.email, userId: newUser.id, provider: options.provider, reason: saved.errorCode, stage: 'login', requesterIp: options.requesterIp });
    return { status: false, reason: saved.errorCode };
  }
  await dispatchHook('postLogin', { userId: newUser.id, provider: options.provider, isNewUser: false, token: newToken });
  //? Reset the brute-force counter on success so earlier typos don't keep a
  //? legitimate user locked out (F7). No-op when the feature is disabled.
  //? Clear the IP+account composite key (DD-LOGIN-F5) AND the bare account key
  //? so that failures recorded without an IP (e.g. from a different surface) are
  //? also cleared after a confirmed legitimate login.
  if (options.email) {
    void clearAuthFailures(options.email, options.requesterIp);
    if (options.requesterIp) void clearAuthFailures(options.email);
  }
  if (isDevMode()) {
    getLogger().debug(`${options.provider} login success for user ${newUser.id}`);
  }
  return { status: true, reason: 'login.loggedIn', newToken, session: newUser };
};

const loginWithCredentialsCore = async (
  { email, password }: { email: string; password: string },
  //? DD-LOGIN-F5: `requesterIp` is optional so all existing callers stay
  //? compatible. The HTTP auth route resolves and passes the IP; socket paths
  //? omit it and fall back to the pure-account lockout bucket.
  options?: { supersedeToken?: string; requesterIp?: string },
): Promise<CredentialsLoginResult> => {
  const requesterIp = options?.requesterIp;
  const preLoginResult = await dispatchHook('preLogin', { email, provider: 'credentials' });
  if (preLoginResult.stopped) {
    emitLoginFailed({ email, provider: 'credentials', reason: preLoginResult.signal.errorCode, stage: 'login', requesterIp });
    return { status: false, reason: preLoginResult.signal.errorCode };
  }

  //? Per-account brute-force lockout (F7 / MIS-017). When the auth rate-limit
  //? slot is enabled and this account has exhausted its failed-attempt budget,
  //? refuse the attempt BEFORE any bcrypt work — distributed credential stuffing
  //? against one account (which the per-IP throttle can't see) is throttled
  //? per-account here. The counter is incremented by the registered `loginFailed`
  //? handler (see `registerAuthLockoutHook`); merely checking the lock does not
  //? increment it. No-op when `rateLimiting.auth.enabled` is false (default).
  if (await isAccountLocked(email, requesterIp)) {
    emitLoginFailed({ email, provider: 'credentials', reason: 'login.accountLocked', stage: 'login', requesterIp });
    return { status: false, reason: 'login.accountLocked' };
  }

  const userAdapter = getUserAdapter();
  const [findUserError, findUserResponse] = await tryCatch(() =>
    resolveUserByEmail(userAdapter, { email, provider: 'credentials' })
  );
  if (findUserError) {
    getLogger().error('login: findByEmail failed', findUserError);
    const reason = toReasonKey(findUserError);
    emitLoginFailed({ email, provider: 'credentials', reason, stage: 'login', requesterIp });
    return { status: false, reason };
  }
  //? Anti-enumeration: a missing account and a missing/invalid password hash
  //? must be INDISTINGUISHABLE from a wrong password — same reason key AND
  //? similar timing. Returning a distinct `login.userNotFound` (and short-
  //? circuiting before any bcrypt work) let an attacker probe which addresses
  //? have credentials accounts via both the response key and a timing side
  //? channel. When there is no real hash to compare, run a bcrypt compare
  //? against a fixed dummy hash so the not-found path spends roughly the same
  //? CPU as a real wrong-password compare, then return the shared key.
  const passwordHash = findUserResponse?.password ?? null;
  if (!findUserResponse || !passwordHash) {
    const dummyHash = await getDummyBcryptHash();
    await tryCatch(() => compare(password, dummyHash));
    //? M3: AWAIT the failure dispatch on the counting (wrong-password) path so the
    //? per-account lockout increment (registered on `loginFailed`) lands BEFORE we
    //? respond — unlike the fire-and-forget `emitLoginFailed` used for observational
    //? failures. This closes the sequential check-then-increment TOCTOU (a retry now
    //? sees the updated counter). `dispatchHook` isolates handler errors, so this
    //? still can't change the auth outcome. A residual window remains for requests
    //? already in flight concurrently (bounded by the atomic per-IP cap) — inherent
    //? to any check-then-act gate.
    await dispatchHook('loginFailed', { email, userId: findUserResponse?.id, provider: 'credentials', reason: 'login.wrongPassword', stage: 'login', requesterIp });
    return { status: false, reason: 'login.wrongPassword' };
  }

  const [checkPasswordError, checkPasswordResponse] = await tryCatch(() =>
    compare(password, passwordHash)
  );
  if (checkPasswordError) {
    getLogger().error('login: bcrypt compare failed', checkPasswordError);
    const reason = toReasonKey(checkPasswordError);
    emitLoginFailed({ email, userId: findUserResponse.id, provider: 'credentials', reason, stage: 'login', requesterIp });
    return { status: false, reason };
  }
  if (!checkPasswordResponse) {
    //? M3: awaited on the counting path (see the no-account branch above) so the
    //? lockout increment lands before the response — closes the sequential TOCTOU.
    await dispatchHook('loginFailed', { email, userId: findUserResponse.id, provider: 'credentials', reason: 'login.wrongPassword', stage: 'login', requesterIp });
    return { status: false, reason: 'login.wrongPassword' };
  }

  //? Second factor (ADR 0024): the password is verified, but an enrolled user
  //? must answer a 2FA challenge before any session is minted. The registered
  //? gate returns null when 2FA is disabled or the user never enrolled — then
  //? the login completes directly through the shared tail.
  const challenge = await applyTwoFactorGate(findUserResponse, { requesterIp });
  if (challenge) return challenge;

  return finalizeLogin(findUserResponse, {
    provider: 'credentials',
    email,
    supersedeToken: options?.supersedeToken,
    requesterIp,
  });
};

//? Thin dispatcher: keeps the existing single-entry HTTP surface but forwards
//? to the dedicated register / login functions. `name && confirmPassword`
//? present in the body means the client is registering; otherwise it's a
//? login.
const loginWithCredentials = async (
  params: LoginOrRegisterParams,
  //? DD-LOGIN-F5: `requesterIp` forwarded to `loginWithCredentialsCore` to
  //? enable IP+account composite lockout keys on the HTTP auth path.
  options?: { supersedeToken?: string; requesterIp?: string },
): Promise<CredentialsLoginResult> => {
  const creds = normalizeCredentials(params);

  if (isDevMode()) {
    getLogger().debug(`credentials auth attempt for ${creds.email || 'unknown-email'}`);
  }

  //? Decide the branch BEFORE shape-validation so the password-POLICY check only
  //? runs on register (M-15): `name && confirmPassword` present => register;
  //? otherwise login. A login must accept any password string (the bcrypt
  //? compare is the only authority), so an attacker can't trip a victim's
  //? lockout counter by POSTing policy-violating passwords for their email.
  //? Narrowing on the destructured locals keeps `name`/`confirmPassword` typed as
  //? `string` inside the register branch (no cast needed).
  const { name, confirmPassword } = creds;
  if (name && confirmPassword) {
    const validationError = validateCredentialsShape(creds, 'register');
    if (validationError) return validationError;
    //? Public-registration gate (F18). When `auth.allowRegistration === false`
    //? (invite-only / admin-provisioned apps) refuse the register branch with a
    //? dedicated reason key BEFORE any user lookup or hook. OAuth-driven
    //? first-login account creation is governed separately by the provider flow.
    //? Default `true` keeps today's open-registration behavior.
    if (!getProjectConfig().auth.allowRegistration) {
      emitLoginFailed({ email: creds.email, provider: 'credentials', reason: 'auth.registrationDisabled', stage: 'register' });
      return { status: false, reason: 'auth.registrationDisabled' };
    }
    return registerWithCredentials({
      email: creds.email,
      password: creds.password,
      name,
      confirmPassword,
    }, options);
  }

  const validationError = validateCredentialsShape(creds, 'login');
  if (validationError) return validationError;
  return loginWithCredentialsCore({ email: creds.email, password: creds.password }, options);
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
  //? Reject relative URLs whose path starts with a backslash or contains any
  //? backslash before the same-origin shortcut (SEC-12): `new URL('/\\evil.com',
  //? base)` keeps the placeholder origin and would pass the same-origin check,
  //? yet browsers normalise `/\` → `//` (protocol-relative) → open-redirect to
  //? `evil.com`. A legitimate same-origin path never needs a backslash.
  if (url.includes('\\')) return false;
  const parsed = new URL(url, 'http://placeholder');
  if (parsed.origin === 'http://placeholder') {
    // relative URL — same-origin, always safe
    return true;
  }
  //? `allowedOrigins` is `string[] | (origin: string) => boolean` since we
  //? added the function-resolver variant. Branch on the shape.
  //? Defensive default at a security boundary (redirect-origin validation):
  //? the type is non-nullable, but a malformed consumer config could still
  //? hand us `undefined` at runtime, so the `?? []` fail-closed guard stays.
  //? `allowLocalhost` is the dev convenience that accepts any http://localhost:*
  //? origin without needing an explicit allowedOrigins entry. Safe in production
  //? because allowLocalhost defaults to false there.
  const cfg = getProjectConfig();
  if (cfg.http.cors.allowLocalhost && parsed.hostname === 'localhost') return true;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime-defensive guard at a security boundary
  const allowed = cfg.http.cors.allowedOrigins ?? [];
  if (typeof allowed === 'function') {
    return allowed(parsed.origin);
  }
  return allowed.some((origin) => {
    if (!URL.canParse(origin)) return false;
    return new URL(origin).origin === parsed.origin;
  });
};

const exchangeOAuthToken = async (
  provider: FullOAuthProvider,
  code: string,
  codeVerifier?: string,
): Promise<string | null> => {
  //? `redirect_uri` is pinned to the registered, immutable `provider.callbackURL`
  //? — the SAME static config value the authorization request is built from.
  //? It is never derived from the incoming request, so there is no per-request
  //? drift to re-validate against (the authorization-time value and the
  //? exchange-time value are guaranteed identical by construction). Persisting
  //? it into the Redis state would be a behaviour-preserving no-op here; if the
  //? callback URL ever becomes request-/tenant-derived, store it alongside the
  //? state in `createOAuthState` and compare before exchange.
  //? `code_verifier` (PKCE, F11) is included ONLY when the provider opted in and
  //? a verifier was stored with the state — for every existing flow it is
  //? `undefined` and the exchange body is unchanged.
  //? `resolveDevCallbackUrl` applies the SAME dev-port rewrite the authorize step
  //? used (`getBindAddress()` is process-constant, so the two agree byte-for-byte,
  //? which OAuth's exchange-must-match-authorize rule requires). No-op in prod.
  const redirectUri = resolveDevCallbackUrl(provider.callbackURL);
  const values = {
    code,
    client_id: provider.clientID,
    client_secret: provider.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
  };

  //? `Promise<unknown>` return annotation: `response.json()` is `any`, and an
  //? explicit `unknown` boundary type forces every caller to narrow via
  //? `asRecord(...)` instead of leaking `any` through the token-exchange seam.
  const getToken = async (): Promise<unknown> => {
    if (provider.tokenExchangeMethod === 'json') {
      const response = await fetch(provider.tokenExchangeURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        getLogger().warn('oauth: token exchange returned non-OK status', { provider: provider.name, status: response.status });
        return null;
      }
      return await response.json();
    }
    //? `tokenExchangeMethod` is the closed union `'json' | 'form'`; the `json`
    //? branch returned above, so this is the exhaustive `form` case.
    const formParams = new URLSearchParams();
    formParams.append('client_id', provider.clientID);
    formParams.append('client_secret', provider.clientSecret);
    formParams.append('code', values.code);
    formParams.append('grant_type', 'authorization_code');
    formParams.append('redirect_uri', redirectUri);
    if (codeVerifier) {
      formParams.append('code_verifier', codeVerifier);
    }

    if (isDevMode()) {
      //? NEVER stringify the raw form — it carries `client_secret` (a
      //? long-lived credential) and the single-use authorization `code`. Log
      //? only the param NAMES so the dev sees the shape without leaking secrets
      //? into the log sink.
      getLogger().debug('oauth: token-exchange form params', { paramNames: [...formParams.keys()] });
    }
    const response = await fetch(provider.tokenExchangeURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: formParams.toString(),
    });
    if (!response.ok) {
      getLogger().warn('oauth: token exchange returned non-OK status', { provider: provider.name, status: response.status });
      return null;
    }
    return await response.json();
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
  /**
   * `true` only when the provider POSITIVELY reported the email as verified
   * (via `emailVerifiedKey`) or supplied it through a `getEmail` accessor that
   * itself filters on a verified flag (GitHub). `false` when the provider
   * exposes NO verified-email signal at all — used to fail-closed on
   * cross-provider account LINKING under the `'unified'` strategy (SEC-21/SEC-40),
   * where linking an unverified address to a victim's existing account is an
   * account-takeover vector. First-time account CREATION is unaffected.
   */
  emailVerified: boolean;
  /**
   * The RAW, un-stripped provider userInfo record. Threaded through so the
   * `extraSessionFields` hook receives every provider-specific claim (`sub`,
   * tenant id, custom claims) instead of the trimmed `{email,name,avatar}`
   * projection — the documented contract (SEC-3 / oauthProviders.ts hook docs).
   */
  rawUserData: OAuthUserData;
}

const fetchOAuthProfile = async (
  provider: FullOAuthProvider,
  accessToken: string,
): Promise<OAuthProfile | null> => {
  const getUserData = async (): Promise<unknown> => {
    const response = await fetch(provider.userInfoURL, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      getLogger().warn('oauth: userInfo fetch returned non-OK status', { provider: provider.name, status: response.status });
      return null;
    }
    return await response.json();
  };

  const [error, response] = await tryCatch(getUserData);
  if (error) {
    getLogger().error('oauth: userInfo fetch failed', error);
    return null;
  }

  const userData = asRecord(response);
  //? Provider responses are untyped JSON; read each field through `readString`
  //? so a non-string (object/number/missing) value falls back instead of
  //? stringifying to `[object Object]`.
  //? A present-but-empty name string falls back too (mirrors the old
  //? `String(value || 'didnt find a name')` truthy-coercion).
  const resolvedName = readStringField(userData, provider.nameKey);
  const name = resolvedName === '' ? 'didnt find a name' : resolvedName;
  const emailValue = userData[provider.emailKey];
  let email: string | undefined = typeof emailValue === 'string' ? emailValue : undefined;

  //? Track whether the provider POSITIVELY confirmed this email as verified.
  //? `emailVerifiedKey === true` (or any non-false value when the key is set and
  //? present) counts as verified; a provider with NO `emailVerifiedKey` exposes
  //? no signal, so the email stays `emailVerified: false` and only first-time
  //? account creation (not cross-provider linking) is allowed downstream.
  let emailVerified = false;

  //? Reject a provider-supplied email that the provider explicitly marks
  //? unverified (e.g. Discord's `verified: false`). A missing flag is treated
  //? as "no signal" (not verified, but not rejected outright — see the
  //? cross-provider link guard in `findOrCreateOAuthUser`). Defense-in-depth
  //? against account-linking takeover under `'unified'` (SEC-21).
  if (email && provider.emailVerifiedKey) {
    const verifiedFlag = userData[provider.emailVerifiedKey];
    //? Only a STRICT boolean `true` counts as verified. A present-but-not-true
    //? value (`false`, the strings "false"/"0", `0`, `null`) is an explicit
    //? not-verified signal → reject. This hardens against a CUSTOM provider that
    //? encodes the flag as a string/number (a truthy `"false"` previously slipped
    //? through as verified, re-opening cross-provider account-linking takeover).
    //? A MISSING flag (undefined) is "no signal" — not verified, not rejected here;
    //? the cross-provider link guard in findOrCreateOAuthUser handles it (SEC-21).
    if (verifiedFlag !== undefined && verifiedFlag !== true) {
      getLogger().warn('oauth: provider email is not verified — rejecting', { provider: provider.name });
      return null;
    }
    if (verifiedFlag === true) emailVerified = true;
  }

  //? Providers whose userinfo only returns an email once it is CONFIRMED (e.g.
  //? Facebook Graph /me) expose no separate verified flag — the presence of the
  //? email IS the verified signal. `emailImpliesVerified` opts such a provider in
  //? so cross-provider LINK + first-login CREATION both treat it as verified.
  if (email && provider.emailImpliesVerified) {
    emailVerified = true;
  }

  const avatarId = provider.avatarCodeKey ? userData[provider.avatarCodeKey] : undefined;
  const avatarValue = provider.avatarKey
    ? readStringField(userData, provider.avatarKey)
    : (provider.getAvatar
      ? await provider.getAvatar({ userData, avatarId: typeof avatarId === 'string' ? avatarId : '', accessToken })
      : '');
  const avatar = typeof avatarValue === 'string' ? avatarValue : '';

  //? Some providers (GitHub) don't return email in /userinfo — fall back to the
  //? provider's `getEmail` accessor. GitHub's accessor only ever selects a
  //? `verified === true` address (see `githubProvider.getEmail`), so an email
  //? obtained this way is treated as positively verified for the cross-provider
  //? link guard (SEC-21).
  if (!email && provider.getEmail) {
    const selectedEmail = await provider.getEmail(accessToken);
    if (!selectedEmail) {
      getLogger().warn('oauth: no email found via provider.getEmail', { provider: provider.name });
      return null;
    }
    email = selectedEmail;
    emailVerified = true;
  }

  //? Normalize OAuth emails through the SAME gate as credentials (trim +
  //? lowercase + `isEmail`) before they reach the adapter. Credentials emails
  //? are normalized at `normalizeCredentials`; taking the provider value
  //? verbatim meant `Victim@x.com` (OAuth) and `victim@x.com` (credentials)
  //? resolved to different rows — which under the `'unified'` account strategy
  //? (case-sensitive lookup) silently DEFEATS cross-provider linking. A
  //? present-but-malformed provider email is treated as "no usable email".
  if (email !== undefined) {
    const normalizedEmail = email.trim().toLowerCase();
    if (!isEmail(normalizedEmail)) {
      getLogger().warn('oauth: provider returned a malformed email', { provider: provider.name });
      return null;
    }
    email = normalizedEmail;
  }

  return { email, name, avatar, emailVerified, rawUserData: userData };
};

interface ResolvedOAuthUser {
  user: SessionLayout;
  isNewUser: boolean;
}

const findOrCreateOAuthUser = async (
  provider: FullOAuthProvider,
  profile: OAuthProfile,
): Promise<ResolvedOAuthUser | null> => {
  const { email, name, avatar, emailVerified } = profile;
  if (!email) return null;

  const preLoginResult = await dispatchHook('preLogin', { email, provider: provider.name });
  if (preLoginResult.stopped) {
    getLogger().warn(`oauth login aborted by preLogin hook`, { errorCode: preLoginResult.signal.errorCode });
    return null;
  }

  const userAdapter = getUserAdapter();
  //? Under `'unified'` this links to an existing account with the same email
  //? created via ANY provider (incl. credentials); under `'per-provider'` it
  //? stays scoped to this provider (existing behavior).
  const [findError, findResponse] = await tryCatch(() =>
    resolveUserByEmail(userAdapter, { email, provider: provider.name })
  );
  if (findError) {
    getLogger().error('oauth: findByEmail failed', findError);
    return null;
  }

  if (findResponse?.id) {
    //? Fail-closed cross-provider account-LINK guard (SEC-21/SEC-40). Under the
    //? `'unified'` strategy `resolveUserByEmail` matches by email across every
    //? provider, so an OAuth sign-in can LINK into an account originally created
    //? by a DIFFERENT provider (incl. credentials). If the current provider did
    //? NOT positively verify the email (no `emailVerifiedKey` / `getEmail`
    //? verified-filter), an attacker who controls an unverified address equal to
    //? a victim's could take over that account. Refuse the link in that case —
    //? same-provider re-login and first-time account CREATION are unaffected, so
    //? existing flows for built-ins that DO verify (Google/GitHub/Discord) keep
    //? working. `'per-provider'` always matches within the same provider, so the
    //? cross-provider condition is never met there (no behaviour change).
    const existingProvider = findResponse.provider ?? null;
    //? Fail CLOSED on a missing provider field: treat unknown (null/undefined) as a
    //? cross-provider link so an unverified provider email can't link into an
    //? existing account whose record omits `provider` (a custom UserAdapter may not
    //? populate it). Same-provider re-login still matches (=== provider.name → not
    //? cross), and first-time creation is unaffected (this branch needs an existing id).
    const isCrossProviderLink = existingProvider !== provider.name;
    if (isCrossProviderLink && !emailVerified) {
      getLogger().warn(
        'oauth: refusing to link an unverified provider email to an existing account created by a different provider (account-takeover guard)',
        { provider: provider.name, existingProvider },
      );
      return null;
    }

    //? LOGIN-F18 (OAuth path): same async stat lookup via the shared helper.
    const uploadedAvatar = await resolveUploadedAvatar(findResponse.id);
    if (uploadedAvatar) {
      findResponse.avatar = uploadedAvatar;
    }

    const previousLogin = findResponse.lastLogin ?? null;
    const nowLogin = new Date();
    await tryCatch(() => userAdapter.update(findResponse.id, { lastLogin: nowLogin }));

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

  //? Fail-closed account-CREATION guard (M2), symmetric with the cross-provider
  //? LINK guard above. When NO account exists, a provider that did not positively
  //? verify the email (no `emailVerifiedKey === true` / `getEmail` /
  //? `emailImpliesVerified`) must not be able to seed a brand-new account bound to
  //? an address the signer-in may not own — a custom, non-verifying provider would
  //? otherwise let an attacker SQUAT a victim's email (blocking the victim's later
  //? signup with `login.emailExists` and, under `'unified'`, absorbing the victim's
  //? later verified sign-in into the attacker-seeded row). All built-in providers
  //? set `emailVerified` (Google/GitHub/Microsoft/Discord/Facebook), so this only
  //? refuses genuinely-unverified CUSTOM providers; such a provider must verify the
  //? email (set `emailVerifiedKey` / `getEmail` / `emailImpliesVerified`) to enable
  //? OAuth signup, rather than the framework trusting it by default.
  if (!emailVerified) {
    getLogger().warn(
      'oauth: refusing first-login account creation for an unverified provider email (account-squatting guard)',
      { provider: provider.name },
    );
    return null;
  }

  //? Gate OAuth first-login account CREATION on the same `auth.allowRegistration`
  //? flag the credentials register branch enforces. Without this, invite-only /
  //? admin-provisioned deployments (allowRegistration:false) are silently
  //? bypassable: anyone with an enabled provider's account completes the OAuth
  //? flow and gets a fresh account. Existing users hit the find-branch above and
  //? are unaffected; only NEW-account creation is refused. A consumer preRegister
  //? hook can still veto, but the documented gate must hold by construction.
  if (!getProjectConfig().auth.allowRegistration) {
    getLogger().warn('oauth: registration disabled — refusing first-login account creation');
    return null;
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
    avatarFallback: generateAvatarFallbackColor(),
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
    getLogger().warn(`[oauth] postLoginRedirect resolver threw`, { message: resolverError.message });
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

//? Whitelist the URL path segment against registered providers and verify the
//? request carries a URL. Returns the matched full provider + its canonical name,
//? or null when the segment is absent, unregistered, or an incomplete provider
//? shape. Separating this keeps the callback routing concern out of the main flow.
const resolveProviderFromCallback = (
  pathname: string,
  url: string | undefined,
): { provider: FullOAuthProvider; providerName: string } | null => {
  const rawProviderSegment = pathname.split('/')[3]; // google/github/etc.
  if (!rawProviderSegment || !url) return null;
  const found = getOAuthProviders().find(p => p.name === rawProviderSegment);
  if (!found || !isFullOAuthProvider(found)) return null;
  return { provider: found, providerName: found.name };
};

//? Merge per-provider runtime extras (calendar tokens, tenant ids, etc.) into
//? the session object IN PLACE before it is persisted. Errors are non-fatal —
//? a failing or absent hook must not block the user from signing in (SEC-10).
const applyExtraSessionFields = async (
  user: SessionLayout,
  provider: FullOAuthProvider,
  profile: OAuthProfile,
  accessToken: string,
): Promise<void> => {
  const { extraSessionFields } = provider;
  if (!extraSessionFields) return;

  //? Pass the RAW provider userData (SEC-3) so the hook sees every provider
  //? claim (`sub`, tenant id, custom claims) rather than the trimmed projection.
  const [extraErr, extra] = await tryCatch(async () =>
    extraSessionFields({ userData: profile.rawUserData, accessToken }),
  );
  if (extraErr) {
    getLogger().warn(`[oauth:${provider.name}] extraSessionFields hook threw — continuing without extras`, { err: extraErr });
    return;
  }
  if (!extra) return;

  //? Strip framework-owned session keys before merging (SEC-10).
  const { id, token, csrfToken, password, ...safeExtra } = extra;
  if (id !== undefined || token !== undefined || csrfToken !== undefined || password !== undefined) {
    getLogger().warn(
      `[oauth:${provider.name}] extraSessionFields returned framework-owned key(s) (id/token/csrfToken/password) — dropped`,
    );
  }
  //? SEC: warn when extra fields appear to contain bearer credentials. Access
  //? tokens stored in the Redis session are broadcast to connected sockets via
  //? updateSession — they should not be in session fields unless intentional.
  //? The stripped set above already removes "token"; this covers other key names.
  const CREDENTIAL_PATTERN = /token|secret|key|auth/i;
  const suspiciousKeys = Object.keys(safeExtra).filter(k => CREDENTIAL_PATTERN.test(k));
  if (suspiciousKeys.length > 0) {
    getLogger().warn(
      `[oauth:${provider.name}] extraSessionFields contains field(s) that look like credentials (${suspiciousKeys.join(', ')}) — these will be stored in the Redis session and broadcast to connected sockets. Consider keeping them server-side only.`,
    );
  }
  Object.assign(user, safeExtra);
};

//? Assemble the fallback redirect URL for the OAuth callback by preferring the
//? tamper-proof return URL stored server-side with the OAuth state, then the
//? caller-supplied default, then the configured `loginRedirectUrl`, then '/'.
const resolveOAuthFallbackUrl = (
  stateEntry: OAuthStateEntry,
  options: { defaultRedirectUrl?: string },
): string => {
  const stateReturnUrl =
    stateEntry.returnUrl && isAllowedRedirectUrl(stateEntry.returnUrl)
      ? stateEntry.returnUrl
      : undefined;

  return (
    stateReturnUrl
    ?? options.defaultRedirectUrl
    ?? getProjectConfig().loginRedirectUrl
    ?? '/'
  );
};

// Route that handles the callback from the OAuth provider
const loginCallback = async (
  pathname: string,
  req: IncomingMessage,
  _res: ServerResponse,
  options: { defaultRedirectUrl?: string; supersedeToken?: string } = {},
): Promise<OAuthCallbackResult | false> => {
  const providerResolution = resolveProviderFromCallback(pathname, req.url);
  if (!providerResolution) return false;
  const { provider, providerName } = providerResolution;

  // req.url is guaranteed non-null here: resolveProviderFromCallback returns null when url is absent
  const queryString = (req.url ?? '').split('?')[1] ?? '';
  const params = new URLSearchParams(queryString);
  const code = params.get('code');
  const state = params.get('state');

  //? Browser-binding (F1): the nonce the server set as the `ls-oauth-state`
  //? cookie at the authorize step must round-trip back and match the value
  //? stored alongside the Redis state entry. A missing/mismatched cookie means
  //? this browser did NOT start the flow — reject before any token exchange.
  const cookieNonce = getCookieValue(req.headers.cookie, OAUTH_STATE_COOKIE_NAME) ?? '';
  const stateEntry = await consumeOAuthState(provider.name, state ?? '', cookieNonce);
  if (!stateEntry) {
    getLogger().warn('oauth: invalid, missing, or unbound state', { provider: provider.name });
    emitLoginFailed({ provider: providerName, reason: 'oauth.invalidState', stage: 'oauth' });
    return false;
  }

  if (!code) {
    getLogger().warn('oauth: no code provided in callback url', { provider: provider.name });
    emitLoginFailed({ provider: providerName, reason: 'oauth.noCode', stage: 'oauth' });
    return false;
  }

  //? PKCE (F11): replay the verifier stored with the state entry at token
  //? exchange when the provider opted in. `undefined` for non-PKCE providers,
  //? in which case the exchange is byte-identical to before.
  const accessToken = await exchangeOAuthToken(provider, code, stateEntry.codeVerifier);
  if (!accessToken) {
    emitLoginFailed({ provider: providerName, reason: 'oauth.tokenExchangeFailed', stage: 'oauth' });
    return false;
  }

  const profile = await fetchOAuthProfile(provider, accessToken);
  if (!profile) {
    emitLoginFailed({ provider: providerName, reason: 'oauth.profileFetchFailed', stage: 'oauth' });
    return false;
  }

  const resolved = await findOrCreateOAuthUser(provider, profile);
  if (!resolved) {
    emitLoginFailed({ provider: providerName, email: profile.email, reason: 'oauth.userResolveFailed', stage: 'oauth' });
    return false;
  }

  const newToken = randomBytes(32).toString('hex');
  resolved.user.token = newToken;

  //? Per-provider runtime extras (calendar tokens, tenant ids, etc.) are merged
  //? into the session BEFORE save. Errors are non-fatal — see applyExtraSessionFields.
  await applyExtraSessionFields(resolved.user, provider, profile, accessToken);

  const saved = await saveSession(newToken, resolved.user, true, { supersedeToken: options.supersedeToken });
  if (!saved.ok) {
    //? Session never persisted — abort the OAuth callback so authCallbackRoute
    //? returns "Login failed" instead of redirecting with a dead token.
    getLogger().error(`[oauth:${providerName}] saveSession failed — aborting callback`, { errorCode: saved.errorCode });
    emitLoginFailed({ provider: providerName, userId: resolved.user.id, reason: saved.errorCode, stage: 'oauth' });
    return false;
  }

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

  const fallbackUrl = resolveOAuthFallbackUrl(stateEntry, options);
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
