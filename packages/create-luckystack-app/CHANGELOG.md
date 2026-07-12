# Changelog

All notable changes to `create-luckystack-app` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
