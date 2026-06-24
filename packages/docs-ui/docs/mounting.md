# Mounting the docs UI

> Dev-only. The default route returns `404` in production unless `enabledInProd: true` is explicitly set. Never mount this on a public surface where API discoverability is sensitive.

`@luckystack/docs-ui` exposes a single mount function that builds a `customRoutes` handler. The handler is composable with `createLuckyStackServer` / `bootstrapLuckyStack` and does not take ownership of the request pipeline — it claims the configured docs route and falls through for everything else.

This document is the deep reference for:

- `mountDocsUi(options?)` — the factory that builds the handler.
- `DocsRouteHandler` — the handler contract.
- `MountDocsUiOptions` — the full option surface.

For the HTML rendering side of the pipeline see `./html-generation.md`. For optional branding/template overrides see `./theming.md`. For the JSON fields the renderer consumes see `./extension-fields.md`.

## Function signatures

```ts
export const mountDocsUi = (options?: MountDocsUiOptions): DocsRouteHandler;

export type DocsRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<boolean>;

export interface MountDocsUiOptions {
  routePath?: string;
  pageTitle?: string;
  enabledInProd?: boolean;
  apiDocsPath?: string;
  branding?: DocsBranding;
  template?: DocsTemplateBuilder;
  enableTryItOut?: boolean;
  authorize?: (req: IncomingMessage) => boolean | Promise<boolean>;
}
```

## `MountDocsUiOptions` argument breakdown

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `routePath` | `string` | `/_docs` | URL path the HTML page is served from. The JSON sibling is automatically derived as `${routePath}/api.json`. Both paths are claimed by the handler. |
| `pageTitle` | `string` | `LuckyStack — API docs` | Used for the `<title>` element and the `<h1>` in the header. Pass your project name explicitly — there is no implicit lookup from `ProjectConfig` because consumer config shapes vary too widely to introspect. |
| `enabledInProd` | `boolean` | `false` | Set to `true` to render the docs in production (`NODE_ENV === 'production'`). Use only for an internal developer-portal deployment with its own auth layer in front. |
| `apiDocsPath` | `string` | `getGeneratedApiDocsPath()` | Absolute filesystem path to `apiDocs.generated.json`. Default reads from `ProjectConfig.paths.generatedApiDocs` via `@luckystack/core`. Override only when running a non-standard artifact layout. |
| `branding` | `DocsBranding` | `{}` | Optional logo / accent color / font family. Applied by the default template only. See `./theming.md`. |
| `template` | `DocsTemplateBuilder` | `undefined` | Custom HTML builder. When provided, the default `renderDocsHtml` is bypassed entirely. See `./html-generation.md` and `./theming.md`. |
| `enableTryItOut` | `boolean` | `false` | Renders an inline request runner under each endpoint. Off by default — the runner needs a logged-in browser session because it hits the live server with `credentials: 'include'`. |
| `authorize` | `(req: IncomingMessage) => boolean \| Promise<boolean>` | `undefined` | Optional per-request authorization hook. Called after the env/bind-address gate passes (so it only runs when the route is being served). Return `true` to allow the request, `false` to serve `403 Forbidden`. Use to restrict docs access to authenticated or IP-allowlisted callers on non-loopback deployments (e.g. an internal developer-portal opened with `enabledInProd: true`). |

All options are individually optional; calling `mountDocsUi()` with no arguments is valid and produces the default behavior.

## `DocsRouteHandler` contract

The factory returns an async function with this exact shape:

```ts
type DocsRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<boolean>;
```

Return-value contract:

- `true` — the handler has fully processed the request and called `res.end(...)`. The caller (typically `@luckystack/server`'s `customRoutes` orchestration) must not invoke any further handler for this request.
- `false` — the handler did not match the URL. The request body is untouched and the response is unwritten. The caller is free to delegate to the next handler or fall through to the framework's default routing.

The handler is safe to compose: it inspects only `req.url` and `req.method` and never reads the body. It is always async because reading `apiDocs.generated.json` from disk happens via `fs.promises.readFile` wrapped in `tryCatch`.

## Compositing with `createLuckyStackServer`

Minimum integration — pass the handler as `customRoutes`:

```ts
// luckystack/docs-ui/index.ts (overlay file)
import { mountDocsUi } from '@luckystack/docs-ui';

export const docsUiHandler = mountDocsUi({
  pageTitle: 'My App — API docs',
});
```

```ts
// server/server.ts
import { bootstrapLuckyStack } from '@luckystack/server';
import { docsUiHandler } from '../luckystack/docs-ui';
import { serveFile, serveFavicon } from './prod/serveFile';

await (await bootstrapLuckyStack({
  serveFile,
  serveFavicon,
  customRoutes: docsUiHandler,
})).listen();
```

Composing with another custom handler — chain by `await`-ing the docs handler first and only continuing when it returns `false`:

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mountDocsUi } from '@luckystack/docs-ui';
import { metricsHandler } from './metrics';

const docsHandler = mountDocsUi();

export const customRoutes = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> => {
  if (await docsHandler(req, res)) return true;
  if (await metricsHandler(req, res)) return true;
  return false;
};
```

The order matters only when two handlers would claim the same path; `mountDocsUi` only ever claims `routePath` + `${routePath}/api.json`, so collisions are easy to avoid by picking a unique `routePath`.

## Behavior matrix

The handler's branches map directly to the request shape. The order is exactly as evaluated in `src/index.ts`:

| Step | Condition | Result |
| --- | --- | --- |
| 1 | `pathOnly !== routePath && pathOnly !== ${routePath}/api.json` | Returns `false` (pass-through). No response written. |
| 2 | (`NODE_ENV === 'production'` **or** `!isLoopbackIp(getBindAddress().ip)`) and `!options.enabledInProd` | `404 Not Found` (`text/plain`). Returns `true`. The non-loopback bind-address check means a server bound to a public interface is gated even outside `NODE_ENV=production`. |
| 3 | `options.authorize` is set and returns/resolves `false` | `403 Forbidden` (`text/plain`). Returns `true`. Runs only after the env/bind gate (step 2) passes. |
| 4 | `req.method !== 'GET'` | `405 Method Not Allowed` (`text/plain`). Returns `true`. |
| 5 | `pathOnly === ${routePath}/api.json` and the file is readable | `200 OK` (`application/json`, `Cache-Control: no-store`) with the raw file contents. Returns `true`. |
| 6 | `pathOnly === ${routePath}/api.json` and the file is missing/unreadable | `404 Not Found` (`application/json`) with `{ error, expectedAt, hint }`. Returns `true`. |
| 7 | `pathOnly === routePath` and `options.template` is set | `200 OK` (`text/html; charset=utf-8`) with the template builder's output. Returns `true`. |
| 8 | `pathOnly === routePath` and no template | `200 OK` (`text/html; charset=utf-8`) with `renderDocsHtml(...)`. Returns `true`. |

The order is critical: the env/bind gate runs before the `authorize` hook and before method-checking, so a `POST /_docs` in production (or on a public-bind server) still returns `404` — it's gated first — not `405`, and `authorize` is never consulted on a gated request. The gate fires on `NODE_ENV === 'production'` **or** a non-loopback bind address (`!isLoopbackIp(getBindAddress().ip)`), so a staging/preview server bound to a public interface is locked down even when `NODE_ENV` is not `production`; set `enabledInProd: true` to serve the route there. The match itself ignores query strings (the path is split on `?` before comparing) and is strict on trailing slashes — `/_docs/` does NOT match the default route.

## Response shapes

### HTML page (`GET ${routePath}`)

```
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Cache-Control: no-store

<!DOCTYPE html>
<html lang="en">
...self-contained docs page (see ./html-generation.md)...
```

### JSON endpoint, success (`GET ${routePath}/api.json`)

```
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{ "apis": { "<page>": { "<name>": { "<version>": { ... } } } } }
```

The file is streamed as-is from disk; the handler does not parse, validate, or transform it. Forward-compatible extension fields (see `./extension-fields.md`) pass through unchanged.

### JSON endpoint, missing file

```
HTTP/1.1 404 Not Found
Content-Type: application/json

{
  "error": "apiDocs.generated.json not found",
  "expectedAt": "<resolved apiDocsPath>",
  "hint": "Run `npm run generateArtifacts` to generate it."
}
```

This is intentionally a structured payload so the client-side renderer can surface a helpful empty state. `Cache-Control` is omitted on the error path — the request should be retried after running the artifact generator.

`expectedAt` is **dev-only**: it exposes the absolute filesystem path and is omitted when `NODE_ENV === 'production'` to avoid leaking internal directory structure (DOCSUI-8). In production the payload contains only `error` and `hint`.

### Production lockdown (`enabledInProd: false`)

```
HTTP/1.1 404 Not Found
Content-Type: text/plain

Not Found
```

The same plain `Not Found` is returned for both the HTML and the JSON sub-route, so probing tools cannot infer which routes the handler owns.

### Wrong method

```
HTTP/1.1 405 Method Not Allowed
Content-Type: text/plain

Method Not Allowed
```

`POST`, `PUT`, `DELETE`, and other verbs all map to `405`. The `enableTryItOut` runner posts to `/api/<page>/<name>/<version>?stream=false` (the framework's HTTP API surface), not to the docs route — so `GET`-only is sufficient.

## `apiDocsPath` resolution

The default `apiDocsPath` is resolved lazily on every request via `getGeneratedApiDocsPath()` from `@luckystack/core`. That helper reads `ProjectConfig.paths.generatedApiDocs`, which is populated either via the framework defaults or via an overlay's `registerProjectConfig` call.

When you pass `apiDocsPath` explicitly:

- The value must be an absolute path. The handler does no resolution relative to `process.cwd()`.
- The file is read with `fs.promises.readFile(path, 'utf8')` on every request — there is no in-memory cache. The doc-set is dev-only and the artifact regenerates often; caching is intentionally avoided.
- Read errors are caught via `tryCatch`. The response is a structured `404` with `expectedAt` pointing at the resolved path so you can diff it against your actual layout.

## Edge cases

- **Missing `apiDocs.generated.json`** — Returns the structured `404` JSON payload above. Run `npm run generateArtifacts` to produce it.
- **Trailing slashes** — The handler does strict string equality on the resolved path. `/_docs/` is treated as a different route from `/_docs`. Configure `routePath` to include or omit the trailing slash consistently with the rest of your router.
- **Query strings** — The path is split on `?` before comparison, so `/_docs?theme=dark` matches. Query parameters are otherwise ignored by the handler.
- **Custom `routePath`** — Any string is accepted; the `${routePath}/api.json` sibling is derived by simple concatenation. Avoid trailing slashes in `routePath` (`/_docs/` would yield `/_docs//api.json`).
- **`HEAD` requests** — Not special-cased. They fall into the `405` branch. If you need `HEAD` support, wrap the handler.
- **Concurrent requests** — Each request reads the JSON file independently. There is no shared mutable state inside the handler.
- **`req.url` missing** — The handler treats an undefined `url` as an empty string, which never matches `routePath`. It returns `false` (pass-through) cleanly.

## Related

- HTML rendering pipeline: `./html-generation.md`
- Branding and full template replacement: `./theming.md`
- Extension fields rendered from `apiDocs.generated.json`: `./extension-fields.md`
- AI summary + function index: `../CLAUDE.md`
- Consumer quickstart: `../README.md`
- Source: `../src/index.ts`
