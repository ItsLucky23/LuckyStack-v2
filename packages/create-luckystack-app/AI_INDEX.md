# create-luckystack-app

> AI summary + function INDEX (referenced from root /CLAUDE.md as AI_INDEX.md). For deep specs see `docs/` next to this file.

## What this package does

`create-luckystack-app` is the interactive scaffold CLI for LuckyStack projects. Consumers invoke it via `npx create-luckystack-app <project-name>`; it copies the bundled `template/` tree into a fresh target directory, substitutes a small set of template variables, optionally prompts for high-level scaffold choices (database provider, auth mode, OAuth providers, email adapter, monitoring backend, i18n on/off), and finishes with `npm install` + `npx prisma generate` so the project is buildable on first try.

Beyond the bare template copy, the CLI also copies the framework's AI-facing documentation into the scaffolded project (root `CLAUDE.md`, `docs/luckystack/`, `skills/`, `.claude/commands/`) so a consumer's AI agents inherit the same context that the framework repo provides. Per-package `CLAUDE.md` + `docs/` ship via the npm tarballs and land in `node_modules/@luckystack/*/` once `npm install` runs.

## When to USE this package

- Bootstrapping a brand-new LuckyStack project from scratch (recommended path for any new app).
- Generating a reproducible reference layout to compare against an existing project's overlay folder.
- CI smoke-tests that exercise the full publishable surface (`npx create-luckystack-app smoke-test --no-prompt --no-install`).

## When to NOT suggest this (yet)

- Existing LuckyStack projects: the CLI refuses to write into a directory that already exists. Do not run it inside an existing project to "refresh" files. Pull individual updates manually instead.
- Upgrading framework dependencies in an existing project: bump `@luckystack/*` versions in the consumer's `package.json` directly.
- Producing a non-LuckyStack starter (different framework, different stack): nothing here is framework-agnostic.
- Anything that is not a one-shot fresh-checkout scaffold.

## Function Index

| Function / Export | One-liner | Deep doc |
| --- | --- | --- |
| `main()` (CLI entrypoint, auto-invoked at bottom of `src/index.ts`) | Orchestrates the full scaffold flow: parse argv -> validate target dir -> optional prompts -> `copyTree` -> framework-docs copy (E.2) -> optional `npm install` + `npx prisma generate` -> print next-step block. | -> docs/scaffold-flow.md |
| `parseArgs(argv)` | Strict argv parser. Recognises `--no-install`, `--no-prompt`, `--help` / `-h` (the `VALID_FLAGS` list), plus the first non-flag token as the project name. Any other `-`/`--` token causes `process.exit(2)` with an "Unknown flag" error. Returns `CliArgs`. | -> docs/cli-flags.md |
| `printHelp()` | Prints the human-readable usage banner. Triggered by `--help` / `-h` and on missing project name. | -> docs/cli-flags.md |
| `runPrompts()` | Opens a `readline` interface and walks the user through `dbProvider`, `authMode`, `oauthProviders` (conditional), `emailProvider`, `monitoringProvider`, `i18n`. Returns a fully populated `ScaffoldChoices`. Skipped when `--no-prompt` is passed. | -> docs/scaffold-flow.md |
| `pickFromList(rl, label, options, defaultValue)` | Single-choice prompt helper. Accepts either a numeric index or a case-insensitive option name. Blank input returns the default. | -> docs/scaffold-flow.md |
| `pickMulti(rl, label, options)` | Multi-choice prompt helper. Parses a comma-separated list of indices / option names; blank input returns `[]`. | -> docs/scaffold-flow.md |
| `askYesNo(rl, label, defaultValue)` | Boolean prompt helper. Treats blank input as the default; `y` / `yes` -> `true`, anything else -> `false`. | -> docs/scaffold-flow.md |
| `slugify(raw)` | Lower-cases the raw project name, replaces non-alphanumerics with `-`, trims leading / trailing dashes. Drives `{{PROJECT_NAME}}` and the directory name. | -> docs/template-variables.md |
| `titleCase(raw)` | Splits on whitespace / dashes / underscores and Title-Cases each part. Drives `{{PROJECT_TITLE}}`. Falls back to `'My LuckyStack App'` when input is empty. | -> docs/template-variables.md |
| `readSelfVersion()` | Reads this package's own `version` from its `package.json`. Drives `{{LUCKYSTACK_VERSION}}`. Throws loudly when the version is missing or malformed (deliberate — silent fallback would pin every scaffold to a stale dep set). | -> docs/template-variables.md |
| `renameDotFile(name)` | Filename rewriter that replaces every occurrence of `_dot_` with `.`. Works around npm's behavior of skipping files whose names start with `.` when publishing the tarball (`.gitignore`, `.env_template`, etc.). | -> docs/scaffold-flow.md |
| `replacePlaceholders(content, vars)` | Substitutes every `{{KEY}}` token in a file's text content with the matching entry from `vars`. Leaves unknown placeholders verbatim. | -> docs/template-variables.md |
| `isTextFile(filePath)` | Returns `true` for known text extensions (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.json`, `.md`, `.css`, `.html`, `.prisma`) and for dotfiles (post-rename names starting with `.`). Controls whether `copyTree` runs placeholder substitution or binary-copies the file. | -> docs/template-variables.md |
| `copyTree(src, dest, vars)` | Recursive directory copier. For each entry: rewrites the destination filename via `renameDotFile`, recurses into directories, runs `replacePlaceholders` on text files, falls back to `fs.copyFileSync` for binaries. | -> docs/scaffold-flow.md |
| `runNpmInstall(cwd)` | Spawns `npm install` (`npm.cmd` on Windows) in the scaffolded directory with inherited stdio. Logs a manual-fallback hint if it exits non-zero. | -> docs/post-scaffold-suggestions.md |
| `runPrismaGenerate(cwd)` | Spawns `npx prisma generate` after `npm install` so first-build types resolve. Does NOT run `prisma db push` or `prisma migrate` — those require a populated `DATABASE_URL`. | -> docs/post-scaffold-suggestions.md |
| Framework-docs copy block (inside `main`, scheduled for Fase E.2) | After the template copy, recursively copies root `CLAUDE.md`, `docs/` (-> `docs/luckystack/` in the scaffold), `skills/`, and `.claude/commands/` from the repo root into the target. Each source is optional — missing sources are skipped silently. | -> docs/framework-docs-copy.md |
| Type: `CliArgs` | `{ projectName: string; install: boolean; prompt: boolean; help: boolean }`. Output of `parseArgs`. | -> docs/cli-flags.md |
| Type: `ScaffoldChoices` | `{ dbProvider, authMode, oauthProviders, emailProvider, monitoringProvider, i18n }`. Output of `runPrompts` / `DEFAULT_CHOICES`. | -> docs/scaffold-flow.md |
| Constant: `DEFAULT_CHOICES` | Sane defaults used when `--no-prompt` is passed (Mongo + credentials + console email + no monitoring + i18n on). | -> docs/scaffold-flow.md |
| Constant: `TEMPLATE_DIR` | Resolved absolute path to the bundled `template/` folder (`../template` from `dist/index.js`). The scaffold aborts with a packaging-bug message when this directory is missing at runtime. | -> docs/scaffold-flow.md |

## Config keys

This package reads no env vars and no `projectConfig` slots — it runs before any LuckyStack runtime is bootstrapped. All input flows through positional argv + interactive prompts.

CLI flags (parsed by `parseArgs`):

- `<project-name>` (positional, required) — directory name + slug source for `{{PROJECT_NAME}}` / `{{PROJECT_TITLE}}`. Must not already exist.
- `--no-install` — skip `npm install` and `npx prisma generate` after copying.
- `--no-prompt` — skip the interactive prompts and apply `DEFAULT_CHOICES`.
- `--help`, `-h` — print usage and exit.

Template variables substituted into every text file by `replacePlaceholders`:

- `{{PROJECT_NAME}}` — slugified project name (from `slugify`).
- `{{PROJECT_TITLE}}` — Title-Cased project name (from `titleCase`).
- `{{LUCKYSTACK_VERSION}}` — this package's own version (from `readSelfVersion`); used to pin `@luckystack/*` dependency ranges in the scaffolded `package.json`.
- `{{DB_PROVIDER}}` — `'mongodb' | 'postgresql' | 'mysql' | 'sqlite'`.
- `{{AUTH_MODE}}` — `'none' | 'credentials' | 'credentials+oauth'`.
- `{{OAUTH_PROVIDERS}}` — comma-joined list (empty string when none).
- `{{EMAIL_PROVIDER}}` — `'none' | 'console' | 'resend' | 'smtp'`.
- `{{MONITORING_PROVIDER}}` — `'none' | 'sentry' | 'datadog' | 'posthog'`.
- `{{I18N_ENABLED}}` — `'true'` / `'false'` string.

## Peer dependencies

- **Runtime deps**: none. This package uses only Node.js built-ins (`fs`, `path`, `readline/promises`, `process`, `node:url`, `node:child_process`).
- **Required at scaffold time on the consumer's machine**: Node.js >= 20 (declared in `engines`), `npm` reachable on `PATH` (used by `runNpmInstall` and `runPrismaGenerate`).
- **Optional**: none. The scaffold produces a project that itself depends on `@luckystack/*` packages, but this CLI does not import them.

## Related

- Consumer quickstart: `./README.md`.
- Architecture doc shipped with the scaffold: `/docs/ARCHITECTURE_PACKAGING.md` (overlay folder convention + `bootstrapLuckyStack`).
- Developer guide referenced from the final "next steps" block: `/docs/DEVELOPER_GUIDE.md`.
- Plan reference for the framework-docs copy step: Fase E.2 in `fix-import-conflict-en-quiet-cocoa.md`.
