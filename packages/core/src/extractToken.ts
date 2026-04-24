/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
import { Socket } from 'socket.io';
import { getProjectConfig } from './projectConfig';
import { serverRuntimeConfig } from './runtimeConfig';
import { getCookieValue } from './cookies';

const SESSION_COOKIE_NAME = serverRuntimeConfig.http.sessionCookieName;

/**
 * Extract the authentication token from a Socket.io connection.
 *
 * Checks `config.sessionBasedToken` to determine where to look:
 * - `true`: Token is in `socket.handshake.auth.token` (sessionStorage on client)
 * - `false`: Token is in cookies via `socket.handshake.headers.cookie`
 *
 * @param socket - The Socket.io socket instance
 * @returns The token string or null if not found
 */
export const extractTokenFromSocket = (socket: Socket): string | null => {
  const cookie = socket.handshake.headers.cookie;
  const sessionToken = typeof socket.handshake.auth?.token === 'string'
    ? socket.handshake.auth.token
    : null;
  const cookieToken = getCookieValue(cookie, SESSION_COOKIE_NAME);

  // Session-based token (stored in sessionStorage on client)
  if (getProjectConfig().session.basedToken) {
    return sessionToken ?? cookieToken;
  }

  // Cookie-based token
  return cookieToken ?? sessionToken;
};
