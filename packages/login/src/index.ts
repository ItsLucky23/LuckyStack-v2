// Registers module augmentations on @luckystack/core for auth/session hooks.
import './hookPayloads';

export type { BaseSessionLayout, SessionLocation, AuthProps } from './sessionLayout';
export type {
  PostLoginPayload,
  PostRegisterPayload,
  PostLogoutPayload,
  PostSessionCreatePayload,
  PostSessionDeletePayload,
} from './hookPayloads';
export { saveSession, getSession, deleteSession, getAllSessions } from './session';
export { loginWithCredentials, loginCallback, createOAuthState } from './login';
export { default as oauthProviders } from './loginConfig';
export { logout } from './logout';
