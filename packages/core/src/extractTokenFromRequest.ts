import { IncomingMessage } from 'node:http';
import { getProjectConfig } from './projectConfig';
import { serverRuntimeConfig } from './runtimeConfig';
import { getCookieValue } from './cookies';

const SESSION_COOKIE_NAME = serverRuntimeConfig.http.sessionCookieName;

/**
 * Extract the authentication token from an HTTP request.
 *
 * Supports tokens from:
 * - `Authorization: Bearer <token>` header
 * - the configured session cookie
 *
 * @param req - The HTTP incoming message
 * @returns The token string or null if not found
 */
export const extractTokenFromRequest = (req: IncomingMessage): string | null => {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  const cookieToken = getCookieValue(req.headers.cookie, SESSION_COOKIE_NAME);

  // Prefer the configured mode, but fall back to the other transport.
  if (getProjectConfig().session.basedToken) {
    return bearerToken ?? cookieToken;
  }

  return cookieToken ?? bearerToken;
};
