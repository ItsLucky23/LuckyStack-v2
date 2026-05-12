import type { IncomingMessage, ServerResponse } from 'node:http';
import { dispatchHook, getProjectConfig } from '@luckystack/core';
import { getSession } from '@luckystack/login';

//? Returns true when the request was rejected (CSRF mismatch) and the response
//? has been ended. Caller should bail out of the request loop.
export const enforceCsrfOnStateChangingRequest = async ({
  req,
  res,
  routePath,
  token,
  requestId,
}: {
  req: IncomingMessage;
  res: ServerResponse;
  routePath: string;
  token: string | null;
  requestId?: string;
}): Promise<boolean> => {
  const config = getProjectConfig();
  const isCookieMode = !config.session.basedToken;
  const isStateChanging = req.method !== 'GET' && req.method !== 'OPTIONS';
  const isCallbackPath = routePath.startsWith('/auth/callback');
  const looksLikeFrameworkRoute =
    routePath.startsWith('/api/')
    || routePath.startsWith('/sync/')
    || routePath.startsWith('/auth/api/');

  if (!(isCookieMode && isStateChanging && looksLikeFrameworkRoute && !isCallbackPath && token)) {
    return false;
  }

  const csrfSession = await getSession(token);
  if (!csrfSession?.id) return false;

  const headerValue = req.headers['x-csrf-token'];
  const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (provided && provided === csrfSession.csrfToken) return false;

  void dispatchHook('csrfMismatch', {
    route: routePath,
    method: req.method,
    requestId,
    userId: csrfSession.id,
    providedToken: Boolean(provided),
  });

  res.statusCode = 403;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    status: 'error',
    errorCode: 'auth.csrfMismatch',
    message: 'CSRF token missing or invalid. Fetch /auth/csrf first.',
  }));
  return true;
};
