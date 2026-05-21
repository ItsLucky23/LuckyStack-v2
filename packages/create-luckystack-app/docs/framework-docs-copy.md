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

## `repoRoot` resolution

```ts
const repoRoot = path.resolve(__dirname, '..', '..', '..');
```

`__dirname` resolves to the directory containing the compiled `index.js`. With the project layout `packages/create-luckystack-app/dist/index.js`, three `..` hops reach the monorepo root. In the published npm tarball this same path resolves to somewhere inside `node_modules/create-luckystack-app/../../../`, which is the consumer's project parent and where none of the listed sources exist — hence the `fs.existsSync(src) || continue` guard.

This means the copy step is effectively a **monorepo-only** operation. When invoked via published `npx create-luckystack-app`, the loop skips every entry silently and the consumer only gets the bundled `template/` tree. This is acceptable today because:

- The published flow is the primary way external users will install.
- The bundled `template/` tree already contains a project-level `README.md` and `package.json` describing where to read the docs online.
- The per-package docs still arrive via `node_modules/@luckystack/*/`.

If we want consumers of the published CLI to also receive the root docs, we will need to add them to the package tarball — for example by copying them into `template/docs/luckystack/` during the package's `prepublishOnly` script. That decision is intentionally deferred.

## Skip behaviour

`fs.existsSync(src) || continue` makes every entry optional. Failure modes covered:

- Monorepo where some convention is not yet present (e.g. a fresh checkout with no `skills/` directory yet) — that entry is skipped without warning.
- Published tarball flow where none of the sources exist — all entries are silently skipped, and the only visible side effect is the trailing `console.log` claiming the docs were copied (it always logs, even when nothing was copied).

The unconditional log line is a known minor wart. It is cheap to keep accurate by gating on a counter; left as-is today because the noise is low and the line acts as a flow checkpoint in CI traces.

## `copyTree` reuse

Directory entries are funnelled through the same `copyTree(src, dst, vars)` used for the template. That means:

- The `vars` substitution map (`{{PROJECT_NAME}}`, `{{LUCKYSTACK_VERSION}}`, etc.) IS applied to framework-docs content. Any `{{...}}` token in a doc would be replaced. Today the framework docs use plain text only, but new placeholders added later will activate here automatically.
- The `_dot_` -> `.` filename rewrite also applies. Today no file under `docs/`, `skills/`, or `.claude/commands/` uses the `_dot_` convention, so this is a no-op.
- `isTextFile` still gates substitution per-file. PNG screenshots in docs would be byte-copied.

File-entry copies (`CLAUDE.md`, `branch-logs/README.md`) skip `copyTree` entirely and go through `fs.copyFileSync`. No placeholder substitution is performed on them. This is acceptable because both files are currently free of `{{...}}` tokens; if that ever changes we will need to route them through a helper that runs `replacePlaceholders`.

## Re-running / updating

The scaffold is single-shot. The CLI refuses to write into an existing directory, so the framework-docs copy never runs against an existing project. Consumers who want to refresh the framework docs in their project after a LuckyStack update have two options:

1. Manual: pull the latest files from the GitHub repo and overlay them.
2. Via `npm update`: per-package docs in `node_modules/@luckystack/*/` update automatically.

There is no built-in "refresh framework docs" subcommand. Adding one would require a careful merge strategy because the consumer might have edited the docs after scaffolding, and a naive overwrite would discard their changes.

## Related

- Scaffold flow: [`scaffold-flow.md`](./scaffold-flow.md)
- Plan reference: Fase E.2 in the packaging-prep plan (kept in the working-branch notes, not committed).
- Cross-cutting packaging strategy: `/docs/ARCHITECTURE_PACKAGING.md` (framework repo).
