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
} from './hookPayloads';
export { saveSession, getSession, deleteSession, getAllSessions, revokeUserSessions } from './session';
export { loginWithCredentials, loginCallback, createOAuthState } from './login';
export { logout } from './logout';

// Password-reset primitives. Used by the framework's `framework`-mode
// forgot-password flow AND exported for consumers who picked `'custom'`.
export {
  createPasswordResetToken,
  consumePasswordResetToken,
  updatePasswordHash,
  verifyPassword,
} from './passwordReset';
export { sendPasswordResetEmail } from './forgotPassword';

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
