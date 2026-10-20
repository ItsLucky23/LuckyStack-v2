# Changelog

All notable changes to `@luckystack/cli` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.16.0] - 2026-10-20

### Changed

- **Breaking:** the drizzle and mikro-orm starter `luckystack/login/userAdapter.ts` that `add login` and the ORM switch write adds the `providerAccountId` column (drizzle: a unique index, mikro-orm: an index on `provider` + `providerAccountId`), stores it on `create` and implements `findByProviderAccountId`, which `@luckystack/login` 0.16 uses to bind OAuth accounts to the provider's user id (ADR 0086). The `orm: 'none'` starter lists the new method. Upgrade: see step 2 below.
- **`add login` warns when `prisma/schema.prisma` has no `providerAccountId`**, because OAuth logins fail until the column exists. Upgrade: see step 1 below.

### Fixed

- **The drizzle and mikro-orm starter `luckystack/login/userAdapter.ts` typechecks once uncommented.** The drizzle `update` no longer passes `null` to NOT NULL columns, and the mikro-orm `create` sets `createdAt` and `theme`. The drizzle starter notes that MySQL needs `varchar` for the indexed `provider` and `provider_account_id` columns.

### Upgrading a project scaffolded before 0.16

These steps are also in the `create-luckystack-app` 0.16.0 changelog, which a project never installs.

1. **Prisma:** add `providerAccountId String?` and `@@index([provider, providerAccountId])` to `model User` in `prisma/schema.prisma`, then run `npm run prisma:db:push` (or `npm run prisma:migrate:dev`) and `npm run prisma:generate`. `update` never overwrites an edited schema, so do this by hand. Until the column exists, OAuth logins fail; credentials logins keep working. Existing Google, GitHub, Discord and Facebook users bind on their next login. Do this in a project without auth too: `npx luckystack add login` relies on the column and does not add it.
2. **drizzle or mikro-orm with auth:** your `luckystack/login/userAdapter.ts` is your own file. Add the `providerAccountId` column and index to your user table or entity (on MySQL as `varchar`, because TEXT cannot be indexed), pass `providerAccountId` through in `create` and `update` (login binds an existing account with `update`), and add `findByProviderAccountId` (copy it from a fresh scaffold). Without it login keeps email matching, warns once on the first OAuth login, and refuses an unverified provider email on an existing account.

## [0.15.0] - 2026-10-19

### Changed

- **Breaking:** `manage` → Auth: none deletes only auth files that are still exactly as the framework shipped them (ADR 0081). Files you added to `src/login`, `src/register`, `src/reset-password` or `src/settings`, and auth files you edited, are kept and listed in the preview and the result. A kept file that still uses `@luckystack/login` or `functions.session` is marked, because it stops compiling. Upgrade: port or delete each marked file.
- **Breaking:** `remove router` keeps `deploy.config.ts`, `services.config.ts` and `server/config/presetLoader.ts` when you edited them, and lists them (ADR 0081). If you edited the preset loader, the two config files it imports are kept as well. Upgrade: delete the listed files yourself once you no longer need them.
- **Breaking:** `add docker` takes the database from `.luckystack/scaffold.json`, then `prisma/schema.prisma`, and fails when it cannot work out the database instead of falling back to MongoDB. It no longer builds a MongoDB stack for drizzle, mikro-orm and `orm: 'none'` SQL projects. Upgrade: when it fails, run `npx luckystack add docker --db=<mongodb|postgresql|mysql|sqlite>`.

### Fixed

- **`luckystack update` no longer fails with a misleading network error on an `orm: 'none'` project that later added login.** The re-render leaves auth out for `orm: 'none'`, as the scaffolder does. A failed render now says why: the scaffolder rejected the choices, `npx` is missing, or there is a network or registry problem.
- **`luckystack update` records the new hash for files that already match the new framework version.** A file you merged from a `.new` sidecar is then overwritten cleanly on the next release instead of getting another sidecar.
- **`luckystack update --app` no longer adds a file that imports a package the project does not have.** A project with a monitoring backend but without `@luckystack/error-tracking` got `functions/sentry.ts`, which broke dev boot and typecheck. The file is now held back, and the command and report say to run `npx luckystack add error-tracking`.
- **`luckystack update` hashes `Dockerfile`, `.yaml`/`.yml`, `.sh` and `.conf` files the way the scaffolder does.** Unedited Docker and CI files on a CRLF checkout (Windows, `core.autocrlf`) no longer count as edited.
- **`manage` → Auth: none also deletes `src/_api/logout_v1.ts`**, which calls the removed session shim and broke the build. `add login` now delivers it too, so add and remove match.
- **`manage` → Auth: none also removes the `/login` guard from the generators for new pages** (`.luckystack/templates/page_dashboard.template.tsx` and `scripts/scaffoldPage.mjs`), as an `--auth=none` scaffold does. New admin, dashboard and settings pages no longer redirect to the missing `/login`. A generator you edited is left alone and named in the preview and the result. `add login` and `manage` → Auth: credentials put the guard back, so new pages of a project that started with `--auth=none` require login again; an edited generator is named instead.
- **`add login` lists the locale keys the copied auth pages use and your English locale lacks** (for 0.15 `settings.emailChange.managedByProvider` and `session.notFound`), instead of always naming the two 0.12.1 confirm-email keys. Without `src/_locales/en.json` it points to `npx luckystack check-i18n`.
- **`add presence` / `remove presence` no longer leave `main.tsx` changed when `TemplateProvider.tsx` cannot be edited.** A second run no longer reports success with the UI half-wired, and it completes a project an older version left half-wired.
- **`check-i18n` no longer lists keys the installed `@luckystack/*` packages use** (such as `api.invalidName` and `auth.required`) as unused. The report also warns that framework codes, and keys for features you have not added yet, never show up in a search of your own code.
- **The cron description in `add`, `list` and `--help` no longer promises exactly-once execution.** It says normally one instance runs each job, so handlers must be idempotent (safe to run twice).
- **`luckystack add router` writes a `services.config.ts` that declares `settings` and `reset-password`**, so their routes reach the production bundle, and a `deploy.config.ts` whose `docker` environment binds them to the app.
- **`luckystack add router` writes a working `router` script** (the router CLI through tsx with `--deploy ./deploy.config.ts --services ./services.config.ts`), the same one the scaffolder writes. The old `luckystack-router` script always exited 2.
- **`luckystack add docker` adds `.env.docker` to `.gitignore`** (and creates `.gitignore` when it is missing) unless a line already covers it. That file holds the remote database and Redis passwords.
- **The login assets carry the scaffold's 0.15.0 login fixes:** OAuth accounts can no longer change their email (Settings shows it read-only and the server refuses the change when it is requested and when it is confirmed); changing to a common password, or one longer than 72 bytes, shows the policy message instead of a server error; a password reset, a password change or a confirmed email change cancels the other kind of pending link; the reset-password and confirm-email pages remove the token from the URL after reading it; an email-change request answers the same way whether or not the address is taken; saving settings or preferences no longer brings back a session that was signed out meanwhile.

### Upgrading a project scaffolded before 0.15

These steps are also in the `create-luckystack-app` 0.15.0 changelog, which a project never installs.

1. `npx luckystack update` brings the new `scripts/scaffoldPage.mjs`, `scripts/routeServices.ts` and `scripts/generateServerRequests.ts` to every project; without the router the build checks nothing extra. Change `template = 'dashboard'` to `'home'` in pages that `scaffold:page` created earlier. With the router, the build then lists every route folder that is not declared: add each one to `services.config.ts` (for example `myFolder: { source: 'myFolder' }`) and to one preset; with login this includes `settings` and `reset-password`. Then bind each new service in every `deploy.config.ts` environment that binds `system`, to the backend that runs its preset (in the `default` preset the same URL as `system`, for example `settings: 'http://app:4100'`). Without a binding the router answers `serviceNotAssigned` for that service's routes. An edited `services.config.ts` or `deploy.config.ts` only gets a `.new` sidecar, so make these changes by hand.
2. `npx luckystack update --app` brings the changed `src/` files: the `plain` template (`src/_components/templates/Plain.tsx`, `TemplateProvider.tsx`), `src/_providers/SessionProvider.tsx`, `src/main.tsx` (token-mode OAuth reads `#token=`), the locale files (`sync.disconnected`, `settings.emailChange.managedByProvider`, `session.notFound`) and, with login, the reset-password and settings pages and routes. It also brings the corrected CI file. A file you edited gets a `.new` sidecar to merge by hand.
3. `package.json` is never touched by `update`. With the router, set the `router` script to `tsx --tsconfig tsconfig.server.json node_modules/@luckystack/router/dist/cli.js --deploy ./deploy.config.ts --services ./services.config.ts`.
4. Add `.env.docker`, `.env.*.local`, `*.db`, `*.db-journal`, `*.db-wal` and `*.db-shm` to `.gitignore`. If `.env.docker` or a `.db` file is already committed, run `git rm --cached` on it and change the credentials it held.
5. If the project has a monitoring backend (`sentry`, `datadog` or `posthog`) but not `@luckystack/error-tracking`, run `npx luckystack add error-tracking`. That package is what sends errors to the backend; until it is installed, `update --app` does not deliver `functions/sentry.ts`.

## [0.14.0] - 2026-10-16

### Fixed

- **`luckystack upgrade` lists this changelog.** The package did not ship it, so the upgrade plan never showed it. The consumer steps for 0.12 and 0.12.1 were published only in the `create-luckystack-app` changelog, which a project never installs, so they never reached the plan either; they are repeated below. Without them, `luckystack update` writes the 0.12 ESLint config and `npm run lint` fails on a missing plugin.
- **`luckystack add login` names the locale keys the email-change confirmation page needs.** The page uses `settings.emailChange.confirmPrompt` and `settings.emailChange.confirmButton`; a project scaffolded before 0.12.1 lacks them and shows the raw keys. The command now says so and points to `npx luckystack check-i18n`.
- **Switching email to SMTP or Resend adds the transport package.** `luckystack manage` added `@luckystack/email` and the env placeholders but not `nodemailer` or `resend`, so the server stopped at startup asking to install it. It now adds `nodemailer` `^10.0.0` or `resend` `^6.0.0` (the ranges a new scaffold gets), removes the previous adapter's package when switching away, and lists both in the preview.
- **`luckystack remove login` no longer reports hand-edited README sections on an untouched README.** It looked for login paragraphs that current READMEs no longer have and counted each as hand-edited. Only a paragraph that is still recognisable but was changed is reported now.

### Upgrading a project scaffolded before 0.12

From `create-luckystack-app` 0.12.0:

1. Use Node.js 22.13 or newer.
2. `package.json` is never touched by `luckystack update`; edit the devDependencies by hand: `"eslint": "^10.12.0"`, `"@eslint/js": "^10.0.1"`, `"eslint-plugin-unicorn": "^78.0.0"`, `"eslint-plugin-jsx-a11y-x": "^0.2.0"`, `"eslint-plugin-react-hooks": "^7.1.1"`, `"eslint-plugin-react-refresh": "^0.5.7"`, `"eslint-plugin-react-x": "^5.27.1"`, `"eslint-plugin-import-x": "^4.17.1"`, `"globals": "^17.13.0"`; remove `eslint-plugin-jsx-a11y`, `eslint-plugin-react` and `eslint-plugin-eslint-comments`. If `npm install` then reports `ERESOLVE` over the `eslint@9` still recorded in the lockfile, run `npm install --force` once and confirm that a following `npm ci` succeeds without it.
3. `npx luckystack update` delivers `eslint.official.config.js`; an edited copy gets a `.new` sidecar to merge by hand.
4. Rename suppressions in your code: `react/jsx-no-literals` → `luckystack/no-untranslated-jsx-text`, `jsx-a11y/…` → `jsx-a11y-x/…`.
5. Run `npm run lint`. Disables that no longer apply now fail; `npx eslint . --fix --fix-type directive` removes them (keep any reason they carried as a normal comment). `npx luckystack update --app` brings the template's own cleaned copies. Then run `npm run verify`.

From `create-luckystack-app` 0.12.1:

6. With login: `npx luckystack update --app` brings the new `src/settings/confirm-email/page.tsx` and the locale files; a locale file you edited gets a `.new` sidecar — copy the two `settings.emailChange` keys from it.
7. Bun + SQLite: add `"better-sqlite3"` to `trustedDependencies` in `package.json`, then run `bun install`.

## [0.12.1] - 2026-10-15

### Fixed

- **The login assets' email-change confirmation waits for a click.** `src/settings/confirm-email/page.tsx` called the confirm API as soon as it opened, so a mail client or link scanner that opens links for a preview could spend the one-shot token before the user clicked, leaving them with an "invalid link" error. It now shows a confirm button, as the reference app already did. The page uses `settings.emailChange.confirmPrompt` and `settings.emailChange.confirmButton`; a project without them shows the raw key until they are added (they ship in the scaffold's locales from `create-luckystack-app` 0.12.1).
- `luckystack switch-orm` to drizzle or mikro-orm on SQLite adds `better-sqlite3` to `trustedDependencies` (from the fresh render) and switching away removes only that entry, so a Bun-installed project builds the driver's native binding. Your own `trustedDependencies` entries are kept.

## [0.12.0] - 2026-10-15

### Changed

- Requires Node.js 22.13 or newer (was 20). Node 20 stopped receiving security updates in April 2026, and the scaffold's lint toolchain (ESLint 10) needs 22.13.

### Fixed

- **Code that `luckystack add`, `switch-orm` and the Docker assets inject arrives verbatim.** The injected text was passed to `String#replace` as a string, so a `$'`, `$&` or `$1` inside it (for example `const currency = '$';`) was read as a replacement pattern and spliced other parts of the file into the result. The replacement is now a function, which inserts the text as-is.
- `luckystack add secret-manager` / `remove secret-manager` also switch the secret-resolution block in a mikro-orm project's `scripts/mikroOrmSchema.ts`, which now ships commented out (see `create-luckystack-app` 0.12.0).
- The login assets no longer carry two `import-x/default` suppressions a consumer's `esModuleInterop` makes unnecessary (they fail lint under `reportUnusedDisableDirectives`), and the email-confirmation page sets its no-token error state on first render instead of from an effect (`react-x/set-state-in-effect`).

## [0.11.0] - 2026-10-14

### Changed

- Package and consumer instructions use `AGENTS.md`. Updates preserve customized legacy `CLAUDE.md` and propose its manual retirement instead of deleting it. Handwritten docs emphasize rationale, ownership and operational safety.

### Fixed

- The dependency install started by `npx luckystack` no longer fails with `EALLOWSCRIPTS` when `~/.npmrc` contains `allow-scripts`: npm 11.19 passes that setting on as `npm_config_allow_scripts`, which the child install rejected as a command-line flag. The install starts without the variable; npm reads the setting from `.npmrc` itself.

## [0.9.0] - 2026-08-28

### Changed

- `add login` / `add docs-ui` page assets carry a `//? intent:` line, matching the scaffold template (asset ↔ template parity).

### Added

- `luckystack update` now honours a `.luckystackignore` file at the project root:
  a `.gitignore`-shaped list of scaffold paths this project refuses. Ignored paths
  get nothing written — no file, no `.new` sidecar — stay out of the scaffold
  manifest, and are listed in the update report under "Skipped — this project
  opted out". Until now the only way to refuse a scaffold file was to delete it,
  which does not stick: a file missing locally plans as `add`, so the next update
  delivers it again. This matters most when a project solves the same job under a
  DIFFERENT name, because then nothing collides and no sidecar warns you — the
  case that prompted it was a project with its own `compose.yml` receiving the
  scaffold's `compose.yaml`, which Docker Compose silently prefers.

## [0.8.6] - 2026-08-18

### Added

- `luckystack update` now writes a `<file>.removed` marker next to every framework-owned file the new version no longer ships, and the `dump/UPDATE_<hash>.log` report gained a matching AI cleanup instruction. Previously these files were listed in the report only, so an agent applying the report merged the `.new` sidecars and silently left the retired files behind. Nothing is ever deleted — not by the update and not by the agent applying its report. The marker and the instruction both state what to check (does an npm script, the pre-commit hook, or another module still reference it?) and then require the findings to go to the developer in one batch with a per-file recommendation, waiting for a decision; deleting files is not an autonomous action. An ignored marker is re-created by the next update; once the file is gone, the flagging stops. Deliberately a distinct extension rather than a `.new`: the report instructs merging a `.new` INTO its file, which would destroy a file if the sidecar held a removal notice instead of replacement content.

## [0.8.4] - 2026-08-17

### Fixed

- `luckystack check-env` no longer treats removed `SERVER_PORT` as part of the framework environment contract; backend ports come from config/options or the typed positional override registry.
- `luckystack add router` assets no longer add obsolete `/csrf-token` ownership; `/auth` covers the canonical `/auth/csrf` endpoint.

## [0.8.1] - 2026-07-27

### Fixed

- Added-login overlay hooks use runtime mode rather than deploy-topology identity for development-only logging.

## [0.8.0] - 2026-07-27

### Added

- `luckystack add docker` renders provider/router-aware production-like Docker assets copy-if-absent; `luckystack docker check` validates assets and transport wiring without exposing secrets.
- `luckystack add router` now switches invocation to routed HTTP/SSE; removal restores socket invocation.

## [0.7.4] - 2026-07-22

### Fixed

- The login asset aliases Sharp's default import, keeping Sharp 0.35 scaffold
  bundles warning-free.
- The router feature asset now carries the same fail-closed
  `trustedProxyCidrs` deploy-config contract as a fresh scaffold.
- A `luckystack manage` pass that switched ORM and changed another feature no
  longer lets the later transition serialize the stale pre-switch package.json
  over the new ORM dependencies/scripts. `switchOrm` now updates the shared
  in-memory project snapshot immediately after its disk write.
- `luckystack update` now normalizes the temp project name exactly like the
  scaffolder and allowlists every manifest-derived flag value before invoking
  `npx.cmd`. Windows project paths with spaces no longer point at the wrong temp
  directory, and hand-edited cmd metacharacters cannot reach the shell.

## [0.7.0] - 2026-07-16

### Added

- **`detectPackageManager(root, pkg)` is now exported** from `lib/project.ts`. No behaviour
  change — it already resolved `bun` from a `packageManager: "bun@…"` field or a
  `bun.lockb` / `bun.lock`, which is exactly what `create-luckystack-app --pm=bun` now
  writes, so `add` / `remove` / `manage` installs pick bun up with no further wiring. The
  export exists so a cross-package parity test can pin that seam (the scaffolder is
  zero-dep and cannot import this package at runtime). pnpm/yarn stay recognised here for
  a consumer who switches by hand, even though the scaffold wizard offers npm + bun only.

- **`luckystack upgrade [<target>]`** — READ-ONLY command that gathers the upgrade plan
  (installed `@luckystack/core` version, every installed `@luckystack/*` + its CHANGELOG
  path, scaffold-manifest presence, the full step sequence + gotchas) into
  `dump/UPGRADE_PLAN.md`, so an AI executes a deterministic plan instead of reconstructing
  it from prose. Mutates nothing. A self-contained upgrade runbook also ships in this
  package's `CLAUDE.md`, readable from `node_modules` even when a project's own docs predate
  the tooling.
- **`luckystack update --app`** (ADR 0025) — broadens `update` to also refresh
  framework-authored files under the app tree (`src/` UI + routes, `functions/`,
  `server/`, `luckystack/`, `config.ts`, `tsconfig`), closing the upgrade gap for
  files that must live in `src/` after a feature release (e.g. the 2FA UI in
  0.6.0). New framework files are delivered; files you edited get a `<file>.new`
  sidecar + AI-merge note (never overwritten); your own app code + `prisma/` +
  secrets + `package.json` are never touched. Default scope stays `framework`.

### Fixed

- Sentry feature installs now require `@sentry/node ^10.66.0`, pulling the
  OpenTelemetry 2.9 line that fixes GHSA-8988-4f7v-96qf.
- ORM switching now removes/adds the Drizzle SQLite `bun-types` declaration
  dependency together with the rest of the selected driver surface.
- ORM switcher (`manage` → data layer) mirrors the mikro-orm scaffold fix:
  switching to mikro-orm no longer adds `@mikro-orm/cli` / the `mikro-orm`
  config key and ships `scripts/mikroOrmSchema.ts` (the API-based
  `db:schema:update` that works on Node 22 / Windows).

## [0.6.0] - 2026-07-12

### Added

- The `add login` asset bundle ships the new auth UI (ADR 0024): the
  phase-based LoginForm (email-code login + 2FA challenge views) and the
  settings `TwoFactorSection` (enroll/recovery/disable on the framework
  routes). Copy-if-absent as always — existing consumer files are never
  overwritten.

## [0.5.1] - 2026-07-11

### Added

- **Bidirectional ORM switch** in the `manage` wizard (ADR 0020): "ORM / data
  layer" is now step 0 — switch any ORM to any ORM (prisma/drizzle/mikro-orm/
  none). Fresh-render based like `update` (file content + dependency versions
  come from a temp `create-luckystack-app` render): swaps package.json
  deps/scripts, replaces the active shims (`functions/db.ts`,
  `luckystack/core/clients.ts`) with `.orm-<from>.bak` backups, copies starters
  copy-if-absent, edits the config.ts `User` type both ways, writes the per-ORM
  UserAdapter starter when login is installed, updates the scaffold manifest,
  and never deletes old-ORM leftovers (reports them).
- ORM-aware detection everywhere: `deriveOrm`/`deriveDbProvider` (manifest
  choices win, else dependency inference) drive `manage`, `list`, `add login`
  and the transition previews — nothing assumes Prisma anymore. `planOrm` runs
  FIRST in `planChanges` and auth reads the DESIRED orm, so switching the data
  layer and enabling auth in one pass interplay correctly.

### Changed

- `add login` on a non-Prisma data layer no longer copies the Prisma-bound
  files (the 6 `settings/_api/*` routes + `server/hooks/notifications.ts`) —
  previously they were copied with a "port these" warning and broke the
  consumer's typecheck (ADR 0023). The per-ORM starter UserAdapter is still
  written; the notification-hooks wiring is prisma-only.
- Switching a login-enabled project away from prisma now names concretely
  which existing Prisma-bound auth files will stop compiling.

## [0.5.0] - 2026-07-11

### Added

- **`luckystack update`** (ADR 0021): refreshes the framework-owned files a
  scaffold copied into the project (docs/luckystack, CLAUDE.md, skills,
  .claude/commands, generator scripts, shared eslint configs, route
  templates). Pristine files (hash matches the `.luckystack/scaffold.json`
  baseline) are replaced; user-modified files get a `<file>.new` sidecar +
  an AI-merge report in `dump/UPDATE_<hash>.log` — user edits are never
  overwritten. Warns on cli↔installed-core version mismatch; reports
  safe-surface files the new framework version no longer ships.
- `cron` feature (`luckystack add cron` + manage-wizard toggle) — installs
  `@luckystack/cron`; register jobs in `luckystack/cron/*.ts`.
- Scaffold-manifest choice sync: after every `add`/`remove`/`manage` apply,
  the manifest's recorded choices are re-derived from the detected project
  state so `update` never replays stale choices.
- `add login` warns loudly when the project has no Prisma data layer
  (orm: none/drizzle/mikro-orm) — the built-in UserAdapter is Prisma-backed;
  the warning spells out the custom-UserAdapter route.
