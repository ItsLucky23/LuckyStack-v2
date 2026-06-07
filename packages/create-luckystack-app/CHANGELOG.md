# Changelog

All notable changes to `create-luckystack-app` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
