# HTML generation

> Dev-only. The renderer produces a self-contained HTML document with inline CSS and inline JavaScript. There is no build step, no React, and no external runtime dependency — the page works in any modern browser as soon as it can fetch `apiDocs.generated.json`.

This document covers the rendering half of `@luckystack/docs-ui`:

- `renderDocsHtml(jsonPath, pageTitle, options?)` — the default HTML builder.
- `RenderDocsHtmlOptions` — the option shape.
- `DocsTemplateBuilder` — the hook for replacing the renderer entirely.
- The embedded client pipeline: fetch, group, render, filter, "try it out".

For the mount/route side see `./mounting.md`. For branding tokens see `./theming.md`. For the JSON fields read by the renderer see `./extension-fields.md`.

## Function signature

```ts
export const renderDocsHtml = (
  jsonPath: string,
  pageTitle: string,
  options?: RenderDocsHtmlOptions,
): string;

export interface RenderDocsHtmlOptions {
  branding?: {
    logoUrl?: string;
    brandColor?: string;
    fontFamily?: string;
  };
  enableTryItOut?: boolean;
}
```

Return value: a complete `<!DOCTYPE html>...</html>` document as a single UTF-8 string. The caller is responsible for setting the `Content-Type: text/html; charset=utf-8` header (the `mountDocsUi` handler already does this).

### Arguments

| Arg | Type | Required | Purpose |
| --- | --- | --- | --- |
| `jsonPath` | `string` | Yes | Path the embedded script fetches with `fetch(jsonPath, { credentials: 'include' })`. Typically the `${routePath}/api.json` sibling produced by `mountDocsUi`, but any URL that returns the expected JSON shape works. |
| `pageTitle` | `string` | Yes | Used for `<title>` and `<h1>`. Passed through `escapeHtml` before interpolation. |
| `options.branding` | `DocsBranding` | No | Logo, accent color, font family. See `./theming.md`. |
| `options.enableTryItOut` | `boolean` | No (default `false`) | When `true`, each endpoint detail panel gets a textarea + Send button that posts to the live server. |

## Document structure

The produced HTML is one document with three logical sections:

1. **`<head>`** — meta tags, `<title>`, and a single inline `<style>` block.
2. **`<body>`** — a `.layout` wrapper containing the brand row, the filter bar, a summary pill row, and an empty `<div id="content">` filled in by the script.
3. **Inline `<script>`** — defines render helpers, fetches the JSON, wires up the filter input, and (optionally) the "try it out" runner.

There is no external `<link>`, `<script src="...">`, or web-font import. The page renders correctly when opened with a local file URL too, provided the JSON endpoint is reachable.

### CSS variables in `:root`

```
--bg, --container, --container-hover, --border
--title, --common, --muted
--accent          (from branding.brandColor; default #58a6ff)
--font-family     (from branding.fontFamily; default system stack)
--get             (#3fb950)
--post            (= --accent)
--put             (#d29922)
--delete          (#f85149)
```

A `@media (prefers-color-scheme: light)` block redefines `--bg`, `--container`, `--container-hover`, `--border`, `--title`, `--common`, `--muted` to a light palette. The accent and method colors do not switch — they are chosen to be legible on both backgrounds.

### Layout selectors

| Selector | Purpose |
| --- | --- |
| `.layout` | Outer max-1200px container with vertical padding. |
| `.brand-row` | Holds the optional `<img>` logo and the `<h1>` page title. |
| `.summary` / `.summary-pill` | Top-of-page count pills ("`<visible>` of `<total>` endpoints", "`<pages>` pages"). |
| `.filter-bar input[type="search"]` | The single search input. Autofocus on load. |
| `.group` / `.group-header` | One block per `page` key in the JSON. |
| `.endpoint` / `.endpoint-summary` / `.endpoint-detail` | One row per endpoint. The detail panel is hidden until the row is clicked. |
| `.method.GET / .POST / .PUT / .DELETE` | Method pill, color-coded against the CSS variables above. |
| `.auth-tag` | Inline badges for each auth rule. |
| `.try-it-out` | Optional runner panel (only emitted when `enableTryItOut` is true). |

The styles are intentionally close to the framework's Tailwind tokens (background, container, muted, common) so the page looks at home in a LuckyStack project without configuration.

## Client-side rendering pipeline

The embedded `<script>` runs the following sequence after the HTML parses:

1. **`fetch(JSON_PATH, { credentials: 'include' })`** — pulls the JSON from `${routePath}/api.json` (or the explicit URL passed to `renderDocsHtml`). Credentials are included so a session cookie reaches the JSON endpoint when one is required.
2. On a successful response, the parsed payload is cached on `cachedData` and passed to `render(data, '')`.
3. On error (non-OK status or network failure) the page replaces `<div id="content">` with an inline error message — no console-only logging — so the user sees the failure without opening devtools.
4. The `<input type="search" id="filter">` registers an `input` listener that re-invokes `render(cachedData, filterValue)` on every keystroke. The fetch is not repeated.

### `render(data, filter)`

- Accepts either `{ apis: { ... } }` (current shape) or a bare `{ [page]: { ... } }` (legacy shape) — the renderer normalizes via `data && data.apis ? data.apis : data`.
- Iterates pages → names → versions, increments `total`, applies `passesFilter`, and accumulates HTML rows.
- Pages that have zero matching rows are omitted entirely (no empty `.group` boxes).
- Writes the `summary-pill` counts (`visible of total`, `pages count`) and the joined `.group` HTML into `<div id="content">`.
- After write, binds a `click` listener on every `.endpoint` to toggle the `.open` class and persist the state in `stateByKey` (keyed by `page + '/' + name + '@' + version`). The state is in-memory only; a hard reload resets all panels to closed.

### `renderEndpoint(page, name, version, meta)`

Each row pulls these fields from `meta`:

- `method` — uppercased and used as both the class and the label of the pill. Falls back to `POST` when undefined.
- `rateLimit` — `false` ⇒ "no rate limit"; `undefined` ⇒ "default rate"; number ⇒ "`<n>`/min".
- `auth` — passed to `renderAuth`. `auth.login` becomes `"login required"`. Each `auth.additional[]` entry contributes a `"<key>"` or `"<key>=<value>"` badge (value is `JSON.stringify`'d). Empty auth renders a `"public"` badge.
- `input`, `output` — already-stringified shapes from the type-map emitter. Rendered inside `<pre>` blocks. The fallbacks are `'{}'` and `'unknown'` respectively.
- `stream`, `owner`, `tags`, `deprecated` — optional extension fields, rendered conditionally. See `./extension-fields.md`.

The displayed endpoint path is `/api/<page>/<name>/<version>`; the path used by the runner is `<page>/<name>/<version>` posted to `/<route>?stream=false` (no leading `/api/`).

### `passesFilter(filter, page, name)`

Lowercase substring match against `page + '/' + name`. The version is not part of the haystack — filtering by version is intentional only via the page/route name.

### `escapeHtml` — two copies

The renderer ships two `escapeHtml` helpers that look identical and **must stay identical**:

1. The TypeScript helper at the bottom of `src/docsHtml.ts` is used to escape `pageTitle`, `jsonPath`, and `branding.logoUrl` before they are interpolated into the template literal at build time of the response.
2. The JS helper inside the inline `<script>` is used by the client to escape every value pulled from `apiDocs.generated.json` before it is injected into `innerHTML`.

Both map `&`, `<`, `>`, `"`, `'` to their HTML entity equivalents. The renderer never inserts unescaped user-supplied strings.

## "Try it out" runner

Enabled by `options.enableTryItOut === true`. When on:

- `ENABLE_TRY_IT_OUT` is `true` inside the inline script.
- `renderTryItOut(route, version)` appends a `<div class="try-it-out">` containing a `<textarea>` (default content `{}`), a `Send` button, and an empty `<pre class="result">`.
- The Send click invokes `runEndpoint(button, route, version, dataField)`.

`runEndpoint` performs:

```js
fetch('/' + route + '?stream=false', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify(parsed),
})
```

Behavior:

- `dataField.value.trim()` empty ⇒ posts `{}`. Otherwise the textarea value is parsed with `JSON.parse`. A parse error is shown in the result pane and no request is sent.
- The button is disabled during flight and re-enabled in `finally`.
- The response body is parsed as JSON when possible (pretty-printed via `JSON.stringify(..., null, 2)`) and otherwise displayed as raw text — this keeps non-JSON error pages readable.
- `?stream=false` instructs the HTTP API surface to return the full final payload instead of a streamed chunked response, which is what the textarea-and-pre UI is built for.
- Authentication is implicit via the browser session cookie (`credentials: 'include'`). The runner does not prompt for a token.

Disable the runner (`enableTryItOut: false`) when you ship to environments where developers don't have an authenticated session or you don't want side-effecting POSTs from the docs page.

## `DocsTemplateBuilder` — full replacement

When `mountDocsUi` is called with `template: DocsTemplateBuilder`, the default `renderDocsHtml` pipeline is bypassed entirely. The builder is invoked with:

```ts
type DocsTemplateBuilder = (input: {
  jsonPath: string;
  pageTitle: string;
  branding: DocsBranding;
}) => string;
```

Contract for custom builders:

- Must return a full HTML document. The `mountDocsUi` handler streams the string as-is into `res.end(...)` with `Content-Type: text/html; charset=utf-8`.
- Should `fetch(jsonPath)` itself (or use `<script>` to do so). The handler does not pre-fetch the JSON.
- Should HTML-escape any inputs that end up in markup. The builder receives them as raw strings — `mountDocsUi` does not pre-escape.
- May ignore `branding` if the layout has its own theming primitives.
- May call `renderDocsHtml` from inside the builder if you only want to wrap the default rendering with extra chrome — but in that case you can usually use `branding` instead.

Use a template builder for full layout replacements (sidebar navigation, tabs, marketing-page chrome, dark/light toggle beyond OS preference). Use `branding` for cosmetic tweaks. See `./theming.md` for the trade-off.

## Forward compatibility

- Unknown `meta` fields on endpoints are ignored by the renderer.
- The renderer never schema-validates the JSON; malformed input falls back to the empty state with a `Run npm run generateArtifacts` hint.
- The two-shape acceptance (`{ apis }` vs bare map) is intentional to preserve compatibility with older artifact generators.

## Related

- Mounting + route handler: `./mounting.md`
- Branding tokens + template trade-off: `./theming.md`
- Extension fields rendered by the default template: `./extension-fields.md`
- AI summary + function index: `../CLAUDE.md`
- Source: `../src/docsHtml.ts`
