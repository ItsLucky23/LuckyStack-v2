# Changelog

All notable changes to `@luckystack/cli` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
