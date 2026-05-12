import { getSession } from '@luckystack/login';
import type { HttpRouteHandler } from './types';

export const handleCsrfRoute: HttpRouteHandler = async ({ res, routePath, token }) => {
  if (routePath !== '/auth/csrf') return false;

  if (!token) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'error', errorCode: 'auth.unauthenticated' }));
    return true;
  }
  const csrfSession = await getSession(token);
  if (!csrfSession?.id) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'error', errorCode: 'auth.unauthenticated' }));
    return true;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    status: 'success',
    csrfToken: csrfSession.csrfToken ?? null,
  }));
  return true;
};
