# Extension fields on `apiDocs.generated.json`

> Dev-only. These fields are read by the renderer in `@luckystack/docs-ui` only — the framework runtime never inspects them. They are a docs-presentation concern, not a routing concern.

`apiDocs.generated.json` is produced by `@luckystack/devkit`'s type-map emitter. The default template in `@luckystack/docs-ui` consumes a small, stable set of core fields and a handful of optional extension fields. Unknown fields pass through cleanly — the renderer ignores anything it doesn't recognize, so adding new metadata is forward-compatible.

This document covers:

- The top-level JSON shape (including the legacy fallback).
- Core fields the renderer reads from each endpoint's `meta` object.
- Optional extension fields rendered when present (`stream`, `owner`, `tags`, `deprecated`).
- How to add your own metadata via the devkit emitter hooks.

For the rendering pipeline that consumes these fields see `./html-generation.md`. For the route that serves the JSON see `./mounting.md`.

## Top-level JSON shape

The current artifact is:

```jsonc
{
  "apis": {
    "<page>": {
      "<name>": {
        "<version>": {
          "method": "POST",
          "auth": { "login": true, "additional": [] },
          "rateLimit": 60,
          "input": "{ userId: string }",
          "output": "{ status: 'success', result: { ... } }",
          // ...optional extension fields...
        }
      }
    }
  }
}
```

Legacy/forward fallback: if the root object is the apis map itself (no `apis` wrapper), the renderer normalizes via `data && data.apis ? data.apis : data`. Both shapes are accepted; new code should always emit the wrapped form.

The grouping levels — `page` → `name` → `version` — match the file-based routing convention (`src/<page>/_api/<name>_v<version>.ts`). The renderer iterates these in object-iteration order; the emitter is responsible for any sorting.

## Core fields (always read by the renderer)

These are the fields used to build the always-visible row + the default expanded panel:

| Field | Type | Default in renderer | Purpose |
| --- | --- | --- | --- |
| `meta.method` | `'GET' \| 'POST' \| 'PUT' \| 'DELETE'` (any string, uppercased) | `'POST'` | Method pill text + CSS class on `.method`. |
| `meta.rateLimit` | `number \| false \| undefined` | `'default rate'` label | Numeric ⇒ `"<n>/min"`. `false` ⇒ `"no rate limit"`. `undefined` ⇒ `"default rate"`. |
| `meta.auth` | `{ login?: boolean; additional?: Array<{ key: string; value?: unknown }> }` | `'public'` badge | `auth.login` becomes a `"login required"` badge. Each `additional[]` entry becomes a `"<key>"` or `"<key>=<JSON-stringified value>"` badge. Empty / missing ⇒ single `"public"` badge. |
| `meta.input` | `string` (already-stringified TS shape) | `'{}'` | Rendered inside `<pre>` in the expanded panel. |
| `meta.output` | `string` (already-stringified TS shape) | `'unknown'` | Rendered inside `<pre>` in the expanded panel. |

The renderer does not try to JSON-parse `input` / `output`. They are emitted as pre-formatted strings by the devkit emitter so the docs page can display the original TypeScript shape verbatim — including unions, mapped types, and template-literal types — without re-stringifying.

Unknown core fields fall through to their defaults silently; emit a missing `method`, for example, and the row shows `POST`.

## Optional extension fields

The default template renders these only when present. They are additive: omit any of them and the corresponding section is left out of the expanded panel.

### `meta.stream`

- Type: `string` (already-stringified TS shape, same convention as `input` / `output`).
- Renders as: a `stream` detail section with the value inside a `<pre>` block.
- Use for endpoints that stream chunks back to the client (e.g. SSE or chunked-transfer responses). The string typically describes the shape of a single chunk.
- Example payload field:

```jsonc
{
  "stream": "{ delta: string } | { done: true }"
}
```

### `meta.owner`

- Type: `string`.
- Renders as: an `owner` detail section with the raw string.
- Use for triage-friendly attribution — team name, Slack channel, GitHub handle, on-call rotation, etc. The value is escaped before injection so it is safe to include arbitrary text.
- Example:

```jsonc
{ "owner": "@platform-team (#help-platform)" }
```

### `meta.tags`

- Type: `string[]` (or array of values coerced via `String(...)`).
- Renders as: inline badges in a `tags` detail section, space-separated.
- Use for cross-cutting categorization the page/name hierarchy can't express — `"v2-migration"`, `"internal"`, `"experimental"`, etc.
- Example:

```jsonc
{ "tags": ["experimental", "internal"] }
```

Note: the renderer treats `tags` as an `Array.isArray(value)` check; arbitrary iterables are not supported. Emit a plain array.

### `meta.deprecated`

- Type: `string | true` (anything truthy; `String(value)` is used for display).
- Renders as: a `deprecated` detail section with red text (`color: var(--delete)`).
- Use for a removal notice or migration pointer. The truthiness check means `"true"`, `"yes"`, `"removing v2026.05"`, etc. all render — but the renderer always shows the string value, so prefer a human-readable migration note over a bare boolean.
- Example:

```jsonc
{
  "deprecated": "Removed in v2026.05 — use users/getProfile/v2 instead."
}
```

## Forward compatibility

- Adding a new field to a `meta` object is non-breaking. The renderer ignores it.
- Removing one of the four extension fields above does **not** break the renderer either — each is conditional on truthiness or array length.
- The renderer does no schema validation. Malformed top-level JSON (e.g. wrong types at the page/name/version levels) shows the page's empty state with a hint to regenerate.

If you need extra fields on the page, you have two options:

1. Extend the devkit emitter to include the field, then customize the rendering side via a `DocsTemplateBuilder` (see `./theming.md`) or, for trivial additions, contribute the field to this package.
2. Keep your metadata out-of-band (a sibling JSON file) and consume it from a custom template. The default renderer will not surface it, but a `DocsTemplateBuilder` can fetch both files.

## Producer contract — how fields are populated

`apiDocs.generated.json` is written by `@luckystack/devkit`'s type-map emitter on each dev-server reload and on every `npm run generateArtifacts`. Path resolution goes through `ProjectConfig.paths.generatedApiDocs` (consumed by `getGeneratedApiDocsPath()` in `@luckystack/core`).

Emission steps the devkit performs per endpoint:

1. Read the route file (`src/<page>/_api/<name>_v<version>.ts`) and extract exports: `method`, `rateLimit`, `auth`, the `ApiParams.data` interface (rendered into `input`), and the `main` return type (rendered into `output`).
2. Stringify the types into source-faithful strings — no re-stringification, no JSON.stringify of types.
3. Run the emitter's `emitterArtifacts` extension hooks (`packages/devkit/src/typeMap/emitterArtifacts.ts`). Hooks can attach `stream`, `owner`, `tags`, `deprecated`, or any new field.
4. Group by `page` → `name` → `version` and write the JSON.

Consumer-side extension (e.g. reading a `@deprecated` JSDoc tag and mapping it to `meta.deprecated`) belongs in an emitter artifact hook, not in `@luckystack/docs-ui`. The docs-ui package only renders what the emitter writes.

## Validation behavior

- No schema validation. The renderer trusts the JSON shape.
- A missing artifact (`apiDocs.generated.json` not on disk) yields a `404 JSON` response from the `mountDocsUi` handler with `expectedAt` + `hint` — surfaced as an inline error message in the page.
- An empty / invalid `apis` map yields the page's empty state: `"No API docs available. Run npm run generateArtifacts to generate them."`.
- Per-endpoint malformations (e.g. `auth` is a string instead of an object) fall back to defaults silently. Bad data does not crash the page; it just shows degraded content.

## Related

- Rendering pipeline that consumes these fields: `./html-generation.md`
- Mount + route: `./mounting.md`
- Branding / custom templates: `./theming.md`
- AI summary + function index: `../CLAUDE.md`
- Producer: `packages/devkit/src/typeMap/emitter.ts` and `packages/devkit/src/typeMap/emitterArtifacts.ts`
