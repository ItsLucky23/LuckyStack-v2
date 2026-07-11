# Changelog

All notable changes to `@luckystack/cli` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
