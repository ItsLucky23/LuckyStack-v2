# Theming the docs UI

> Dev-only. The default docs page is a single self-contained HTML document with inline CSS. Theming is intentionally minimal — three branding tokens for cosmetic tweaks, plus a full template-builder hook when you need a different layout.

This document covers:

- `DocsBranding` — the three branding tokens and how they map to CSS variables.
- The default palette + dark/light auto-switch.
- `DocsTemplateBuilder` — the escape hatch for full layout replacement.
- When to choose `branding` vs `template`.

For the renderer that consumes these tokens see `./html-generation.md`. For the route handler that wires them in see `./mounting.md`.

## `DocsBranding`

```ts
export interface DocsBranding {
  logoUrl?: string;
  brandColor?: string;
  fontFamily?: string;
}
```

All three keys are optional. Pass through `mountDocsUi({ branding: { ... } })` or directly to `renderDocsHtml(jsonPath, pageTitle, { branding })`.

| Token | Type | Default | Mapping |
| --- | --- | --- | --- |
| `logoUrl` | `string` | _(no logo)_ | Injected as `<img src="..." alt="logo" style="height:32px;width:auto;margin-right:12px;" />` in the brand row, to the left of the `<h1>`. The URL is HTML-escaped before injection. |
| `brandColor` | `string` (CSS color) | `#58a6ff` | Sets the CSS variable `--accent` and (because POST is the canonical authenticated verb in LuckyStack) also `--post`, the POST method pill color. |
| `fontFamily` | `string` (CSS font-family) | `system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` | Sets `--font-family`. Applied to `<body>` and inherited by inputs (the search bar uses `font-family: inherit`). |

The renderer applies these tokens in the inline `<style>` block at the top of the document. There is no runtime style swap; changing branding requires a fresh HTML response.

### Logo handling

- The renderer accepts PNG, SVG, and `data:` URLs equally.
- The string is escaped via the same `escapeHtml` helper used for `pageTitle` and `jsonPath`. Embedding hostile content in the `logoUrl` cannot break out of the `src` attribute.
- The img tag is fixed at `height: 32px; width: auto;`. If you need a different size, embed an SVG with a `viewBox` so it scales correctly, or use a `template` builder.
- When `logoUrl` is omitted, the brand row contains only the `<h1>`. There is no placeholder block.

### Brand color cascade

The branding color is wired into two CSS variables:

```
--accent: <brandColor>
--post:   <brandColor>     // (POST method pill)
```

All other method colors are fixed:

```
--get:    #3fb950    (green)
--put:    #d29922    (amber, with dark text)
--delete: #f85149    (red)
```

This intentional split keeps GET/PUT/DELETE recognizable across themes while letting the POST pill match the brand. If you need per-method theming, use a `template` builder.

### Font handling

`fontFamily` flows into `--font-family` and is consumed by `<body>` via `font-family: var(--font-family);`. The `<input type="search">` uses `font-family: inherit` so the search bar adopts the brand font. Code blocks (`pre`, `.endpoint`, `.try-it-out textarea`) use a fixed monospace stack (`ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace`) and are not affected by `fontFamily`.

Quoting and escaping: `fontFamily` is interpolated **as-is** into the CSS string. Provide a valid CSS font-family value, including quotes around multi-word family names when needed (e.g. `'Inter', system-ui, sans-serif`).

## Dark / light auto-switch

The page respects the OS preference via `prefers-color-scheme`. There is no in-page theme toggle.

Dark palette (default `:root` values):

```
--bg: #0e1116        --container: #161b22        --container-hover: #1c232b
--border: #2a313c    --title: #e6edf3            --common: #c9d1d9
--muted: #8b949e
```

Light palette (overridden inside `@media (prefers-color-scheme: light)`):

```
--bg: #ffffff        --container: #f6f8fa        --container-hover: #eaeef2
--border: #d0d7de    --title: #1f2328            --common: #1f2328
--muted: #59636e
```

Variables that are **not** overridden in the light block — `--accent`, `--font-family`, `--get`, `--post`, `--put`, `--delete` — are chosen to be legible against both surfaces. The PUT pill flips its text color to dark via `.method.PUT { color: #1f2328; }` to remain legible on amber.

## When to use `branding` vs `template`

Use `branding` (default template) when:

- You only need to swap the logo, the accent color, and/or the font.
- You're happy with the single-column endpoints-grouped-by-page layout.
- You want light/dark auto-switching for free.
- You don't need to change the inline runner, the filter UI, or the JSON-fetch flow.

Use `template: DocsTemplateBuilder` when:

- You need a different layout — sidebar navigation, tabs, a marketing-page wrapper, an embedded auth-token field, a two-pane editor/inspector view.
- You want a per-method palette beyond the POST = `brandColor` cascade.
- You need to integrate with a corporate design system (component library, web fonts loaded from a CDN, etc.).
- You want an in-page light/dark toggle independent of the OS preference.

## Example — corporate brand palette

```ts
import { mountDocsUi } from '@luckystack/docs-ui';

export const docsUiHandler = mountDocsUi({
  pageTitle: 'Acme — API docs',
  branding: {
    logoUrl: 'https://cdn.acme.example/logo.svg',
    brandColor: '#7c3aed',
    fontFamily: `'Inter', system-ui, -apple-system, sans-serif`,
  },
});
```

This renders the default layout with the Acme logo, purple accent (also applied to the POST pill), and Inter as the body font. GET/PUT/DELETE pills remain green/amber/red.

## Example — full template replacement

```ts
import { mountDocsUi, type DocsTemplateBuilder } from '@luckystack/docs-ui';

const sidebarTemplate: DocsTemplateBuilder = ({ jsonPath, pageTitle, branding }) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${pageTitle}</title>
  <link rel="stylesheet" href="https://cdn.example.com/corporate-tokens.css" />
</head>
<body>
  <aside class="sidebar">${branding.logoUrl ? `<img src="${branding.logoUrl}" />` : ''}</aside>
  <main id="content">Loading...</main>
  <script>
    fetch(${JSON.stringify(jsonPath)}, { credentials: 'include' })
      .then(r => r.json())
      .then(data => { /* render however you like */ });
  </script>
</body>
</html>`;

export const docsUiHandler = mountDocsUi({
  template: sidebarTemplate,
  branding: { logoUrl: 'https://cdn.example.com/logo.svg' },
});
```

Contract reminders for custom templates (see `./html-generation.md` for the full contract):

- Return a complete `<!DOCTYPE html>...</html>` document.
- HTML-escape any inputs that end up in markup — the builder receives raw strings.
- Fetch `jsonPath` yourself; the handler does not pre-fetch.
- You may receive a non-empty `branding` even when you don't use it — that's fine, ignore the fields you don't need.

## Limits

- No per-endpoint color override. The method pill colors are fixed CSS variables.
- No runtime theme switcher beyond OS preference in the default template. Implement one inside a custom template if needed.
- No web-font loading. The default template does not inject `<link rel="stylesheet">` tags — bring your own via a custom template.
- No localization. Strings like "Try it out (live request)", "No matches.", "Run `npm run generateArtifacts`" are hardcoded English. Replace via a custom template if you need translations.
- `brandColor` must be a valid single CSS color value (hex, named, `rgb()`, `hsl()`). Gradients are not supported.

## Related

- The renderer that consumes these tokens: `./html-generation.md`
- The mount handler that accepts them: `./mounting.md`
- The JSON fields the page renders: `./extension-fields.md`
- AI summary + function index: `../CLAUDE.md`
- Source: `../src/index.ts`, `../src/docsHtml.ts`
