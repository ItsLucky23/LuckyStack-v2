// Registers module augmentations on @luckystack/core for auth/session hooks.
import './hookPayloads';

//? Decoupling seam (0.2.0): register this package's session implementation into
//? @luckystack/core so api/sync/presence/server read sessions through core's
//? null-safe accessors WITHOUT importing @luckystack/login directly. This is
//? what makes login a genuine OPTIONAL package — when it isn't installed nothing
//? registers and the accessors return null (unauthenticated). Side-effect at
//? module load: any app that imports @luckystack/login (its overlay, LoginForm,
//? config) wires this before the first request is served.
import { registerSessionProvider } from '@luckystack/core';
import { saveSession as _saveSession, getSession as _getSession, deleteSession as _deleteSession } from './session';
import { logout as _logout } from './logout';
registerSessionProvider({
  getSession: _getSession,
  saveSession: _saveSession,
  deleteSession: _deleteSession,
  logout: ({ token, socket, userId, skipSessionDelete }) =>
    _logout({ token, socket, userId: userId ?? null, skipSessionDelete }),
});

//? Subscribe the per-account brute-force lockout to the `loginFailed` hook at
//? boot (F7). Idempotent + cheap; the recorder no-ops unless
//? `rateLimiting.auth.enabled` is set, so this is safe to wire unconditionally.
import { registerAuthLockoutHook } from './authLockout';
registerAuthLockoutHook();

export type { BaseSessionLayout, SessionLocation, AuthProps } from './sessionLayout';
export type {
  PreLoginPayload,
  PostLoginPayload,
  PreRegisterPayload,
  PostRegisterPayload,
  PreLogoutPayload,
  PostLogoutPayload,
  PreSessionCreatePayload,
  PostSessionCreatePayload,
  PreSessionDeletePayload,
  PostSessionDeletePayload,
  PasswordResetRequestedPayload,
  PrePasswordResetCompletedPayload,
  PasswordResetCompletedPayload,
  PrePasswordChangedPayload,
  PasswordChangedPayload,
  PreEmailChangePayload,
  PostEmailChangeRequestedPayload,
  PostEmailChangedPayload,
  LoginFailedPayload,
  PreAccountDeletePayload,
  PostAccountDeletePayload,
} from './hookPayloads';
export { saveSession, getSession, deleteSession, getAllSessions, revokeUserSessions, sessionKeyFor, activeUsersKeyFor } from './session';
export { registerSessionAdapter, getSessionAdapter, redisSessionAdapter } from './sessionAdapter';
export type { SessionAdapter } from './sessionAdapter';
export { registerSessionSanitizer, getSessionSanitizer } from './sessionSanitizer';
export type { SessionSanitizer } from './sessionSanitizer';
export { loginWithCredentials, loginCallback, createOAuthState, registerWithCredentials, loginWithCredentialsCore, finalizeLogin, registerTwoFactorGate } from './login';
export type {
  CredentialsLoginResult,
  CredentialsLoginSuccess,
  CredentialsLoginChallenge,
  CredentialsLoginFailure,
  TwoFactorMethod,
  TwoFactorGate,
  OAuthCallbackResult,
} from './login';
export type { CreateOAuthStateResult } from './login';
export { OAUTH_STATE_COOKIE_NAME } from './login';
export { logout } from './logout';

// Per-account brute-force lockout (F7). The hook is auto-registered at boot;
// these are exported for consumers who want to query/clear a lock explicitly
// (e.g. an admin "unlock account" action) or build their own surface on top.
export { isAccountLocked, recordAuthFailure, clearAuthFailures } from './authLockout';

// Password-reset primitives. Used by the framework's `framework`-mode
// forgot-password flow AND exported for consumers who picked `'custom'`.
export {
  createPasswordResetToken,
  consumePasswordResetToken,
  updatePasswordHash,
  verifyPassword,
  PasswordPolicyError,
} from './passwordReset';
export { validatePassword } from './passwordPolicy';
export { sendPasswordResetEmail } from './forgotPassword';

// Email-change primitives. Used by the framework's settings flow to confirm
// a new email address before applying it (token mailed to NEW address proves
// ownership of the new mailbox).
export {
  createEmailChangeToken,
  consumeEmailChangeToken,
} from './emailChange';
export type { EmailChangePayload } from './emailChange';
export { sendEmailChangeConfirmation } from './emailChangeNotification';

// OAuth provider registry + composable helpers.
export {
  registerOAuthProviders,
  registerOAuthProviderFactory,
  getOAuthProviders,
  isFullOAuthProvider,
  asOAuthUserData,
  credentialsProvider,
  googleProvider,
  githubProvider,
  discordProvider,
  facebookProvider,
  microsoftProvider,
} from './oauthProviders';
export type {
  OAuthProvider,
  CredentialsProvider,
  FullOAuthProvider,
  OAuthUserData,
} from './oauthProviders';

// User adapter registry: lets consumers swap out the Prisma User model behind auth flows.
export {
  registerUserAdapter,
  getUserAdapter,
  isUserAdapterRegistered,
  defaultPrismaUserAdapter,
} from './userAdapter';
export type {
  UserAdapter,
  UserAdapterCreateInput,
  UserRecord,
} from './userAdapter';

// 2FA (ADR 0024): TOTP (authenticator apps) + email-code fallback + recovery
// codes. IMPORTING THIS MODULE ARMS THE LOGIN GATE (it registers itself into
// login.ts at init) — which happens right here in the package index, so any
// app with @luckystack/login installed gets the challenge step for enrolled
// users once `auth.twoFactor` is 'optional'.
export {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  disableTwoFactor,
  regenerateRecoveryCodes,
  verifyTwoFactorChallenge,
  requestTwoFactorEmailCode,
  availableTwoFactorMethods,
  createTwoFactorChallengeIfRequired,
} from './twoFactor';
export type { TotpEnrollmentStart, ConfirmTotpEnrollmentResult, VerifyTwoFactorInput } from './twoFactor';
export { verifyTotp, generateTotpSecret, buildOtpauthUri, hotp, base32Encode, base32Decode } from './totp';

// Passwordless email-code login (ADR 0024) + the reusable numeric-OTP store.
export { requestEmailLoginCode, verifyEmailLoginCode } from './emailCodeLogin';
export type { RequestEmailLoginCodeInput, RequestEmailLoginCodeResult, VerifyEmailLoginCodeInput } from './emailCodeLogin';
export { issueEmailCode, verifyEmailCode, clearEmailCode, generateNumericCode } from './emailOtp';
export type { EmailOtpPurpose, EmailCodeVerdict } from './emailOtp';

// Post-login redirect resolver — lets consumers compute the OAuth callback
// destination dynamically (per-user, per-tenant, per-provider).
export {
  registerPostLoginRedirect,
  getPostLoginRedirect,
} from './redirectResolver';
export type {
  PostLoginRedirectResolver,
  PostLoginRedirectInput,
} from './redirectResolver';
