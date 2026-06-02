# Template customization

`@luckystack/devkit` injects starter content into newly-created **empty** files
under `src/` (a new `_api/*.ts`, `_sync/*.ts`, or `page.tsx`). Two things are
customizable, both from the consumer's `.luckystack/templates/` folder:

1. **Which** template a file gets — the *selection rules*.
2. **What** that template contains — the *content*.

Everything here is **dev-only**: devkit reads it from the hot-reload path during
`npm run server`. Nothing ships to end users.

---

## How a file gets a template

`injectTemplate(filePath)` (called by the file watcher on empty-file creation):

1. **Classify** the file structurally into a `fileKind`:
   `'api' | 'sync_server' | 'sync_client' | 'page'` (derived from the route
   conventions — override the markers via `registerRoutingRules`). For pages,
   placement is validated first; an un-routable placement gets a commented
   diagnostic instead of a real template.
2. **Select a kind** via `resolveTemplateKind(ctx)` — the registered rules are
   evaluated by descending `priority` (ties: newest registration first), and the
   first matching rule's `kind` wins.
3. **Resolve content** for that kind, first hit wins:
   - `.luckystack/templates/<kind>.template.ts(x)` — consumer file
   - a `registerTemplate('<kind>', '...')` string override
   - the bundled default shipped inside devkit (`dist/templates/`)
4. **Substitute placeholders** (`{{REL_PATH}}`, `{{PAGE_PATH}}`, `{{SYNC_NAME}}`)
   and write the file.

The match context is:

```ts
interface TemplateMatchContext {
  filePath: string;                                    // absolute path of the new file
  fileKind: 'api' | 'sync_server' | 'sync_client' | 'page';
  hasPairedServer: boolean;                            // sync_client: does *_server_v<N>.ts exist?
  srcRelativePath: string | null;                      // path relative to src/, or null
}
```

---

## The consumer overlay: `.luckystack/templates/`

`create-luckystack-app` scaffolds this folder. devkit auto-loads
`.luckystack/templates/templateRules.ts` **once, in dev, before the first
injection** (a plain dynamic import — no wiring needed). Absent file ⇒ devkit's
built-in defaults apply.

```
.luckystack/templates/
  templateRules.ts                 # the selection logic — edit/remove/add rules
  api.template.ts                  # editable copies of the built-in template bodies
  sync_server.template.ts
  sync_client_paired.template.ts
  sync_client_standalone.template.ts
  page_plain.template.tsx
  page_dashboard.template.tsx
  README.md
```

A `*.template.*` file in this folder overrides that kind's content. **Delete** a
file to fall back to devkit's (upgradeable) bundled default. The shipped copies
are a snapshot of the defaults at scaffold time — to refresh, copy from
`node_modules/@luckystack/devkit/dist/templates/`.

---

## API

| Export | Purpose |
|---|---|
| `registerTemplateRule({ kind, match, priority? })` | Add a selection rule. `priority` default for direct calls is the caller's; defaults use 10 (specific) / 0 (page catch-all). |
| `registerTemplateKind(kind, { match, content?, priority? })` | Register a brand-new kind (rule + optional inline content) in one call. Default priority 100 so custom kinds beat the built-ins. |
| `registerTemplate(kind, content)` | Override just the content body of a kind (string). |
| `resolveTemplateKind(ctx)` | Evaluate the active rules → the chosen kind (or null). |
| `getTemplateRules()` | The active rules in evaluation order. |
| `clearTemplateRules()` | Drop ALL rules — including the built-in defaults. The scaffolded `templateRules.ts` calls this first so it is the single source of truth. |
| `registerDefaultTemplateRules()` | (Re)arm the framework defaults. Armed automatically on module load; idempotent. |
| `BUILT_IN_TEMPLATE_KINDS` / `BUILT_IN_TEMPLATE_FILENAMES` / `DEFAULT_DASHBOARD_PATH_PATTERN` | The 6 kinds, their bundled filenames, and the page-dashboard heuristic regex. |

Built-in kinds: `api`, `sync_server`, `sync_client_paired`,
`sync_client_standalone`, `page_plain`, `page_dashboard`.

---

## Recipes

### Change when a page gets the dashboard layout

Edit the `page_dashboard` rule in `.luckystack/templates/templateRules.ts`:

```ts
registerTemplateRule({
  kind: 'page_dashboard',
  priority: 10,
  match: (ctx) => ctx.fileKind === 'page' && ctx.filePath.replaceAll('\\', '/').includes('/app/'),
});
```

### Remove a rule entirely

The scaffolded `templateRules.ts` starts with `clearTemplateRules()` and then
re-declares each default. Delete the rule you don't want — that mapping no
longer applies (a page with no matching rule simply isn't injected).

### Add a brand-new template kind

```ts
// .luckystack/templates/templateRules.ts
import { registerTemplateKind } from '@luckystack/devkit';

registerTemplateKind('page_marketing', {
  priority: 20, // beats page_dashboard / page_plain
  match: (ctx) => ctx.fileKind === 'page' && ctx.filePath.replaceAll('\\', '/').includes('/marketing/'),
});
```

Then create `.luckystack/templates/page_marketing.template.tsx` with the body.
Custom kinds resolve content from `<kind>.template.tsx` then `<kind>.template.ts`
in the overlay folder (or a `registerTemplate('page_marketing', '...')` string).

---

## Packaging note (framework maintainers)

The bundled templates live at `packages/devkit/src/templates/`. They are read at
runtime via `fs.readFileSync(dist/templates/...)`, so `tsup.config.ts` copies
`src/templates → dist/templates` in its `onSuccess` hook and `files: ["dist"]`
ships them in the tarball. The scaffolded consumer copies live separately under
`create-luckystack-app/template/_dot_luckystack/templates/` (the `_dot_` prefix
is rewritten to `.` by the scaffold so npm doesn't drop the dot-folder).
