import type { HttpRouteHandler } from './types';

export const handleFaviconRoute: HttpRouteHandler = async ({ res, routePath, options }) => {
  if (routePath !== '/favicon.ico') return false;
  if (options.serveFavicon) {
    await options.serveFavicon(res);
    return true;
  }
  res.writeHead(404);
  res.end();
  return true;
};
