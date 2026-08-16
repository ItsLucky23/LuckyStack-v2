# Framework Docs Copy (Fase E.2)

Documents the inline copy block in `main()` that ships the LuckyStack repo's AI-facing documentation into each new scaffold so the consumer's AI agents inherit the same context the framework repo provides to its own.

## Motivation

Per-package `CLAUDE.md` + `docs/` are bundled in each `@luckystack/*` npm tarball. When the scaffold runs `npm install`, those files end up under `node_modules/@luckystack/<pkg>/CLAUDE.md` automatically — no copy step needed.

The repo's ROOT-level documentation is different. It is not part of any npm package, but it contains the most important context for an AI agent working in a LuckyStack project:

- The root `CLAUDE.md` — project-wide AI rules (styling, error handling, SOLID, JSX conventions, etc.).
- The cross-cutting architecture docs under `docs/` (routing, API, auth, session, packaging, hosting).
- Claude Code conventions: `skills/`, `.claude/commands/`.
- The branch-logs convention: a `branch-logs/README.md` explaining how per-branch sessions are tracked.

Without an explicit copy step, a freshly-scaffolded consumer would only get the per-package docs from `node_modules/`, not the framework-level rules. The Fase E.2 block fills that gap.

## Position in the flow

The copy block runs in `main()` **after** `copyTree(TEMPLATE_DIR, targetDir, vars)` and **before** `runNpmInstall(targetDir)`. Running it before `npm install` is intentional — if `npm install` fails the consumer still has the framework docs available to debug from.

## Exact code

From `src/index.ts:337-355`:

```ts
//? Copy framework AI documentation so consumer's AI agents have full context.
//? Only branch-logs/README.md is copied (not the framework's own log entries) -
//? the consumer's first session initializes their own branch-log file.
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const docsCopies: Array<[string, string, boolean]> = [
  // [source, dest, isDirectory]
  [path.join(repoRoot, 'CLAUDE.md'),                path.join(targetDir, 'CLAUDE.md'),                  false],
  [path.join(repoRoot, 'docs'),                     path.join(targetDir, 'docs', 'luckystack'),         true],
  [path.join(repoRoot, 'skills'),                   path.join(targetDir, 'skills'),                     true],
  [path.join(repoRoot, '.claude', 'commands'),      path.join(targetDir, '.claude', 'commands'),        true],
  [path.join(repoRoot, 'branch-logs', 'README.md'), path.join(targetDir, 'branch-logs', 'README.md'),   false],
];
for (const [src, dst, isDir] of docsCopies) {
  if (!fs.existsSync(src)) continue;
  if (isDir) {
    copyTree(src, dst, vars);
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}
console.log('Framework AI documentation copied (CLAUDE.md, docs/luckystack/, skills/, .claude/commands/, branch-logs/README.md).');
```

## Copy entries

| Source (relative to repoRoot) | Destination (relative to targetDir) | Kind |
| --- | --- | --- |
| `CLAUDE.md` | `CLAUDE.md` | file |
| `docs/` | `docs/luckystack/` | directory |
| `skills/` | `skills/` | directory |
| `.claude/commands/` | `.claude/commands/` | directory |
| `branch-logs/README.md` | `branch-logs/README.md` | file |

### Why `docs/` -> `docs/luckystack/`

The consumer is very likely to add their own product docs under `docs/`. Renaming the framework docs into a `luckystack` namespace prevents naming collisions and makes the boundary obvious in an AI agent's file picker — anything under `docs/luckystack/` is framework reference, anything else is the consumer's own.

### Why `skills/` and `.claude/commands/` stay at root

These are Claude Code conventions and must live at fixed paths to be discovered by the CLI. Renaming them would silently disable the slash-commands and skills the framework ships with.

### Why only `branch-logs/README.md`, not the entries themselves

`branch-logs/` is a session-tracking convention: each working branch gets its own log file. The framework's own log entries are bookkeeping for the LuckyStack repo, not artefacts the consumer should inherit. Copying the README alone gives the consumer the convention without polluting their history. Their first session is expected to create a fresh per-branch log.

## Framework-doc source resolution

The build step `scripts/bundleFrameworkDocs.mjs` copies the framework sources into the published package under
`framework-docs/`. At runtime `copyAiDocs()` prefers that bundled directory, so a published
`npx create-luckystack-app` receives the same AI contract and deep docs as a monorepo scaffold.

The monorepo-root fallback remains useful for local `scaffold:test` runs when the bundle has not been built.
Missing optional source directories are skipped, but a published package build always bundles the framework
docs before `dist/` is produced.

The bundle contains the framework's docs and conventions, not the framework's own branch-log entries. A
consumer gets a fresh `branch-logs/README.md` convention and creates its own branch log on its first real
change. Framework dated findings are stripped from the consumer copy; `FINDINGS_PROTOCOL.md` and the findings
index remain as conventions.

## Skip behaviour

A missing optional source is skipped without aborting the scaffold. The scaffold still has its template tree,
and the final output reports how many AI-doc sources were copied. A published package should not silently
lack the framework docs: `npm run build` runs the bundler first, and the scaffold runtime prefers the bundled
source when it exists.

The unconditional log line is a known minor wart. It is cheap to keep accurate by gating on a counter; left as-is today because the noise is low and the line acts as a flow checkpoint in CI traces.

## `copyTree` reuse

Directory entries are funnelled through the same `copyTree(src, dst, vars)` used for the template. That means:

- The `vars` substitution map (`{{PROJECT_NAME}}`, `{{LUCKYSTACK_VERSION}}`, etc.) IS applied to framework-docs content. Any `{{...}}` token in a doc would be replaced. Today the framework docs use plain text only, but new placeholders added later will activate here automatically.
- The `_dot_` -> `.` filename rewrite also applies. Today no file under `docs/`, `skills/`, or `.claude/commands/` uses the `_dot_` convention, so this is a no-op.
- `isTextFile` still gates substitution per-file. PNG screenshots in docs would be byte-copied.

File-entry copies (`CLAUDE.md`, `branch-logs/README.md`) skip `copyTree` entirely and go through `fs.copyFileSync`. No placeholder substitution is performed on them. This is acceptable because both files are currently free of `{{...}}` tokens; if that ever changes we will need to route them through a helper that runs `replacePlaceholders`.

## Re-running / updating

The scaffold is single-shot. The CLI refuses to write into an existing directory, so the framework-docs copy never runs against an existing project. Consumers who want to refresh the framework docs in their project after a LuckyStack update should upgrade the installed framework packages and run:

```sh
npx luckystack update
```

The update command re-renders the framework-owned surface with the recorded scaffold choices. Pristine files
are safely overwritten; user-modified files receive `.new` sidecars for an AI-assisted merge. Package-local
`CLAUDE.md` and deep docs refresh through the corresponding `@luckystack/*` package upgrade.

## Related

- Scaffold flow: [`scaffold-flow.md`](./scaffold-flow.md)
- Cross-cutting packaging strategy: `/docs/ARCHITECTURE_PACKAGING.md` (framework repo).
- Upgrade runbook: `/docs/UPGRADING.md`.
