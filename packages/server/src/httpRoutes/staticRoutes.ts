import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { StaticFileHandler } from '../types';
import type { HttpRouteHandler } from './types';

const KNOWN_STATIC_FILE_REGEX = /^\/(assets\/[a-zA-Z0-9_/-]+|[a-zA-Z0-9_-]+)\.(png|jpg|jpeg|gif|svg|html|css|js)$/;

//? Source-disclosure denylist. The server bundle (`dist/server.js`) and ANY
//? source map (`*.map`) must never be served by a framework static path —
//? leaking either hands an attacker the readable server source. This guards
//? every branch below (assets, known-extension, SPA catch-all) regardless of
//? which `serveFile` the consumer wired, so the protection is structural and
//? does not rely on the default noop handler.
const SERVE_DENYLIST_REGEX = /(^\/server\.js$)|(\.map$)/;

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
  // ── denylist — never serve the server bundle or source maps ───────────
  if (SERVE_DENYLIST_REGEX.test(routePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return true;
  }

  // ── /assets/* — static assets ──────────────────────────────────────────
  //? `startsWith` not `includes` — avoids matching `/other/assets/foo` and
  //? prevents the indexOf slice from drifting to an interior segment.
  if (routePath.startsWith('/assets/')) {
    //? Reject path-traversal at the framework boundary BEFORE handing the path to
    //? the consumer-supplied serveFile. routePath is already percent-DECODED, so
    //? `/assets/%2e%2e/server.js` arrives as `/assets/../server.js` and would
    //? otherwise reach a naive `path.join(dir, req.url)` static handler (source
    //? disclosure). The leading denylist only blocks the literal `/server.js`, not
    //? a traversal to it — so this `..` reject makes the protection structural.
    if (routePath.includes('..')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return true;
    }
    if (!options.serveFile) {
      res.writeHead(404);
      res.end('Not Found');
      return true;
    }
    await serveWithRewrittenUrl(options.serveFile, req, res, routePath);
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
