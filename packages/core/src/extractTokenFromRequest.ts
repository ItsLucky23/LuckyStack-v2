import { IncomingMessage } from 'node:http';
import { getProjectConfig } from './projectConfig';
import { getCookieValue } from './cookies';

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
  // Node types `authorization` as `string`, but duplicate headers can arrive as
  // an array at runtime via the IncomingHttpHeaders index signature. Treat the
  // value as unknown and narrow with typeof guards so a single string is used.
  const rawAuthHeader: unknown = req.headers.authorization;
  const authHeader = typeof rawAuthHeader === 'string'
    ? rawAuthHeader
    : (Array.isArray(rawAuthHeader) && typeof rawAuthHeader[0] === 'string' ? rawAuthHeader[0] : undefined);
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  const cookieToken = getCookieValue(req.headers.cookie, getProjectConfig().http.sessionCookieName);

  // Prefer the configured mode, but fall back to the other transport.
  if (getProjectConfig().session.basedToken) {
    return bearerToken ?? cookieToken;
  }

  return cookieToken ?? bearerToken;
};
