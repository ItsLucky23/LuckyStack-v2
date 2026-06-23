import {
  clearAllHooks,
  clearAllRateLimits,
  getProjectConfig,
  formatKey,
  redis,
  tryCatch,
} from '@luckystack/core';
import { timingSafeStringEqual } from './timingSafeEqual';
import type { HttpRouteHandler } from './types';

export const handleTestResetRoute: HttpRouteHandler = async ({ req, res, routePath }) => {
  if (routePath !== getProjectConfig().http.testResetEndpoint) return false;

  //? Fail-closed: require explicit dev/test NODE_ENV (not just "anything but
  //? production") so a missing or misconfigured NODE_ENV cannot expose this
  //? destructive endpoint. Also require TEST_RESET_TOKEN unconditionally —
  //? an unset token must NOT mean "no auth required".
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv !== 'development' && nodeEnv !== 'test') {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'error', errorCode: 'notFound' }));
    return true;
  }
  //? Only POST performs the destructive reset (the documented contract). A GET/HEAD
  //? would also sidestep the origin gate's state-changing fail-closed branch, so
  //? reject any non-POST method. Runs AFTER the env check so prod still 404s rather
  //? than revealing the endpoint via a 405.
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'error', errorCode: 'api.methodNotAllowed' }));
    return true;
  }
  const requiredToken = process.env.TEST_RESET_TOKEN;
  const providedToken = req.headers['x-test-reset-token'];
  const tokenValue = Array.isArray(providedToken) ? providedToken[0] : providedToken;
  if (!requiredToken || !tokenValue || !timingSafeStringEqual(tokenValue, requiredToken)) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'error', errorCode: 'auth.forbidden' }));
    return true;
  }

  const cleared: string[] = [];
  await clearAllRateLimits();
  cleared.push('rateLimits');

  //? Flush sessions + activeUsers Redis keys so integration tests start from
  //? a clean slate. Patterns are derived through the shared `formatKey(...)`
  //? authority so they track any registered key formatter (see also
  //? session.ts, sessionAdapter.ts, rateLimiter.ts).
  const sessionPattern = `${formatKey('-session', '')}:*`;
  const activeUsersPattern = `${formatKey('-activeUsers', '')}:*`;

  const scanAndDelete = async (pattern: string, label: string): Promise<number> => {
    const [error, deleted] = await tryCatch(async () => {
      let cursor = '0';
      let total = 0;
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = next;
        if (Array.isArray(keys) && keys.length > 0) {
          await redis.del(...keys);
          total += keys.length;
        }
      } while (cursor !== '0');
      return total;
    });
    if (error || !deleted) return 0;
    if (deleted > 0) cleared.push(label);
    return deleted;
  };

  await scanAndDelete(sessionPattern, 'sessions');
  await scanAndDelete(activeUsersPattern, 'activeUsers');

  //? Opt-in hook clear via `?include=hooks` because clearing all hooks would
  //? also drop framework-internal handlers (e.g. presence postLogout). URL
  //? parsing failure is the expected branch for malformed `req.url`, so use
  //? `URL.canParse` instead of try/catch.
  const rawUrl = req.url ?? '/';
  //? Use a fixed loopback base — `req.headers.host` is client-controlled and
  //? must not influence URL resolution; only the path and query matter here.
  const includeFlag = URL.canParse(rawUrl, 'http://localhost')
    ? new URL(rawUrl, 'http://localhost').searchParams.get('include') ?? ''
    : '';
  if (includeFlag.split(',').map((s) => s.trim()).includes('hooks')) {
    clearAllHooks();
    cleared.push('hooks');
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ status: 'success', cleared }));
  return true;
};
