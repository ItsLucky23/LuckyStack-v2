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
import { getBindAddress, getGeneratedApiDocsPath, isLoopbackIp, tryCatch } from '@luckystack/core';
import { renderDocsHtml } from './docsHtml';

export interface DocsBranding {
  /**
   * Logo URL shown in the header. Accepts `https:`, `http:`, and scheme-free
   * relative URLs. `data:` and `javascript:` URLs are rejected (the logo will
   * be silently omitted) because SVG data-URIs can carry script.
   */
  logoUrl?: string;
  /** CSS color for the header / accent (`#hex` or `rgb()` literal). */
  brandColor?: string;
  /** Web-safe font family for the page. */
  fontFamily?: string;
}

/**
 * Custom HTML builder. Receives the JSON-endpoint path the page should
 * fetch from + page title + branding; returns the full HTML document
 * (`<!doctype html>` + everything). Use to swap layout entirely (sidebar
 * vs tabs, dark/light theme, embedded auth-token field).
 */
export type DocsTemplateBuilder = (input: {
  jsonPath: string;
  pageTitle: string;
  branding: DocsBranding;
}) => string;

export interface MountDocsUiOptions {
  /** Path the docs UI is served from. Default: `/_docs`. */
  routePath?: string;
  /**
   * Page title shown in the header + browser tab. Defaults to
   * "LuckyStack — API docs". Pass an explicit string to brand for a consumer.
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
  /**
   * Optional branding inputs (logo, brand color, font). Applied by the
   * default template. Custom templates may ignore these.
   */
  branding?: DocsBranding;
  /**
   * Custom HTML template builder. When provided, the default `renderDocsHtml`
   * is bypassed entirely. Use for radically different layouts (sidebar,
   * tabs, dark mode, marketing-page-style). Receives a tested JSON path +
   * title + branding so your template doesn't need to know about
   * `getGeneratedApiDocsPath`.
   */
  template?: DocsTemplateBuilder;
  /**
   * Enable the inline "try-it-out" runner. When true, the default template
   * renders a request-input box + send button per endpoint that calls
   * `apiRequest` against the live server. Off by default because the
   * runner needs a logged-in session.
   */
  enableTryItOut?: boolean;
  /**
   * Optional per-request authorization hook. Called after the env/bind-address
   * gate passes. Return `true` to allow the request, `false` to serve 403.
   * Use to restrict docs access to authenticated or IP-allowlisted callers on
   * non-loopback deployments.
   */
  authorize?: (req: IncomingMessage) => boolean | Promise<boolean>;
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

    //? Fail-closed on production env OR any non-loopback bind address unless the
    //? consumer explicitly opts in. Staging/preview servers that bind to a public
    //? interface must set `enabledInProd` to avoid exposing the docs route.
    const isPublicBind = !isLoopbackIp(getBindAddress().ip);
    if ((process.env.NODE_ENV === 'production' || isPublicBind) && !options.enabledInProd) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Not Found');
      return true;
    }

    if (options.authorize) {
      const allowed = await options.authorize(req);
      if (!allowed) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Forbidden');
        return true;
      }
    }

    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Allow', 'GET');
      res.end('Method Not Allowed');
      return true;
    }

    if (pathOnly === jsonPath) {
      const docsPath = options.apiDocsPath ?? getGeneratedApiDocsPath();
      const [readError, content] = await tryCatch(() => fs.readFile(docsPath, 'utf8'));
      if (readError) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        //? Only expose the absolute filesystem path in non-production envs to
        //? avoid leaking internal directory structure to callers (DOCSUI-8).
        const isDev = process.env.NODE_ENV !== 'production';
        res.end(JSON.stringify({
          error: 'apiDocs.generated.json not found',
          ...(isDev ? { expectedAt: docsPath } : {}),
          hint: 'Run `npm run generateArtifacts` to generate it.',
        }));
      } else {
        //? Validate JSON before serving so a torn/corrupt artifact surfaces a
        //? meaningful 422 rather than a 200 with garbled payload that renders
        //? as "Could not load API docs" in the browser with no actionable hint
        //? (DD-DOCSUI-17). We parse but serve the original bytes — no
        //? round-trip serialization that could change whitespace or key order.
        try {
          JSON.parse(content ?? '');
        } catch {
          res.statusCode = 422;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({
            error: 'apiDocs.generated.json is not valid JSON (file may be torn/corrupted)',
            hint: 'Run `npm run generateArtifacts` to regenerate it.',
          }));
          return true;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(content);
      }
      return true;
    }

    //? Serve the HTML page itself. Title + branding + custom template
    //? layered: explicit `template` builder wins over the built-in renderer.
    //? Defaults render via `renderDocsHtml(jsonPath, title, { branding, enableTryItOut })`.
    const title = options.pageTitle ?? 'LuckyStack — API docs';
    const branding = options.branding ?? {};
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    const html = options.template
      ? options.template({ jsonPath, pageTitle: title, branding })
      : renderDocsHtml(jsonPath, title, {
          branding,
          enableTryItOut: options.enableTryItOut ?? false,
        });
    res.end(html);
    return true;
  };
};
