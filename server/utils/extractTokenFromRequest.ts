import { IncomingMessage } from 'node:http';
import { sessionBasedToken } from '../../config';
import { getCookieValue } from './cookies';

/**
 * Extract the authentication token from an HTTP request.
 * 
 * Supports tokens from:
 * - `Authorization: Bearer <token>` header
 * - `token=<token>` cookie
 * 
 * @param req - The HTTP incoming message
 * @returns The token string or null if not found
 * 
 * @example
 * ```typescript
 * const token = extractTokenFromRequest(req);
 * const session = token ? await getSession(token) : null;
 * ```
 */
export const extractTokenFromRequest = (req: IncomingMessage): string | null => {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  const cookieToken = getCookieValue(req.headers.cookie, 'token');

  // Prefer the configured mode, but fall back to the other transport.
  if (sessionBasedToken) {
    return bearerToken ?? cookieToken;
  }

  return cookieToken ?? bearerToken;
};

