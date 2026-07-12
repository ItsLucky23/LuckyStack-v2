# Changelog

All notable changes to `@luckystack/cli` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
