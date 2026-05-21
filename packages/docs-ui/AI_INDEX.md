# @luckystack/docs-ui

> AI summary + function INDEX (referenced from root /CLAUDE.md as AI_INDEX.md). For deep specs see `docs/` next to this file.

## What this package does

Dev-only API docs browser for LuckyStack. Mounts a single page (default `/_docs`) that fetches the framework's generated `apiDocs.generated.json` and renders every API endpoint grouped by page, with HTTP method, auth, rate limit, input shape, and output shape. Sync events appear alongside APIs when the type-map emitter has produced metadata for them. Ships a `customRoutes` handler — composable with `createLuckyStackServer`'s `customRoutes` option without taking ownership of the request pipeline.

## When to USE this package

- Local development: developer wants a Swagger-style overview of every route in the project without leaving the browser.
- Internal developer-portal: opt-in production rendering via `enabledInProd: true` for an authenticated team-only deploy.
- Custom branded API docs: replace the default template via the `template: DocsTemplateBuilder` option to render in a sidebar/tabs/marketing layout while reusing the JSON endpoint.
- Inline request runner: enable `enableTryItOut` so each endpoint gets a textarea + Send button that posts against the live server using the browser session cookie.

## When to NOT suggest this (yet)

- Public production surface where API discoverability is sensitive — keep the default `enabledInProd: false` and don't mount in prod.
- Replacement for `apiDocs.generated.json` itself — this package only reads/renders that file; regenerate via `@luckystack/devkit`'s type-map emitter (`npm run generateArtifacts`).
- A non-HTTP transport — the handler is bound to `IncomingMessage` / `ServerResponse`; do not wire it directly into Socket.io handlers.
- React-tree integration — the docs UI is a single self-contained HTML document with no React/Tailwind dependency on the client; do not import `renderDocsHtml` into the app bundle.

## Function Index

| Function / Export | 1-regel | Deep doc |
|---|---|---|
| `mountDocsUi(options?)` | Returns a `DocsRouteHandler` for `customRoutes`; serves HTML + JSON | → docs/mounting.md |
| `renderDocsHtml(jsonPath, pageTitle, options?)` | Builds the self-contained docs HTML document | → docs/html-generation.md |
| Type: `DocsRouteHandler` | `(req, res) => Promise<boolean>`; returns `true` when route handled | → docs/mounting.md |
| Type: `DocsTemplateBuilder` | Custom HTML builder hook: `({ jsonPath, pageTitle, branding }) => string` | → docs/html-generation.md |
| Type: `MountDocsUiOptions` | All mount inputs (routePath, enabledInProd, branding, template, enableTryItOut, ...) | → docs/mounting.md |
| Type: `DocsBranding` | `{ logoUrl?, brandColor?, fontFamily? }` applied by default template | → docs/theming.md |
| Type: `RenderDocsHtmlOptions` | `{ branding?, enableTryItOut? }` passed to `renderDocsHtml` | → docs/html-generation.md |
| Extension field: `meta.stream` | Per-endpoint stream shape rendered in expanded detail panel | → docs/extension-fields.md |
| Extension field: `meta.owner` | Owner string rendered in expanded detail panel | → docs/extension-fields.md |
| Extension field: `meta.tags` | Tag badges rendered in expanded detail panel | → docs/extension-fields.md |
| Extension field: `meta.deprecated` | Deprecation note (red) rendered in expanded detail panel | → docs/extension-fields.md |

## Config keys (env vars + registerProjectConfig slots)

- `NODE_ENV` (env) — when `'production'`, the route returns `404` unless `enabledInProd: true` is set.
- `ProjectConfig.paths.generatedApiDocs` (config, resolved via `getGeneratedApiDocsPath()` from `@luckystack/core`) — default JSON file path; override per-mount via `options.apiDocsPath`.
- No package-private env vars. All behavior is controlled via `MountDocsUiOptions`.

## Peer dependencies

- **Required**: `@luckystack/core` (provides `getGeneratedApiDocsPath` + `tryCatch`).
- **Required (runtime composition)**: `@luckystack/server` — the handler is intended to be passed to `createLuckyStackServer({ customRoutes })` / `bootstrapLuckyStack({ customRoutes })`. The package itself does not import `@luckystack/server`; the dependency is on the consumer side.
- **Required (data source)**: `@luckystack/devkit` (build-time) — emits `apiDocs.generated.json`. Without it the JSON endpoint returns a 404 with a hint to run `npm run generateArtifacts`.

## Related

- Architecture deep-dives: `/docs/ARCHITECTURE_API.md` (lifecycle of documented endpoints), `/docs/ARCHITECTURE_PACKAGING.md` (how the JSON artifact is produced).
- README (consumer quickstart): `./README.md`.
- Source: `./src/index.ts` (mount + route handling), `./src/docsHtml.ts` (embedded HTML renderer).
