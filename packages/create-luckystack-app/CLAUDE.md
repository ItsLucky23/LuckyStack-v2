# create-luckystack-app

> AI summary + function INDEX. For deep specs see `docs/` next to this file.

## What this package does

`create-luckystack-app` is the interactive scaffold CLI for LuckyStack projects. Consumers invoke it via `npx create-luckystack-app <project-name>`; it copies the bundled `template/` tree into a fresh target directory, substitutes a small set of template variables, optionally prompts for high-level scaffold choices (database provider, auth mode, OAuth providers, email adapter, monitoring backend, i18n on/off), and finishes with `npm install` + `npx prisma generate` so the project is buildable on first try.

The bundled `template/` tree is intentionally self-contained for `npm run test`: it ships `template/scripts/generateTypeMaps.ts` + `template/scripts/generateServerRequests.ts` and `template/server/config/presetLoader.ts`, and the template `package.json` chains a `generateArtifacts` script into `test`. Without these, the scaffold's `testAll.ts` would import `apiInputSchemas.generated` / `apiTypes.generated` files that don't exist yet on first checkout and `npm run test` would fail before the test runner even starts.

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
| `parseArgs(argv)` | Strict argv parser. Recognises `--no-install`, `--no-prompt`, the opt-in package flags `--presence` / `--error-tracking` / `--docs-ui` / `--secret-manager`, `--db=` / `--auth=` / `--oauth=` / `--email=` / `--monitoring=`, `--i18n` / `--no-i18n`, `--ai-docs` / `--no-ai-docs`, `--ai-browser=<all\|agent-browser\|none>`, `--help` / `-h` (the `VALID_FLAGS` list), plus the first non-flag token as the project name. Any other `-`/`--` token (or a bad value) causes `process.exit(2)`. Returns `CliArgs`. | -> docs/cli-flags.md |
| `printHelp()` | Prints the human-readable usage banner. Triggered by `--help` / `-h` and on missing project name. | -> docs/cli-flags.md |
| `runPrompts()` | Arrow-key TTY wizard (with an `(x/y)` progress counter + a one-line description under each step) walking `dbProvider`, `authMode`, `oauthProviders` (conditional), `emailProvider`, `monitoringProvider`, then the per-package opt-IN toggles `presence` / `errorTracking` / `docsUi` / `secretManager` (all default off), `i18n` (default off), `aiInstructions` (default on), `aiBrowserTooling` (conditional). Falls back to `runPromptsFallback` (numbered prompts) on a non-TTY. Returns a fully populated `ScaffoldChoices`. Skipped when `--no-prompt` is passed. | -> docs/scaffold-flow.md |
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
| Framework-docs copy block (inside `main`) | After the template copy, recursively copies root `CLAUDE.md`, `docs/` (-> `docs/luckystack/` in the scaffold), `skills/`, `.claude/commands/`, and `branch-logs/README.md` from the repo root into the target. Each source is optional — missing sources are skipped silently. | -> docs/framework-docs-copy.md |
| Type: `CliArgs` | `{ projectName: string; install: boolean; prompt: boolean; help: boolean }`. Output of `parseArgs`. | -> docs/cli-flags.md |
| Type: `ScaffoldChoices` | `{ dbProvider, authMode, oauthProviders, emailProvider, monitoringProvider, presence, errorTracking, docsUi, secretManager, i18n, aiInstructions, aiBrowserTooling }`. Output of `runPrompts` / `DEFAULT_CHOICES`. **Lean-by-default**: every optional package/feature is OFF unless opted in. `presence` / `errorTracking` are pruned from the (full) template when off; `docsUi` / `secretManager` are injected as deps when on (`secretManager` also uncomments its config.ts + server.ts blocks via `wireSecretManager`). `aiBrowserTooling: 'all' \| 'agent-browser' \| 'none'` is forced to `'none'` when `aiInstructions` is off. | -> docs/scaffold-flow.md |
| Constant: `DEFAULT_CHOICES` | Lean defaults applied under `--no-prompt`: Mongo + `auth: 'none'` + `email: 'none'` + no monitoring + presence/error-tracking/docs-ui/secret-manager/i18n all OFF + AI instructions ON + `aiBrowserTooling: 'agent-browser'`. The ONE on-by-default optional is `aiInstructions` (docs only, no app-runtime weight). | -> docs/scaffold-flow.md |
| Constant: `TEMPLATE_DIR` | Resolved absolute path to the bundled `template/` folder (`../template` from `dist/index.js`). The scaffold aborts with a packaging-bug message when this directory is missing at runtime. | -> docs/scaffold-flow.md |

## Config keys

This package reads no env vars and no `projectConfig` slots — it runs before any LuckyStack runtime is bootstrapped. All input flows through positional argv + interactive prompts.

CLI flags (parsed by `parseArgs`):

- `<project-name>` (positional, required) — directory name + slug source for `{{PROJECT_NAME}}` / `{{PROJECT_TITLE}}`. Must not already exist.
- `--no-install` — skip `npm install` and `npx prisma generate` after copying.
- `--no-prompt` — skip the interactive prompts and apply `DEFAULT_CHOICES`.
- `--presence` — opt INTO `@luckystack/presence` (off by default; applies under `--no-prompt`, the wizard asks otherwise).
- `--error-tracking` — opt INTO `@luckystack/error-tracking` (off by default).
- `--docs-ui` — opt INTO `@luckystack/docs-ui` (in-app API docs viewer; off by default).
- `--secret-manager` — opt INTO `@luckystack/secret-manager` (`.env`-pointer secrets; off by default).
- `--ai-browser=<all|agent-browser|none>` — AI browser-testing tooling (default `agent-browser`); `'all'` also wires the Playwright + Chrome DevTools MCP servers. Value flag (`process.exit(2)` on a bad value). Needs the AI instructions on.
- `--help`, `-h` — print usage and exit.

Template variables substituted into every text file by `replacePlaceholders` (only vars that appear as `{{TOKEN}}` in a template file are listed here):

- `{{PROJECT_NAME}}` — slugified project name (from `slugify`); used in `package.json` + `.env_template`.
- `{{PROJECT_TITLE}}` — Title-Cased project name (from `titleCase`); used in `config.ts`, `index.html`, `README.md`, `docs/PRODUCT.md`.
- `{{LUCKYSTACK_VERSION}}` — this package's own version (from `readSelfVersion`); used to pin `@luckystack/*` dependency ranges in the scaffolded `package.json`.
- `{{DB_PROVIDER}}` — `'mongodb' | 'postgresql' | 'mysql' | 'sqlite'`; used in `prisma/schema.prisma`.
- `{{USER_ID_ATTRS}}` — provider-specific Prisma `id` field attributes; used in `prisma/schema.prisma`.
- `{{DATABASE_URL}}` — provider-specific example connection string; used in `.env.local_template`.
- `{{OAUTH_ENV_VARS}}` — rendered OAuth env block (all providers, active/commented); used in `.env.local_template`.
- `{{EXTERNAL_ORIGINS}}` — comma-joined OAuth origin allow-list; used in `.env_template`.
- `{{EMAIL_ENV_VARS}}` — rendered email adapter env block; used in `.env.local_template`.
- `{{MONITORING_ENV_VARS}}` — rendered monitoring provider env block; used in `.env.local_template`.

## Peer dependencies

- **Runtime deps**: none. This package uses only Node.js built-ins (`fs`, `path`, `readline/promises`, `process`, `node:url`, `node:child_process`).
- **Required at scaffold time on the consumer's machine**: Node.js >= 20 (declared in `engines`), `npm` reachable on `PATH` (used by `runNpmInstall` and `runPrismaGenerate`).
- **Optional**: none. The scaffold produces a project that itself depends on `@luckystack/*` packages, but this CLI does not import them.

## Related

- Consumer quickstart: `./README.md`.
- Architecture doc shipped with the scaffold: `/docs/ARCHITECTURE_PACKAGING.md` (overlay folder convention + `bootstrapLuckyStack`).
- Developer guide referenced from the final "next steps" block: `/docs/DEVELOPER_GUIDE.md`.
