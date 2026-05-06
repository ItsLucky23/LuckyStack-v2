//? Dev-only API docs UI for LuckyStack.
//?
//? Mounts a single page at `/_docs` (configurable) that fetches the
//? framework's `apiDocs.generated.json` and renders every API endpoint
//? grouped by page, with method, auth, rate limit, input shape, and
//? output shape.
//?
//? Usage:
//?   // luckystack/docs-ui/index.ts
//?   import { mountDocsUi } from '@luckystack/docs-ui';
//?   mountDocsUi();  // Auto-disables in production unless { enabledInProd: true }
//?
//? The mount function returns a `customRoutes` handler — pass it to
//? `createLuckyStackServer({ customRoutes })` (or compose with another
//? handler if you have one). It honors the request only when the URL
//? matches the configured `routePath`; everything else falls through.

import fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getProjectConfig, getGeneratedApiDocsPath } from '@luckystack/core';
import { renderDocsHtml } from './docsHtml';

export interface MountDocsUiOptions {
  /** Path the docs UI is served from. Default: `/_docs`. */
  routePath?: string;
  /**
   * Page title shown in the header + browser tab. Defaults to the project's
   * `pageTitle` config followed by " — API docs".
   */
  pageTitle?: string;
  /**
   * Allow rendering the docs UI in production. Default: false. Useful only
   * when the docs are intentionally public (developer-portal, internal-only
   * deployment, etc.). When false, the route returns 404 in production.
   */
  enabledInProd?: boolean;
  /**
   * Override the path to `apiDocs.generated.json`. Defaults to whatever
   * `getGeneratedApiDocsPath()` resolves to via ProjectConfig.paths.
   */
  apiDocsPath?: string;
}

export type DocsRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<boolean>;

/**
 * Returns a route handler compatible with `createLuckyStackServer`'s
 * `customRoutes` option. The handler returns `true` (response sent) when
 * the URL matches the configured docs route, `false` otherwise.
 */
export const mountDocsUi = (options: MountDocsUiOptions = {}): DocsRouteHandler => {
  const routePath = options.routePath ?? '/_docs';
  const jsonPath = `${routePath}/api.json`;

  return async (req, res) => {
    const url = req.url ?? '';
    const [pathOnly] = url.split('?');

    if (pathOnly !== routePath && pathOnly !== jsonPath) {
      return false;
    }

    if (process.env.NODE_ENV === 'production' && !options.enabledInProd) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Not Found');
      return true;
    }

    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Method Not Allowed');
      return true;
    }

    if (pathOnly === jsonPath) {
      const docsPath = options.apiDocsPath ?? getGeneratedApiDocsPath();
      try {
        const content = await fs.readFile(docsPath, 'utf8');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(content);
      } catch {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          error: 'apiDocs.generated.json not found',
          expectedAt: docsPath,
          hint: 'Run `npm run generateArtifacts` to generate it.',
        }));
      }
      return true;
    }

    //? Serve the HTML page itself.
    const projectTitle = (() => {
      try {
        return ((getProjectConfig() as unknown) as { pageTitle?: string }).pageTitle;
      } catch {
        return undefined;
      }
    })();
    const fallbackTitle = projectTitle ?? 'LuckyStack';
    const title = options.pageTitle ?? `${fallbackTitle} — API docs`;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(renderDocsHtml(jsonPath, title));
    return true;
  };
};
