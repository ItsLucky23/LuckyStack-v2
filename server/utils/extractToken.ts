import { Socket } from 'socket.io';

/**
 * Extract the authentication token from a Socket.io connection.
 * 
 * Checks environment variable `VITE_SESSION_BASED_TOKEN` to determine where to look:
 * - `true`: Token is in `socket.handshake.auth.token` (sessionStorage on client)
 * - `false`: Token is in cookies via `socket.handshake.headers.cookie`
 * 
 * @param socket - The Socket.io socket instance
 * @returns The token string or null if not found
 * 
 * @example
 * ```typescript
 * import { extractTokenFromSocket } from '../utils/extractToken';
 * 
 * io.on('connection', (socket) => {
 *   const token = extractTokenFromSocket(socket);
 *   if (token) {
 *     // User has a token
 *   }
 * });
 * ```
 */
export const extractTokenFromSocket = (socket: Socket): string | null => {
  const cookie = socket.handshake.headers.cookie;
  const sessionToken = socket.handshake.auth?.token;

  // Session-based token (stored in sessionStorage on client)
  if (process.env.VITE_SESSION_BASED_TOKEN === 'true') {
    return sessionToken ?? null;
  }

  // Cookie-based token
  if (process.env.VITE_SESSION_BASED_TOKEN === 'false' && cookie) {
    // Parse the token from cookie string "token=abc123; other=value"
    const tokenCookie = cookie
      .split('; ')
      .find(row => row.startsWith('token='));

    return tokenCookie?.split('=')[1] ?? null;
  }

  // Fallback: try both methods
  return sessionToken ?? (cookie?.split('=')[1]) ?? null;
};
