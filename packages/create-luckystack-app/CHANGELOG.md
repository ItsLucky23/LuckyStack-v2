# Changelog

All notable changes to `create-luckystack-app` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.15.0] - 2026-10-19

### Added

- **Template locales gain `sync.disconnected`, `settings.emailChange.managedByProvider` and `session.notFound`** in all four languages.

### Changed

- **Picking a monitoring backend also installs `@luckystack/error-tracking`** (`--monitoring=sentry|datadog|posthog`, or in the wizard), the layer that sends errors to that backend. The wizard asks about error-tracking only when the backend is `none`, as `luckystack manage` already assumed. Before, a backend without error-tracking installed an SDK that never received anything.
- **Breaking:** a flag you pass is no longer dropped silently (ADR 0082). These combinations now exit 2 before anything is written: `--oauth=…` while auth is not `credentials+oauth`; `--auth=credentials|credentials+oauth` with `--orm=none` (now also on the interactive path, which used to only print a message); `--ai-browser=all|agent-browser` with `--no-ai-docs`. Upgrade: drop the flag you don't mean, or add the one it needs (for example `--auth=credentials+oauth` for `--oauth`).
- **Breaking:** with the router installed, `scripts/generateServerRequests.ts` fails the build when a top-level `src/` folder with `_api`/`_sync` routes is not a declared service in any preset. Those routes used to be left out of production without a warning. New helper `scripts/routeServices.ts`. Upgrade: see step 1 below.

### Fixed

- **Breaking:** piped or CI runs without `--no-prompt` no longer lose answers that arrive in one chunk. If stdin ends before every question is answered, the scaffolder now exits 1 with "stdin closed … pass --no-prompt" and writes nothing; before, it exited 0 without creating a project. Upgrade: a CI step that relied on that silent exit 0 should pass `--no-prompt` with explicit flags.
- **A project name with an apostrophe or backslash** (`"bob's app"`) no longer produces a `config.ts` that does not parse. The title is escaped for the TypeScript string and HTML-escaped in `index.html`.
- **`npm run router` works in a `--router` scaffold.** It runs the router CLI through tsx with `--deploy ./deploy.config.ts --services ./services.config.ts`; before, it always exited 2.
- **With the router, the production build includes the settings and password-reset routes:** `services.config.ts` declares `settings` and `reset-password` in the `default` preset.
- **`npm run scaffold:page admin/...` writes `template = 'home'`.** It wrote `'dashboard'`, which the scaffold does not have, so the route crashed with "Element type is invalid".
- **The `plain` page template mounts `<Middleware>`.** In a fresh project `/` now redirects to the dashboard or login instead of showing a blank page, and `/dashboard` sends logged-out visitors to `/login`.
- **The scaffolded `SessionProvider` retries the first session fetch and always marks the session as loaded.** A failed first fetch (backend restart, rate limit) made every guarded page wait 5 seconds and then send a signed-in user to `/login`. A malformed `updateSession` message no longer throws inside the socket listener.
- **The scaffolded `.gitignore` ignores `.env.docker`** (remote database and Redis passwords), **`.env.*.local` and SQLite data files** (`*.db`, `*.db-journal`, `*.db-wal`, `*.db-shm`).
- **The generated GitHub CI no longer fails on every run in a `--pm=bun` project:** bun projects get `oven-sh/setup-bun` and `bun install`. The GitLab file installs bun and caches on `bun.lock`. The Node matrix is 22/24 instead of 20/22, matching `engines`.
- **With `--auth=none`, new pages under admin, dashboard, settings and similar folders no longer redirect to the missing `/login` route**, both on dev template injection and with `npm run scaffold:page`.
- **With drizzle or mikro-orm and auth on, `luckystack/core/clients.ts` no longer says auth was scaffolded off.** It points to the starter `luckystack/login/userAdapter.ts`.
- **OAuth accounts can no longer change their email** (ADR 0083). Settings shows it read-only, and the server refuses the change when it is requested and when it is confirmed.
- **Token-mode OAuth login (`sessionBasedToken: true`) works again.** `src/main.tsx` reads the `#token=` fragment the OAuth callback sends and removes it from the address bar.
- **Changing to a common password, or one longer than 72 bytes, shows the policy message** instead of a server error.
- **A password reset, a password change or a confirmed email change cancels the other kind of pending link.**
- **The reset-password and confirm-email pages remove the token from the URL after reading it.** A reload shows the start screen; open the email link again.
- **An email-change request answers the same way whether or not the address is taken.** Users no longer see "Could not send the confirmation email".
- **Saving profile settings or notification preferences no longer brings back a session that was signed out meanwhile.** The settings routes update the session only while it still exists and otherwise answer `session.notFound`.
- **The client activity heartbeat honours `socket.activityHeartbeatThrottleMs`** instead of a hardcoded 10 seconds.
- **The socket status shows `RECONNECTING` with the attempt number during reconnects.** The template listened for `reconnect_attempt` on the socket, but socket.io-client only emits it on the connection manager.
- **A page without a guard no longer runs the guard of a less specific page** that loaded earlier (`/about` next to a guarded `/:slug`). `src/main.tsx` registers every page route with `registerPageRoute`.
- **The 404 page no longer runs the page guard twice**, now that the `plain` template mounts `<Middleware>` itself.
- **The cron question no longer promises exactly-once execution.** It says normally one instance runs each job, so handlers must be idempotent (safe to run twice).
- **With the router, the `docker` environment in `deploy.config.ts` binds `settings` and `reset-password`** to the app, like `system`. Before, the router answered `serviceNotAssigned` for those routes.

### Upgrading an existing project

1. `npx luckystack update` brings the new `scripts/scaffoldPage.mjs` and, with the router, `scripts/routeServices.ts` and `scripts/generateServerRequests.ts`. Change `template = 'dashboard'` to `'home'` in pages that `scaffold:page` created earlier. With the router, the build then lists every route folder that is not declared: add each one to `services.config.ts` (for example `myFolder: { source: 'myFolder' }`) and to one preset; with login this includes `settings` and `reset-password`.
2. `npx luckystack update --app` brings the changed `src/` files: the `plain` template (`src/_components/templates/Plain.tsx`, `TemplateProvider.tsx`), `src/_providers/SessionProvider.tsx`, `src/main.tsx`, the locale files and, with login, the reset-password and settings pages and routes. It also brings the corrected CI file. A file you edited gets a `.new` sidecar to merge by hand.
3. `package.json` is never touched by `update`. With the router, set the `router` script to `tsx --tsconfig tsconfig.server.json node_modules/@luckystack/router/dist/cli.js --deploy ./deploy.config.ts --services ./services.config.ts`.
4. Add `.env.docker`, `.env.*.local`, `*.db`, `*.db-journal`, `*.db-wal` and `*.db-shm` to `.gitignore`. If `.env.docker` or a `.db` file is already committed, run `git rm --cached` on it and change the credentials it held.

## [0.14.0] - 2026-10-16

### Fixed

- **An SMTP scaffold installs a current nodemailer.** `--email=smtp` added `nodemailer` `^6.9.0` and `@types/nodemailer`; it now adds `nodemailer` `^10.0.0`, which ships its own types. `@luckystack/email` 0.14.0 accepts nodemailer 6.9 to 10.
- **Route and page files injected from `.luckystack/templates/` pass `npm run lint`.** The template copies match devkit 0.14.0's lint-clean bundled templates, and `eslint.official.config.js` allows the empty `{}` input/output shapes in `src/**/_api` and `src/**/_sync` files, which the type generator reads as "no input yet". Empty interfaces stay flagged.
- The 0.12.0 and 0.12.1 upgrade steps below are repeated in the `@luckystack/cli` changelog, because `luckystack upgrade` reads installed packages only and a project never installs this one.

## [0.12.1] - 2026-10-15

### Fixed

- **SQLite projects installed with Bun work.** `bun install` runs a package's install script only when the package is listed in `trustedDependencies`, so `better-sqlite3` never built its native binding: a `--pm=bun` drizzle or mikro-orm project on SQLite crashed on its first query under Node (`Could not locate the bindings file`) and `db:push` created no tables. Those scaffolds now add `better-sqlite3` to the existing `trustedDependencies` list. Only that package is added: every entry lets a third-party package run code during install. npm ignores the field.
- **The email-change confirmation link is spent only by the user.** `src/settings/confirm-email/page.tsx` confirmed as soon as it opened, so a mail client or link scanner opening the link for a preview could use the one-shot token first. The page now waits for a confirm button (new locale keys `settings.emailChange.confirmPrompt` and `confirmButton` in all four languages), and no longer shows "Email updated" before anything was changed.

### Upgrading an existing project

1. With login: `npx luckystack update --app` brings the new `src/settings/confirm-email/page.tsx` and the locale files; a locale file you edited gets a `.new` sidecar — copy the two `settings.emailChange` keys from it.
2. Bun + SQLite: add `"better-sqlite3"` to `trustedDependencies` in `package.json` (package.json is never touched by `update`), then run `bun install`.

## [0.12.0] - 2026-10-15

### Changed

- **Scaffolds lint with ESLint 10.** `eslint` `^10.12.0` and `@eslint/js` `^10.0.1`. Two plugins that stopped at ESLint 9 are replaced: `eslint-plugin-jsx-a11y` by its maintained fork `eslint-plugin-jsx-a11y-x` (identical recommended set; rule ids become `jsx-a11y-x/…`), and `eslint-plugin-react`, which only supplied `react/jsx-no-literals`, by `luckystack/no-untranslated-jsx-text` from `@luckystack/core/eslint` with the same behaviour and allow-list.
- **`eslint-plugin-unicorn` 78 with the rule set it had before.** Between v64 and v78 its recommended preset grew from 137 to 338 rules; turning them all on meant thousands of new findings in an upgraded app, mostly naming and comment style. `eslint.official.config.js` lists the adopted rules (`ADOPTED_UNICORN_RULES`) and turns every other recommended rule off, so a rule unicorn adds later stays off until you add it. Four earlier rules that now flag many style-only sites (`prefer-ternary`, `prefer-simple-condition-first`, `prefer-default-parameters`, `prefer-logical-operator-over-ternary`) are left out; `no-unsafe-string-replacement` is added.
- **An `eslint-disable` that no longer suppresses anything is a lint error.** `eslint-plugin-eslint-comments` is removed: its `no-unused-disable` rule did nothing under flat config, and ESLint's own report was switched off, so dead disables were never caught. `linterOptions.reportUnusedDisableDirectives` is now `'error'`.
- `eslint-plugin-react-hooks` `^7.1.1` (5.x stopped at ESLint 9), pinned to the classic `rules-of-hooks` + `exhaustive-deps` pair: its 7.x `recommended` preset also enables the React-Compiler rules, which are a deliberate refactor rather than a dependency bump. `eslint-plugin-react-refresh` `^0.5.7`, `globals` `^17.13.0`.
- Requires Node.js 22.13 or newer (was 20.19). Node 20 stopped receiving security updates in April 2026, and ESLint 10 needs 22.13.

### Fixed

- **A mikro-orm scaffold type-checks without `@luckystack/secret-manager`.** `scripts/mikroOrmSchema.ts` imported the package and read `config.secretManager` unconditionally, so `npm run typecheck` (and `verify`) failed in every mikro-orm project that did not choose secret-manager. The block now ships commented out, like the one in `scripts/prismaWithSecrets.ts`; `--secret-manager` and `luckystack add secret-manager` switch it on.
- **A drizzle + SQLite scaffold no longer retypes browser code as Bun code.** `functions/db.ts` referenced all of `bun-types`, which declares Bun's globals for the whole program — `import.meta.hot` became always present, so the HMR guard in `MenuHandler` failed `@typescript-eslint/no-unnecessary-condition`. It now references only `bun-types/sqlite`, the declarations the Bun driver path needs.
- The scaffolder's prune edits insert their replacement code verbatim. It was passed to `String#replaceAll` as a string, so a `$'` or `$&` in it was read as a replacement pattern.

### Upgrading an existing project

1. Use Node.js 22.13 or newer.
2. `package.json` is never touched by `luckystack update`; edit the devDependencies by hand: `"eslint": "^10.12.0"`, `"@eslint/js": "^10.0.1"`, `"eslint-plugin-unicorn": "^78.0.0"`, `"eslint-plugin-jsx-a11y-x": "^0.2.0"`, `"eslint-plugin-react-hooks": "^7.1.1"`, `"eslint-plugin-react-refresh": "^0.5.7"`, `"eslint-plugin-react-x": "^5.27.1"`, `"eslint-plugin-import-x": "^4.17.1"`, `"globals": "^17.13.0"`; remove `eslint-plugin-jsx-a11y`, `eslint-plugin-react` and `eslint-plugin-eslint-comments`. If `npm install` then reports `ERESOLVE` over the `eslint@9` still recorded in the lockfile, run `npm install --force` once and confirm that a following `npm ci` succeeds without it.
3. `npx luckystack update` delivers `eslint.official.config.js`; an edited copy gets a `.new` sidecar to merge by hand.
4. Rename suppressions in your code: `react/jsx-no-literals` → `luckystack/no-untranslated-jsx-text`, `jsx-a11y/…` → `jsx-a11y-x/…`.
5. Run `npm run lint`. Disables that no longer apply now fail; `npx eslint . --fix --fix-type directive` removes them (keep any reason they carried as a normal comment). The template's own copies were cleaned the same way, and `npx luckystack update --app` brings them (`src/_sockets/socketInitializer.ts`, `src/_components/inputs/dateUtils.ts` and, with login, `reset-password/_api/sendReset_v1.ts`, `settings/_api/requestEmailChange_v1.ts` and `settings/confirm-email/page.tsx`). Then run `npm run verify`.

## [0.11.0] - 2026-10-14

### Changed

- **Scaffolds type-check with TypeScript 7 and run lint, typecheck and build in parallel.** `typescript` is now an alias of `@typescript/typescript6` (typescript-eslint and other compiler-API tools still need the JavaScript API, which TypeScript 7 no longer ships), and type-checking runs TypeScript 7 from `@typescript/native` (about ten times faster here). Scripts call it by path (`node node_modules/@typescript/native/bin/tsc`): the TypeScript 6 package also installs a `tsc` command, so the bare name depends on install order. `npm run verify` runs lint, `tsc --noEmit` and the build at once. The client build and the server bundle stay one after the other in both `build` and `verify`: `vite build` empties `dist/` when it writes, so a server bundle written beside it disappears. `scripts/threadBudget.mjs`, `withThreads.mjs` and `runParallel.mjs` keep every tool inside one budget — all cores, or `LUCKYSTACK_MAX_THREADS` — and cap ESLint's workers by memory, because each type-aware worker holds its own TypeScript program (~2 GB in a large project).
- **Route-type generation takes about half the time** (≈6 s → 3.3 s in the reference app; it runs before every build, typecheck and verify). `generateArtifacts` runs its two independent generators at once, and `scripts/generateTypeMaps.ts` formats the result with Prettier in the same process instead of `npx prettier`, which looked the package up on every run and used whatever version it found. `prettier` is now a devDependency; without it the generated file is left unformatted and still valid.
- `runParallel.mjs` no longer hands out more threads than the budget. Giving every task its one-thread minimum could overshoot on small machines (4 threads over weights 2/1/1/8 became 1/1/1/2).
- `npm run lint` uses at most 3 ESLint workers (`withThreads.mjs --max-threads 3`). Every type-aware worker builds the whole TypeScript program again, so more workers mostly repeat work: in the reference app 3 workers linted cold in 29 s with 124 CPU-seconds and 6.9 GB peak memory, 6 workers in 35 s with 239 CPU-seconds and 9.4 GB.
- `tsconfig.json` declares `"types": ["node"]` and the template depends on `@types/node`: TypeScript 6+ no longer loads every visible `@types/*` package by itself, so `process` and the other Node globals would be unknown.
- `eslint-plugin-react-x` moves from `^1.48.4` to `^5.26.5`: 1.x accepts only TypeScript 4.9–5.x as a peer, so npm refused to install a scaffold with the TypeScript 6 alias. Its `set-state-in-effect` rule flags the measure-before-paint `useLayoutEffect` in the dropdown and floating layer; both lines carry a justified suppression instead of a restructure that would show the menu unpositioned for a frame.
- New scaffolds and the npm documentation bundle deliver canonical `AGENTS.md` only, with fail-closed instruction/fence validation and regression coverage. Shared hooks no longer regenerate it from a vendor-specific file.
- Handwritten docs and workflow guidance focus on rationale and safety; new project READMEs no longer require prose pruning when auth/data-layer choices change. Framework identity, roadmap and findings ledgers do not become consumer context. Supported tool-specific permission settings remain unchanged.

### Fixed

- **Classes used only inside LuckyStack's own components reach the CSS.** Tailwind never scans `node_modules`, so a page guard's loading state (`animate-spin`, `border-t-primary`) and the presence indicator's corner classes were missing from a scaffold's stylesheet and rendered unstyled. `src/index.css` now adds `@source "../node_modules/@luckystack/*/dist/**/*.js"`.
- **An `allow-scripts` line in `~/.npmrc` no longer breaks the dependency install.** npm 11.19 passes it to `npx create-luckystack-app` as the variable `npm_config_allow_scripts`, and the `npm install` the scaffolder starts then rejected it as a command-line flag (`EALLOWSCRIPTS`), leaving the project without dependencies. The install now starts without that variable; npm still reads the setting from `.npmrc` itself.

### Upgrading an existing project

1. `package.json` is never touched by `luckystack update`; edit the devDependencies by hand: `"typescript": "npm:@typescript/typescript6@^6.0.2"`, `"@typescript/native": "npm:typescript@^7.0.2"`, `"@types/node": "^22.0.0"`, `"eslint-plugin-react-x": "^5.26.5"`, `"prettier": "^3.9.10"`, then reinstall. Keep `typescript-eslint` — its peer range stops below TypeScript 6.1, which the alias satisfies.
2. `npx luckystack update` delivers `scripts/threadBudget.mjs`, `withThreads.mjs` and `runParallel.mjs`. Adopt the `generateArtifacts`, `lint`, `typecheck`, `build` and `verify` scripts from the template by hand (replace a bare `tsc` with `node node_modules/@typescript/native/bin/tsc`): `lint` keeps your own globs and only gains the `node scripts/withThreads.mjs --mb-per-thread 2048 --max-threads 3` prefix and `--concurrency {threads}`.
3. `npx luckystack update --app` brings the app-owned files: `tsconfig.json` (`"types": ["node"]`), the `@source "../node_modules/@luckystack/*/dist/**/*.js";` line in `src/index.css` and the two lint suppressions in the dropdown and floating layer. A file you never edited is replaced; an edited one gets a `.new` sidecar to merge by hand. Add any other ambient type package the project relied on implicitly, remove `ignoreDeprecations` and `baseUrl` if present (TypeScript 7 rejects both), then run `npm run verify`.

## [0.10.2] - 2026-10-09

### Changed

- The scaffolded `scripts/testAll.ts` passes the generated `syncMetaMap` + `syncInputSchemas` to `runAllTests`, so the auto-sweep covers sync routes too, and documents `TEST_OUTPUT_FILE`. The results JSON is now written by `runAllTests` itself (see `@luckystack/test-runner`).

## [0.10.0] - 2026-09-03

### Fixed

- **The four scaffold locales carry every `sync.*` error code the framework can emit.** `sync.receiverNotAllowed` and `sync.notRoomMember` (403, both transports) were missing — a user saw the literal key on screen, because `translate()` renders a missing key as the key — and so were `invalidVersion`, `failedRequest`, `requestTimeout`, `disabled` and `devToolsUnavailable`. A test in `@luckystack/sync` now holds `nl`/`en`/`de`/`fr` in parity with the exported `SYNC_ERROR_CODES`, so the list cannot grow without the scaffold following.

## [0.9.1] - 2026-08-29

### Fixed

- `scripts/lintInvariants.mjs` honors a `// luckystack-allow <rule>: <reason>` on the comment line directly above the flagged code, not only at the end of the line itself. A reason worth writing rarely fits after the code, so that is where authors put it — and there it silently did nothing, leaving a deliberate, documented deviation reported as a violation forever. The suppression carries only from a line that is nothing but a `//` comment, so a trailing allow on an unrelated statement can never widen to the line below, and the preceding line is read from disk so a suppression written in an earlier commit still counts.
- The bundled framework docs a scaffold receives under `docs/luckystack/` no longer describe `npx luckystack update` as having only two per-file outcomes. A path listed in `.luckystackignore` gets nothing written — not even a `.new` sidecar — and stays out of the manifest so it cannot later re-plan as `unchanged` (ADR 0051). The same docs also stopped calling the generated AI-context artifacts "committed" (they are a gitignored cache since 0.9.0) and now name `@luckystack/cli` in the package tables it was missing from.

## [0.9.0] - 2026-08-28

### Fixed

- **`npx create-luckystack-app <name>` now actually scaffolds on macOS and Linux.** The CLI's entry-point guard compared `process.argv[1]` against `__filename` as raw strings. npm installs a bin as a symlink on POSIX, and node reports the symlink in `argv[1]` while resolving `import.meta.url` to its target, so the guard was permanently false: the command loaded the module, ran nothing, printed nothing and exited 0 — indistinguishable from success. Windows was unaffected (npm writes a `.cmd` shim passing the real path), which is why every local run was green while the Linux `e2e-scaffold` CI job had never once passed. Both sides are now realpath-resolved, and `cliEntry.test.ts` pins the symlink case.
- `scripts/checkRecordIds.mjs` reads frontmatter on a CRLF checkout. It split lines on `"\n"` and matched them with a `$`-anchored pattern, which a trailing `\r` makes unmatchable — so every field read as absent and the entire frontmatter half of the guard (name/slug, `id`, dangling `relates`/`supersedes`) was a no-op on Windows while it worked on CI. The `0000-template.md` placeholders are now exempt from the name/slug rule, since their frontmatter is instructions to the author rather than a claim about themselves; they still take part in the duplicate-number check.
- `AI_PROJECT_INDEX.md` and the dependency graph no longer drop root-level routes. `src/_api/session_v1.ts` and `logout_v1.ts` ship with every scaffold but required a page segment to be indexed, so `find_route` reported the session route as non-existent from day one.
- The dependency graph's symbol pass no longer skips itself. Its file cap counted every `.d.ts` pulled in from `node_modules`, so on any real project it silently emitted `symbols: 0` and `who_calls` always returned nothing.
- The graph now covers `server/`, `shared/`, `functions/`, `luckystack/` and `config.ts` (repo-relative ids, version 3), not just `src/`. A missing node reads as "nothing depends on this file", which was exactly wrong for the heaviest nodes in a project.
- The scaffold no longer copies the FRAMEWORK's own generated indexes, ADRs, lessons and dependency graph into `docs/luckystack/`. They described the framework repo and sat next to the project's identically-named files — including a `decisions/` folder that made an inherited eval scenario cite a real but unrelated ADR. The conventions (protocols, `ARCHITECTURE_*`, templates) still ship.

### Changed

- Generated AI-context artifacts are now gitignored and rebuilt by `npm run ai:refresh` (all generators in parallel) and by `postinstall --if-missing`. They are derived from the code, so a committed copy is the answer that drifts.
- The installed pre-commit hook regenerates no index and stages none. It runs checks (`checkRecordIds.mjs`, `lintInvariants.mjs`, plus the report-only nudges) and, as the one deliberate exception, still refreshes `AGENTS.md` — a committed convention file other tools read straight from the repo, not a queryable index. It used to regenerate eight artifacts and `git add` them, which made every commit slow and could stage an index derived from code that was not in the commit.
- The scaffolded `CLAUDE.md` drops the sections that only mean something inside the framework repo: the Project Snapshot (which described LuckyStack's own 16-package layout, i.e. the wrong project for a consumer's AI), Rule 7a about `packages/*` framework code, the `ai:changelog-check` bullet, and two doc-table rows for framework-only surfaces. Marked with `<!-- framework-only -->` fences in the source so the list lives next to the content instead of in a hand-kept array that would drift the moment a section moves; an unbalanced fence throws rather than silently truncating the contract. Saves ~443 tokens (3.5%) on a file that is read on every prompt — modest, because most of the contract genuinely applies to consumers too.

### Added

- `scripts/checkRecordIds.mjs` + `npm run ai:check-ids` — blocking guard on ADR/lesson number identity (duplicates, filename/frontmatter mismatch, dangling `relates`/`supersedes`/`@adr`). A duplicate number merges clean as two additions and silently repoints every reference.
- `scripts/aiRefresh.mjs` + `npm run ai:refresh` — one command that rebuilds every AI-context artifact, all generators in parallel.
- Template `page.tsx` files carry a `//? intent:` line, which now also surfaces as an Intent column in `AI_PROJECT_INDEX.md`'s Pages table, so `find_route` reaches a page's purpose without a second artifact.

## [0.8.7] - 2026-08-18

### Changed

- The scaffolded `server/server.ts` documents an `server.afterListen(...)` slot for work that runs once the server is listening, shipped as a commented example. Everything before `listen()` stays fatal — a failure there means there is no server — but a post-listen task that fails no longer reaches the `process.exit(1)` catch. The `[server] failed to start:` message is therefore always literally true. The example is commented rather than live because the scaffold lints with `strictTypeChecked` + `stylisticTypeChecked`, where an empty callback trips `require-await` or `no-empty-function` — a live placeholder would hand every new project a lint error.

## [0.8.6] - 2026-08-18

### Changed

- The AI record layers (branch-logs, decisions, lessons, findings) are now **batched to the end of a session** instead of written mid-flight, and sparring is an explicit write-free zone. The new "Session Capture Protocol" section in the scaffolded `CLAUDE.md` sets the bar per layer (an ADR needs an implemented-or-confirmed choice, a lesson needs a real burned dead-end, a findings-folder needs a REQUESTED scan) and the AI reports what it recorded in one closing line. Capture stays autonomous — the bar, not an approval prompt, is what keeps the record small. Fixes sessions that turned thinking-out-loud into permanent artifacts nobody asked for.
- Retired the canonical example corpus, the auto-generated runbooks, and the context-budget doc from scaffolded projects (`ai:examples` / `ai:runbooks` / `ai:context-budget` scripts, their generators, `docs/examples/`, and their pre-commit hook steps). They restated material already in `CLAUDE.md` and the architecture docs.
- Dropped Rule 15b (`@docs owner` on every new route) and the linter's owner requirement; the tag stays available as optional route metadata, and the project index no longer renders an aggregate ownership table.

### Fixed

- The scaffolded `CLAUDE.md` now points at `docs/luckystack/*` for framework documentation. Its in-body references were copied verbatim from the framework repo layout, so ~26 doc paths — including 8 in the session-start read sequence (Rule 28) — pointed at files that do not exist in a scaffolded project. Lines that deliberately spell out both paths (the Quick Links table) are left untouched.
- The scaffolded `CLAUDE.md` no longer instructs the AI to run `npm run ai:index`; that script regenerates the FRAMEWORK's cross-repo index and has never existed in a scaffolded project.
- The framework's own `docs/_archive/` and `docs/plans/` (retired one-offs and in-flight planning notes) no longer ride along in the npm tarball or land in a scaffolded project's `docs/luckystack/`.

## [0.8.5] - 2026-08-17

### Fixed

- The scaffolded `scripts/bundleServer.mjs` no longer bundles test files from `luckystack/<pkg>/` into the production server. It now asks `@luckystack/server`'s `collectOverlayEntries` what a folder contributes, so the bundle and the runtime overlay walk can no longer disagree (ADR 0047).
- The scaffolded `scripts/generateServerRequests.ts` emits the COMPLETE function registry into production maps. It previously scanned two hardcoded directories and ignored `paths.serverFunctionDirs`, so every module under `shared/` — including `shared/tryCatch.ts` and `shared/sleep.ts` — was absent from deployed builds and `functions.tryCatch.tryCatch(...)` / `functions.sleep.sleep(...)` threw at runtime while working in development. It also keyed modules on the bare filename, flattening `shared/rbac/engine.ts` to `functions.engine`; keys are now nested by directory, matching the dev loader and the generated `Functions` interface. Existing projects pick this up by upgrading and running `npm run generateArtifacts`.

## [0.8.4] - 2026-08-17

### Changed

- Scaffold config reads positional backend-port overrides from
  `@luckystack/core/config`; generated projects no longer read or require a
  backend listen-port environment variable. Edit `config.ports.ts` for the
  static default or pass `<preset> <port>` for one boot.
- Rebuilt the shipped CLI/scaffold/template-variable/framework-doc references around the current strict flag parser, ORM/package-manager matrix, rendered Docker assets, scaffold manifest, AI-context copy, and update flow. Generated Redis guidance now distinguishes the Redis-backed default from deliberate memory/custom-adapter alternatives.

### Fixed

- Scaffold OAuth callback documentation now points to the consumer-owned
  `config.ports.ts` backend (or explicit CLI port) instead of assuming port 80;
  `config.ports.ts` remains present in single-instance scaffolds without the
  optional router.
- Router-enabled scaffolds no longer emit obsolete `/csrf-token` custom-route ownership; the canonical `GET /auth/csrf` route is already covered by the `/auth` owner.

## [0.8.3] - 2026-07-27

### Fixed

- Fresh scaffolds register the generated API method map before exposing `apiRequest`, so routed HTTP preserves explicitly declared methods for routes whose names do not reveal GET/POST/PUT/DELETE semantics.

## [0.8.1] - 2026-07-27

### Fixed

- Fresh scaffolds keep named topology environments in production mode and inject Vite's build/serve runtime mode into browser config; custom profiles such as `--mode staging` no longer enable development behavior.

## [0.8.0] - 2026-07-27

### Added

- Fresh scaffolds now include provider-aware hardened Docker/Compose assets, preset-aware app/router startup, unprivileged nginx, private infrastructure and a seed-free Mongo replica initializer.
- Production bundles emit router topology ESM under `dist/router` when router config is present.

### Fixed

- Production images retain generated Prisma runtime artifacts instead of replacing them with an ungenerated production dependency tree.
- Fresh server bundles now register a type-safe, lint-clean translation-backed localized response normalizer.

## [0.7.5] - 2026-07-22

### Fixed

- Dropdown and multi-select portals now seed their width before their first
  layout measurement and stay anchored through rendered-size changes, scrolling,
  viewport changes and transform-driven layout movement. This prevents an
  incorrect first opening that appeared correct only after closing and reopening.

## [0.7.4] - 2026-07-22

### Added

- Scaffold env docs now include the rotatable TOTP keyring contract
  (`TOTP_ENCRYPTION_KEY` + JSON `TOTP_ENCRYPTION_LEGACY_KEYS`), and deploy config
  documents the router's fail-closed `trustedProxyCidrs` TLS boundary.

### Security

- Fresh scaffolds now use `sharp ^0.35.3`, which includes the fixed libvips
  builds for CVE-2026-33327, CVE-2026-33328, CVE-2026-35590 and CVE-2026-35591.

### Fixed

- The avatar route aliases Sharp's default import, keeping Sharp 0.35 builds
  warning-free.
- The scaffold Vite proxy now updates the original proxy options as well as
  Vite's per-request clone, so HTTP and direct WebSocket upgrades genuinely
  follow backend port changes after Vite has started. Stale advertisements from
  crashed processes now fall back to `ports.backend` instead of targeting a dead port.
- Scaffold test targeting now uses `@luckystack/test-runner`'s live-port resolver
  with `config.ports.backend` as fallback instead of hardcoding port 80.
- Scaffolded `scripts/testAll.ts` now lazily supplies the project config to the
  test runner, so `.env` pointers are resolved by optional secret-manager boot
  in the test process before Layer-5 tests touch Prisma or Redis.
- Scaffold typecheck coverage now includes TypeScript scripts and Vite port
  configuration, preventing malformed test entrypoints and proxy signatures from
  escaping release gates.

## [0.7.0] - 2026-07-16

### Fixed

- **Scaffolded security-tool floors are current.** Sentry scaffolds now install
  `@sentry/node ^10.66.0` (OpenTelemetry 2.9 fixes GHSA-8988-4f7v-96qf), and
  the template pins `tsx ^4.23.1` so fresh installs resolve fixed esbuild 0.28.1.
- **The required sync client is no longer both statically and dynamically
  imported.** Socket initialization now calls the existing static re-export,
  eliminating an ineffective code-split point and its production-build warning.
- **Server-side Vitest imports now keep the real `@luckystack/core` barrel.**
  The scaffold's Vite config still globally aliased the bare barrel to
  `@luckystack/core/client`, even though shared config has moved to the dedicated
  browser-safe `/config` entry. Vitest inherited that stale alias and turned
  server-only exports such as `tryCatchSync` into `undefined` at runtime. The
  obsolete alias is removed; regression guards require browser code to use
  explicit `/client` or `/config` entries instead.
- **Drizzle + SQLite now performs real queries on Node and Bun.** Node keeps
  `better-sqlite3`; Bun selects Drizzle's `bun:sqlite` adapter at module load via
  dynamic imports, because Bun rejects the native `better-sqlite3` addon
  (oven-sh/bun#4290). The SQLite scaffold adds `bun-types` for the adapter's
  declarations, and the production bundler leaves `bun:sqlite` external so the
  same bundle boots on Node and Bun while retaining one `functions.db.db` API.
- **`--auth=none` scaffolds work after the complete-config factory change.** The
  exact-token prune still targeted the old two-space auth block and lacked the
  factory's `as const`, so every no-auth scaffold aborted and removed its partial
  directory. A full-template prune regression now pins the current shape.
- **New Drizzle scaffolds now require `drizzle-orm ^0.45.2`.** This is the first
  release that fixes identifier-escaping SQL injection advisory
  [GHSA-gpj5-g38j-94v9](https://github.com/advisories/GHSA-gpj5-g38j-94v9);
  the previously scaffolded `^0.44.0` range was vulnerable.
- **Late secret resolution now refreshes the complete project registration.**
  The scaffold previously re-registered only `http.cors.allowedOrigins`; because
  `registerProjectConfig` is last-write-wins over pristine defaults, that silently
  reset auth, session, rate-limit, logging, and URL policy. The listener now
  rebuilds the full registration and recomputes `PUBLIC_URL`, CORS, and OAuth
  callback values together.
- **`bun run server` now genuinely runs Bun instead of silently running Node.**
  On Windows there is no shebang: npm generates a `.cmd` bin shim
  (`node_modules/.bin/luckystack-dev.cmd`) that hardcodes a `node` call, so
  `bun run server` launched **Node** while every log line looked green — the
  "LuckyStack runs on both runtimes" claim was technically true and completely
  hollow. `@luckystack/devkit`'s supervisor now resolves the child's runtime from
  the fingerprints Bun leaves even when it hands off to Node
  (`npm_config_user_agent` starts with `bun/`, `npm_execpath` points at the real
  `bun.exe`) and re-execs the server child through that bun binary. Measured on
  bun 1.3.14 / Windows x64:
  - `npm run server` → Node + tsx (unchanged).
  - `bun run server` → Bun, tsx dropped (Bun compiles TypeScript natively, and
    `--tsconfig` is not a Bun flag).
  - `bun --bun run server` → Bun (already Bun; spawns `process.execPath`).
  - bun launch detected but the bun binary unresolvable → **exits 1 loudly**; it
    never silently falls back to Node.

  The supervisor now also names the runtime it spawned
  (`[Supervisor] Started server process (pid: …, runtime: bun)`), because a green
  boot log is exactly what made the old trap invisible. Verified end-to-end on a
  scaffolded project: Redis connected, Socket.io initialized, `/livez` → `200`,
  `/_health` → `{"status":"ok",…}` with `typeof Bun === 'object'` in-process.

  Bun backends are production-supported. Optional-package detection now keeps
  `import.meta.resolve` bound and works on Node and Bun. The separate
  `@luckystack/router` process must currently run on Node because Bun's
  `node:http` upgrade sockets cannot proxy WebSockets (oven-sh/bun#28396); the
  router probes that capability and fails loudly instead of black-holing sockets.

### Added

- **Package-manager choice — `--pm=<npm|bun>`** (new wizard step + CLI flag, default
  `npm`). Picks the tool used for the post-scaffold install. **npm + bun only** —
  pnpm/yarn are deliberately not offered and `--pm=pnpm` exits 2. Existing behaviour is
  unchanged when the flag is omitted: `--no-prompt` still scaffolds an npm project
  byte-for-byte.
  - `--pm=bun` records `"packageManager": "bun@1.3.3"` in the rendered `package.json`,
    which is what `@luckystack/cli`'s `detectPackageManager` reads — so every later
    `luckystack add` / `remove` / `manage` install uses bun too (it works even under
    `--no-install`, before any `bun.lock` exists).
  - The choice is recorded in `.luckystack/scaffold.json` so `luckystack update`
    re-renders with it.
  - Requires bun already on your `PATH`; if it isn't found the scaffold skips the install
    and prints a `bun install` hint instead of failing.
- The scaffold `package.json` now declares a `bun` engine range (`>=1.3.3`) alongside
  `node`. Bun 1.3.3 is the first release that honors the shipped `bunfig.toml`
  `env = false`; npm projects are unaffected.

### Changed

- The scaffold docs copy now strips the framework's OWN dated finding-sets
  (`docs/findings/<YYYY-MM-DD>-*/`) — a consumer keeps only the convention
  (`docs/luckystack/findings/README.md` + `FINDINGS_PROTOCOL.md`) and its own
  `docs/findings/`. See the Findings & Dated-Docs Protocol.

### Fixed

- **`ai:lint` `i18n-jsx` false positive on TS generics** (template `scripts/lintInvariants.mjs`):
  return-type / cast fragments on a line with generics (`): Promise<void>`, `x as Promise<T>`)
  are no longer reported as hardcoded JSX text. Mirrors the repo-root copy.

### Changed

- **Scaffold `tsconfig` target/lib bumped to ES2023** (`tsconfig.json` + `tsconfig.server.json`).
  Node 20+ (the scaffold requirement) supports ES2023, so consumer code can use `toSorted` /
  `toReversed` / `findLast` following framework idioms without a manual bump.

### Added

- **`@luckystack/cron` is now a wizard opt-in** (`--cron` flag + a prompt step;
  off by default). Previously cron was only addable post-scaffold via
  `luckystack add cron`. It is a dependency-only add that self-wires at boot via
  `@luckystack/cron/register` (byte-identical to `luckystack add cron` — no
  template file, no `server.ts` edit); register jobs in `luckystack/cron/*.ts`.
  The recorded `cron` choice round-trips through `luckystack update` and manage.

### Fixed

- **mikro-orm `db:schema:update` now works on Node 22 / Windows.** It ran the
  `@mikro-orm/cli` (`schema:update --run`), whose `figlet` banner dependency
  crashes on Node 22 / Windows and which never resolves `@luckystack/secret-manager`
  pointers. It now runs the MikroORM `SchemaGenerator` via the API in
  `scripts/mikroOrmSchema.ts` (loads env + resolves secret-manager pointers
  first, mirroring `scripts/prismaWithSecrets.ts`). `@mikro-orm/cli` +
  the `mikro-orm` config-discovery key are dropped from the scaffold.
- **mikro-orm packages are pinned to one EXACT version** (`@mikro-orm/core` +
  the driver, `6.6.14`). MikroORM refuses to init on a core/driver version
  mismatch, and caret ranges let them drift to different patches (e.g. core
  6.6.15 vs the lagging better-sqlite 6.6.14) → a hard crash at `MikroORM.init`.

## [0.6.0] - 2026-07-12

### Added

- **Email-code login + 2FA surface in the template** (ADR 0024): LoginForm is
  now a phase state machine (credentials / email-code / 2FA challenge) with a
  passwordless entry point that only renders when the server advertises
  `emailCodeLogin`; the settings page gains a two-factor management section
  (enroll via authenticator app, recovery codes, disable) talking to the
  adapter-based framework routes; `config.ts` ships commented
  `emailCodeLogin` / `twoFactor: 'optional'` options; `.env.local_template`
  documents `TOTP_ENCRYPTION_KEY`; the Prisma `User` model gains the optional
  `twoFactorEnabled` / `totpSecret` / `recoveryCodes` columns; 50 new
  `login.*` + `settings.twoFactor*` locale keys across en/nl/de/fr.

## [0.5.1] - 2026-07-11

### Added

- **Auth is selectable on drizzle/mikro-orm** (ADR 0023): the wizard shows the
  auth step again for TS-first ORMs. The scaffold keeps the adapter-based
  login/register/reset-password flows and writes a per-ORM starter
  `luckystack/login/userAdapter.ts` (finish its 2 documented steps to activate
  sign-in; auto-imported at boot via the login overlay slot). Only `--orm=none`
  still forces `--auth=none` — an explicit `--orm=none --auth=<mode>` combo
  exits 2.

### Changed

- A non-Prisma auth scaffold prunes ONLY the Prisma-bound surface so it stays
  buildable on first try: `src/settings` (its 6 `_api` routes call
  `functions.db.prisma`) and `server/hooks/notifications.ts`
  (`getPrismaClient()`), plus their wiring/README/Home.tsx mentions. The
  next-steps checklist tells you what to finish before sign-in works.

## [0.5.0] - 2026-07-11

### Added

- **Scaffold manifest** (`.luckystack/scaffold.json`, ADR 0021): every scaffold
  records its version, resolved choices, and per-file sha256 hashes — the
  baseline `npx luckystack update` diffs against.
- **ORM dimension** (`--orm=<prisma|drizzle|mikro-orm|none>`, ADR 0020):
  drizzle (TypeScript-first, SQL-only — MongoDB filtered/rejected) and
  mikro-orm (TypeScript-first incl. first-class MongoDB, EntitySchema-based)
  ship per-dialect starters under `server/db/` + a live `functions/db.ts`
  client + db scripts; `none` leaves bring-your-own hooks. Every non-prisma
  value forces `--auth=none` (the built-in UserAdapter is Prisma-backed).

### Changed

- `scripts/bundleServer.mjs` (template) imports the overlay walk order from
  `@luckystack/server` at build time (parity-tested fallback) so the prod
  bundle can never drift from the dev overlay walk.

## [0.1.5]

### Fixed

- **AI dev-instructions scaffold option now actually works.** The framework AI
  docs (`CLAUDE.md`, `docs/`, `skills/`, `.claude/commands`, `branch-logs/README.md`)
  were copied from the monorepo root, which is absent in a published install — so
  selecting "include AI instructions" silently copied nothing. They are now
  bundled into the package at build time (`framework-docs/`) and copied from there.
- **OAuth multi-select toggle on Windows + clearer confirm flow.** The spacebar
  now toggles a provider whether the console reports it as `key.name === 'space'`
  or only as the raw `' '` string (some Windows consoles do the latter). Both
  Space AND Enter now toggle the highlighted provider, and a dedicated **"Next"**
  row at the bottom of the list confirms the step (Space/Enter on it continues) —
  so Enter can't accidentally confirm before you've finished selecting.
- **Credentials login no longer shows a false "success" when a session already
  exists.** Re-submitting the login form while signed in trips the CSRF guard,
  which replies with `{ status: 'error' }` — a truthy string the form misread as
  success (empty green toast + bounce to /login). The form now treats only a
  literal `status === true` as success and surfaces `errorCode`. The underlying
  CSRF block on the credentials bootstrap endpoint is lifted in `@luckystack/server`
  0.1.5, so re-login / register while signed in now just works (no false success,
  no `csrfMismatch`).
- **OAuth origins untangled — `DNS` removed.** The single `DNS` env var conflated
  two different origins: the **backend** origin (where the `/auth/callback`
  redirect_uri must point — that's a backend route) and the **public** origin
  (where users browse / land / receive email links). In dev these are different
  ports (backend :80, Vite :5173), so `DNS` could only ever be right for one,
  causing `redirect_uri_mismatch`. `config.ts` now derives the **backend origin**
  from `SERVER_IP`/`SERVER_PORT` (OAuth redirect_uri → register
  `http://localhost:80/auth/callback/<provider>` in dev) and a **public origin**
  (`app.publicUrl`, dev `http://localhost:5173`, prod `PUBLIC_URL`) for landings,
  email, and CORS. A new root `/` page routes visitors to the dashboard (or login)
  instead of falling through to the catch-all error page. `DNS` is gone from the
  env template and `@luckystack/core`'s env schema.
- **Dashboard (and other unstyled pages) are readable.** `index.css` carried the
  leftover Vite default of white text on a white background; the `:root` defaults
  now derive from the theme tokens (and adapt to dark mode).
- **OAuth provider logos now ship.** The login form's `/<provider>.png` images were
  never included in the scaffold. They are now bundled under `template/public/`
  (google, github, discord, facebook, plus extras you can delete).

## [0.1.0]

### Added

- Initial public release as part of the LuckyStack package split.
