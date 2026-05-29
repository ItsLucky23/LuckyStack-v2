import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { StaticFileHandler } from '../types';
import type { HttpRouteHandler } from './types';

const KNOWN_STATIC_FILE_REGEX = /^\/(assets\/[a-zA-Z0-9_/-]+|[a-zA-Z0-9_-]+)\.(png|jpg|jpeg|gif|svg|html|css|js)$/;

//? `serveFile` consumers (Vite middleware, custom static handlers) read
//? `req.url`, so we need to swap it for the rewritten asset path. We swap
//? around the call and restore on return so anything downstream that
//? observes `req.url` (request loggers, metrics middleware) still sees the
//? original incoming URL after this handler.
const serveWithRewrittenUrl = async (
  serveFile: StaticFileHandler,
  req: IncomingMessage,
  res: ServerResponse,
  rewrittenUrl: string,
): Promise<void> => {
  const originalUrl = req.url;
  req.url = rewrittenUrl;
  try {
    await serveFile(req, res);
  } finally {
    req.url = originalUrl;
  }
};

export const handleStaticAndSpaFallback: HttpRouteHandler = async ({
  req,
  res,
  routePath,
  options,
}) => {
  // ── /assets/* — static assets ──────────────────────────────────────────
  if (routePath.includes('/assets/')) {
    if (!options.serveFile) {
      res.writeHead(404);
      res.end('Not Found');
      return true;
    }
    const assetPath = routePath.slice(routePath.indexOf('/assets/'));
    await serveWithRewrittenUrl(options.serveFile, req, res, assetPath);
    return true;
  }

  // ── *.{png,jpg,...} — known static file extensions ────────────────────
  if (KNOWN_STATIC_FILE_REGEX.test(routePath)) {
    if (!options.serveFile) {
      res.writeHead(404);
      res.end('Not Found');
      return true;
    }
    await options.serveFile(req, res);
    return true;
  }

  // ── path with extension we don't recognize — 404 ──────────────────────
  if (path.extname(routePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return true;
  }

  // ── catch-all (index.html for SPA routing) ────────────────────────────
  if (!options.serveFile) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return true;
  }

  await serveWithRewrittenUrl(options.serveFile, req, res, '/');
  return true;
};
