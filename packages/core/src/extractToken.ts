/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
import { Socket } from 'socket.io';
import { getProjectConfig } from './projectConfig';
import { getCookieValue } from './cookies';

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
//? `Pick<Socket, 'handshake'>` (not `Socket`) so this also accepts a
//? `RemoteSocket` from `io.fetchSockets()` — the cross-instance fan-out path
//? only has RemoteSockets, which expose `handshake` but not the full Socket API.
export const extractTokenFromSocket = (socket: Pick<Socket, 'handshake'>): string | null => {
  const cookie = socket.handshake.headers.cookie;
  const sessionToken = typeof socket.handshake.auth?.token === 'string'
    ? socket.handshake.auth.token
    : null;
  const cookieToken = getCookieValue(cookie, getProjectConfig().http.sessionCookieName);

  // Session-based token (stored in sessionStorage on client)
  if (getProjectConfig().session.basedToken) {
    return sessionToken ?? cookieToken;
  }

  // Cookie-based token
  return cookieToken ?? sessionToken;
};
