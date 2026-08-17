# Framework Docs Copy

How create-app supplies LuckyStack's repository-level AI context to a new consumer. Source: `copyAiDocs` in `src/index.ts` and `scripts/bundleFrameworkDocs.mjs`.

## Why this exists

Per-package `CLAUDE.md` and `docs/` files already ship in each package tarball and land under `node_modules/@luckystack/<package>/`. Cross-package architecture, workflow rules, skills, commands, and branch-log conventions do not belong to one runtime package, so create-app bundles and copies them explicitly.

This step runs only when `aiInstructions=true` (default; disable with `--no-ai-docs`). It runs after template/feature rendering and before the scaffold manifest and dependency install.

## Build-time bundle

`npm run build` for create-app first runs:

```bash
node scripts/bundleFrameworkDocs.mjs
```

The script rebuilds `framework-docs/` from five repository sources and prepares npm-safe names for nested/dot paths. A published package therefore never depends on access to the monorepo root.

At runtime:

1. prefer the packaged `framework-docs/` directory;
2. fall back to repository-root sources for local monorepo scaffold tests;
3. skip an individually missing optional source while reporting the number copied.

The package build should report all `5/5` sources.

## Copied surfaces

| Bundled source | Consumer destination | Purpose |
| --- | --- | --- |
| `CLAUDE.md` | `CLAUDE.md` | Consumer AI contract and project-rule extension point |
| `docs/` | `docs/luckystack/` | Cross-package architecture, protocols, indexes, and runbooks |
| `skills/` | `skills/` | Framework/custom agent skills |
| `claude-commands/` | `.claude/commands/` | Slash-command definitions |
| `branch-logs-README.md` | `branch-logs/README.md` | Branch-log convention without framework branch history |

Framework docs are namespaced under `docs/luckystack/` so the consumer's own product/architecture docs can use `docs/` without collisions. Skills and commands keep their discovery paths.

## Consumer-specific cleanup and wiring

After copying:

- dated framework findings directories are removed; the consumer keeps `FINDINGS_PROTOCOL.md` and the findings index/convention but not LuckyStack's audit history;
- no framework branch-log entries are copied;
- the AI-index pre-commit hook is installed;
- `.mcp.json` receives a separate `luckystack` stdio server entry pinned to the create-app minor range;
- selected browser MCP entries are added later by `wireAiBrowserTooling` and coexist with the graph server.

## Placeholder policy

The framework `docs/` tree is copied with an empty variable map. This deliberately preserves `{{...}}` snippets used as documentation examples. Other copied text files use normal text rendering if they adopt project variables in the future. Binaries remain byte-exact.

## Scaffold manifest and updates

Copied AI files are included in `.luckystack/scaffold.json` hashes. For an existing consumer:

```bash
# after upgrading @luckystack/* packages
npx luckystack update
```

The CLI re-renders the framework-owned surface from the recorded scaffold choices. Pristine files are updated; user-modified files are preserved and receive `.new` sidecars. Use `npx luckystack update --app` only when also adopting framework-authored app assets.

Package-local docs update through their normal package upgrades and are never copied into consumer-owned source folders.

## Verification

For a create-app release:

1. run the bundle script and require `5/5`;
2. build/pack create-app and verify `framework-docs/` is present in the tarball;
3. run `npm run scaffold:test`;
4. confirm AI-on includes all five surfaces plus hook/MCP config;
5. confirm AI-off omits them and forces browser tooling to `none`;
6. confirm no dated framework findings were copied.

## Related

- [`scaffold-flow.md`](./scaffold-flow.md)
- [`template-variables.md`](./template-variables.md)
- [`post-scaffold-suggestions.md`](./post-scaffold-suggestions.md)
- Repository [`docs/UPGRADING.md`](../../../docs/UPGRADING.md)
