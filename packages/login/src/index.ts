// Registers module augmentations on @luckystack/core for auth/session hooks.
import './hookPayloads';

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
  PreEmailChangePayload,
  PostEmailChangeRequestedPayload,
  PostEmailChangedPayload,
} from './hookPayloads';
export { saveSession, getSession, deleteSession, getAllSessions, revokeUserSessions, sessionKeyFor, activeUsersKeyFor } from './session';
export { registerSessionAdapter, getSessionAdapter, redisSessionAdapter } from './sessionAdapter';
export type { SessionAdapter } from './sessionAdapter';
export { loginWithCredentials, loginCallback, createOAuthState, registerWithCredentials, loginWithCredentialsCore } from './login';
export { logout } from './logout';

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
  getOAuthProviders,
  isFullOAuthProvider,
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
