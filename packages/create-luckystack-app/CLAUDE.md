# create-luckystack-app

> AI summary + function INDEX. For deep specs see `docs/` next to this file.

## What this package does

`create-luckystack-app` is the interactive scaffold CLI for LuckyStack projects. Consumers invoke it via `npx create-luckystack-app <project-name>`; it copies the bundled `template/` tree into a fresh target directory, substitutes a small set of template variables, optionally prompts for high-level scaffold choices (database provider, auth mode, OAuth providers, email adapter, monitoring backend, optional packages), and finishes with `npm install` + `npx prisma generate` so the project is buildable on first try. i18n (the multi-language setup: nl/de/fr locales + switcher) ALWAYS ships — the translator is core, so there's no toggle for it.

The bundled `template/` tree is intentionally self-contained for `npm run test`: it ships `template/scripts/generateTypeMaps.ts` + `template/scripts/generateServerRequests.ts`, and the template `package.json` chains a `generateArtifacts` script into `test`. Without these, the scaffold's `testAll.ts` would import `apiInputSchemas.generated` / `apiTypes.generated` files that don't exist yet on first checkout and `npm run test` would fail before the test runner even starts. (`template/server/config/presetLoader.ts` ships too but is router-gated — `pruneRouter` removes it for a no-router scaffold, where `generateServerRequests` falls back to a single `default` bundle.)

Ports have a single source of truth: `template/config.ports.ts` (`export const ports = { frontend, backend }`) ALWAYS ships — `config.ts` re-exports it, `server.ts` passes `ports.backend` to the server as `defaultPort`, and `vite.config.ts` reads `ports.frontend`. The scaffold `.env` no longer carries `SERVER_PORT` (a positional argv `<port>` overrides for multi-instance boots; `SERVER_IP` stays in `.env`).

Beyond the bare template copy, the CLI also copies the framework's AI-facing documentation into the scaffolded project (root `CLAUDE.md`, `docs/luckystack/`, `skills/`, `.claude/commands/`) so a consumer's AI agents inherit the same context that the framework repo provides. Per-package `CLAUDE.md` + `docs/` ship via the npm tarballs and land in `node_modules/@luckystack/*/` once `npm install` runs.

## When to USE this package

- Bootstrapping a brand-new LuckyStack project from scratch (recommended path for any new app).
- Generating a reproducible reference layout to compare against an existing project's overlay folder.
- CI smoke-tests that exercise the full publishable surface (`npx create-luckystack-app smoke-test --no-prompt --no-install`).

## When to NOT suggest this (yet)

- Existing LuckyStack projects: the CLI refuses to write into a directory that already exists. Do not run it inside an existing project to "refresh" files — use `npx luckystack update` (the `@luckystack/cli` command) to refresh the framework-owned copied files; it re-renders via this scaffolder under the hood using the recorded `.luckystack/scaffold.json` choices.
- Upgrading framework dependencies in an existing project: bump `@luckystack/*` versions in the consumer's `package.json` directly (then run `npx luckystack update` for the copied files).
- Producing a non-LuckyStack starter (different framework, different stack): nothing here is framework-agnostic.
- Anything that is not a one-shot fresh-checkout scaffold.

## Function Index

| Function / Export | One-liner | Deep doc |
| --- | --- | --- |
| `main()` (CLI entrypoint, auto-invoked at bottom of `src/index.ts`) | Orchestrates the full scaffold flow: parse argv -> validate target dir -> optional prompts -> `copyTree` -> framework-docs copy (E.2) -> scaffold-manifest write -> optional `npm install` + `npx prisma generate` -> print next-step block. | -> docs/scaffold-flow.md |
| `writeScaffoldManifest(targetDir, { luckystackVersion, projectName, choices, isTextFile })` (`src/scaffoldManifest.ts`) | LAST file-producing step of `main()`: writes `.luckystack/scaffold.json` = `{ schemaVersion, luckystackVersion, createdAt, projectName, choices, files: [{ path, sha256 }] }` — the committed baseline that lets a future `luckystack update` re-render the template with the SAME choices and tell pristine files (hash matches → safe overwrite) from user-modified ones (never overwrite). Hashes are CRLF→LF-normalized for text files; `node_modules`/`.git`/`.env`/`.env.local`/`.secret-manager-token`/the manifest itself are excluded. Companion helpers `collectFileHashes` / `hashFileContent` are exported for the update tooling. Rationale: ADR 0021. | (module header) |
| `parseArgs(argv)` | Strict argv parser. Recognises `--no-install`, `--no-prompt`, the opt-in package flags `--presence` / `--error-tracking` / `--docs-ui` / `--secret-manager` / `--router` / `--cron`, `--db=` / `--auth=` / `--oauth=` / `--email=` / `--monitoring=`, `--ai-docs` / `--no-ai-docs`, `--ai-browser=<all\|agent-browser\|none>`, `--help` / `-h` (the `VALID_FLAGS` list), plus the first non-flag token as the project name. Any other `-`/`--` token (or a bad value) causes `process.exit(2)`. Returns `CliArgs`. | -> docs/cli-flags.md |
| `printHelp()` | Prints the human-readable usage banner. Triggered by `--help` / `-h` and on missing project name. | -> docs/cli-flags.md |
| `runPrompts()` | Arrow-key TTY wizard (an `(x/y)` progress counter, a one-line description + a `?`-toggle `details` block on EVERY step, and a final **review screen** listing all choices with `← back to edit` before commit) walking `dbProvider`, `authMode`, `oauthProviders` (conditional), `emailProvider`, `monitoringProvider`, then the per-package opt-IN toggles `presence` / `errorTracking` / `docsUi` / `secretManager` / `router` / `cron` (all default off), `aiInstructions` (default on), `aiBrowserTooling` (conditional). (i18n is NOT a choice — it always ships.) Falls back to `runPromptsFallback` (numbered prompts) on a non-TTY. Returns a fully populated `ScaffoldChoices`. Skipped when `--no-prompt` is passed. | -> docs/scaffold-flow.md |
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
| Type: `ScaffoldChoices` | `{ orm, dbProvider, authMode, oauthProviders, emailProvider, monitoringProvider, presence, errorTracking, docsUi, secretManager, router, cron, aiInstructions, aiBrowserTooling }`. `orm: 'prisma' \| 'drizzle' \| 'mikro-orm' \| 'none'` (ADR 0020) — non-prisma routes through `stripPrismaSurface` + `applyOrmChoice` (drizzle constrains `dbProvider` to SQL; wizard uses twin db-steps with complementary skips). Auth is selectable on drizzle/mikro-orm via `adaptAuthNonPrisma` (ADR 0023); only orm `'none'` forces auth off. Output of `runPrompts` / `DEFAULT_CHOICES`. **Lean-by-default**: every optional package/feature is OFF unless opted in. `presence` / `errorTracking` / `router` are pruned from the (full) template when off (router via `pruneRouter`, which strips `services.config.ts` + `deploy.config.ts` + `server/config/presetLoader.ts` and un-wires their two `server.ts` side-effect imports — mirroring `prunePresence` / `pruneDocsUi`); `docsUi` / `secretManager` / `cron` are injected when on (dependency-only via `injectOptionalDeps`; `secretManager` also uncomments its config.ts + server.ts blocks via `wireSecretManager`; `cron` self-wires at boot via `@luckystack/cron/register` — no template file, byte-identical to `luckystack add cron`). When router IS chosen the topology config files are KEPT and `wireRouter` adds the dep + a `npm run router` script. `aiBrowserTooling: 'all' \| 'agent-browser' \| 'none'` is forced to `'none'` when `aiInstructions` is off. i18n is NOT a choice — the full multi-language setup always ships (translator is core). | -> docs/scaffold-flow.md |
| Constant: `DEFAULT_CHOICES` | Lean defaults applied under `--no-prompt`: Mongo + `auth: 'none'` + `email: 'none'` + no monitoring + presence/error-tracking/docs-ui/secret-manager/router/cron all OFF + AI instructions ON + `aiBrowserTooling: 'agent-browser'`. The ONE on-by-default optional is `aiInstructions` (docs only, no app-runtime weight). i18n always ships (not a choice). | -> docs/scaffold-flow.md |
| `wireRouter()` / `wireGraphMcp()` | `wireRouter` (opt-in `router`) adds `@luckystack/router` + a `router` npm script (separate-process load-balancer; topology in deploy.config.ts). `wireGraphMcp` (rides on `aiInstructions`) adds `@luckystack/mcp` as a devDep + registers it in `.mcp.json` so AI agents query the project dependency graph. `@luckystack/cli` ships as a template devDep so `npx luckystack add` resolves locally. | -> docs/scaffold-flow.md |
| Constants: `PRISMA_USER_TYPE_IMPORT` / `ORM_NONE_CONFIG_USER_TYPE` / `DRIZZLE_DRIVER_DEPS` / `MIKRO_DRIVER_PACKAGES` / `USER_ADAPTER_STARTERS` | Exported ORM-surface tokens (the config.ts `User`-type import + orm-none placeholder block, the per-db driver dep tables, and the per-ORM starter UserAdapters written by `adaptAuthNonPrisma`). Consumed by the CLI's `switchOrm.test.ts` parity guards so the manage-wizard ORM switch / add-login can never drift from what the scaffolder actually renders. | (module header) |
| `adaptAuthNonPrisma(targetDir, orm)` | Auth ON + non-Prisma data layer (ADR 0023): prunes ONLY the Prisma-bound surface (`src/settings` + `server/hooks/notifications.ts` + their wiring/README/Home.tsx mentions) and writes the per-ORM starter `luckystack/login/userAdapter.ts` (auto-imported at boot via the login overlay slot). login/register/reset-password stay. | (module header) |
| Constant: `TEMPLATE_DIR` | Resolved absolute path to the bundled `template/` folder (`../template` from `dist/index.js`). The scaffold aborts with a packaging-bug message when this directory is missing at runtime. | -> docs/scaffold-flow.md |

## Config keys

This package reads no env vars and no `projectConfig` slots — it runs before any LuckyStack runtime is bootstrapped. All input flows through positional argv + interactive prompts.

CLI flags (parsed by `parseArgs`):

- `<project-name>` (positional, required) — directory name + slug source for `{{PROJECT_NAME}}` / `{{PROJECT_TITLE}}`. Must not already exist.
- `--orm=<prisma|drizzle|mikro-orm|none>` — data layer (default `prisma`; ADR 0020 + 0023). Every non-prisma value strips the Prisma surface (prisma/ dir, `@prisma/client` + `prisma` deps, `prisma:*` scripts, `scripts/prismaWithSecrets.ts`), swaps config.ts's Prisma `User` type import for a local placeholder, and skips `prisma generate`. **Auth**: selectable on drizzle/mikro-orm (ADR 0023) — the scaffold then keeps the adapter-based login/register/reset-password flows, writes the per-ORM starter `luckystack/login/userAdapter.ts` (finish it to activate sign-in; parity-tested against the CLI's copy), and prunes ONLY the Prisma-bound surface (`src/settings` + `server/hooks/notifications.ts`) so the scaffold stays buildable on first try. Only `--orm=none` forces `--auth=none` (explicit combo exits 2 — no data layer for a UserAdapter). Then per value:
  - `drizzle` (TypeScript-first, **SQL-only** — an explicit `--db=mongodb` exits 2; an implicit mongodb default silently becomes `postgresql` with a note; the wizard swaps in a SQL-only db step): ships `server/db/schema.ts` (per-dialect starter table), root `drizzle.config.ts` (read by drizzle-kit), a live `functions/db.ts` client (node-postgres/mysql2/better-sqlite3 per db), deps `drizzle-orm` + driver, devDeps `drizzle-kit` (+ driver types), scripts `db:generate|migrate|push|studio`.
  - `mikro-orm` (TypeScript-first, **incl. first-class MongoDB**): ships `server/db/entities.ts` (EntitySchema — no decorators/reflect-metadata needed) + `server/db/mikro-orm.config.ts`, a `functions/db.ts` exposing `getOrm()`/`getEm()` (fork-per-request documented), deps `@mikro-orm/core` + driver package, devDep `@mikro-orm/cli` + a package.json `"mikro-orm".configPaths` entry, script `db:schema:update`.
  - `none`: bring-your-own hooks only (`functions/db.ts` + `luckystack/core/clients.ts` stubs) + wiring checklist.
  All non-prisma variants: `/readyz` reports the DB check as `'skipped'` unless the consumer registers `registerDbHealthCheck(...)` (each clients.ts stub shows the per-ORM example).
- `--no-install` — skip `npm install` and `npx prisma generate` after copying.
- `--no-prompt` — skip the interactive prompts and apply `DEFAULT_CHOICES`.
- `--presence` — opt INTO `@luckystack/presence` (off by default; applies under `--no-prompt`, the wizard asks otherwise).
- `--error-tracking` — opt INTO `@luckystack/error-tracking` (off by default).
- `--docs-ui` — opt INTO `@luckystack/docs-ui` (in-app API docs viewer; off by default).
- `--secret-manager` — opt INTO `@luckystack/secret-manager` (`.env`-pointer secrets; off by default).
- `--router` — opt INTO `@luckystack/router` (multi-instance load-balancer + `npm run router`; off by default).
- `--cron` — opt INTO `@luckystack/cron` (leader-elected recurring jobs; off by default). Dependency-only + self-wires at boot (byte-identical to `luckystack add cron`); register jobs in `luckystack/cron/*.ts`.
- `--ai-browser=<all|agent-browser|none>` — AI browser-testing tooling (default `agent-browser`); `'all'` also wires the Playwright + Chrome DevTools MCP servers. Value flag (`process.exit(2)` on a bad value). Needs the AI instructions on.
- `--help`, `-h` — print usage and exit.

Template variables substituted into every text file by `replacePlaceholders` (only vars that appear as `{{TOKEN}}` in a template file are listed here):

- `{{PROJECT_NAME}}` — slugified project name (from `slugify`); used in `package.json` + `.env_template`.
- `{{PROJECT_TITLE}}` — Title-Cased project name (from `titleCase`); used in `config.ts`, `index.html`, `README.md`, `docs/PRODUCT.md`.
- `{{LUCKYSTACK_VERSION}}` — this package's own version (from `readSelfVersion`); used to pin `@luckystack/*` dependency ranges in the scaffolded `package.json`.
- `{{DB_PROVIDER}}` — `'mongodb' | 'postgresql' | 'mysql' | 'sqlite'`; used in `prisma/schema.prisma`.
- `{{PRISMA_INIT_CMD}}` — provider-conditional DB-init command (`npm run prisma:db:push` for MongoDB, else `npm run prisma:migrate:dev`); used in `README.md`'s "Get started" block.
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
