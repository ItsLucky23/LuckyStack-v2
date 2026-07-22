# Changelog

All notable changes to `create-luckystack-app` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.4] - 2026-07-22

### Added

- Scaffold env docs now include the rotatable TOTP keyring contract
  (`TOTP_ENCRYPTION_KEY` + JSON `TOTP_ENCRYPTION_LEGACY_KEYS`), and deploy config
  documents the router's fail-closed `trustedProxyCidrs` TLS boundary.

### Security

- Fresh scaffolds now use `sharp ^0.35.3`, which includes the fixed libvips
  builds for CVE-2026-33327, CVE-2026-33328, CVE-2026-35590 and CVE-2026-35591.

### Fixed

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
