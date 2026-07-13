# @luckystack/cli

> AI summary + function INDEX. For deep specs see the repo `docs/` + `SESSION_STATE.md`.

## What this package does

The `luckystack` CLI (`bin: luckystack`). Commands:
- `luckystack add <feature>` — INVERSE of `create-luckystack-app`'s `pruneOptionalPackages`:
  installs an optional `@luckystack/*` package AND injects the consumer-`src/` assets a plain
  `npm i` cannot (Vite can't statically import an uninstalled package; file-based routing only
  scans `src/`). Backend-only features (self-wiring via `./register`, or the sync client bridge)
  just get the dependency line + `npm install`.
- `luckystack remove <feature>` — inverse of `add`: drops the dep + reverses any JSX injection
  (presence). `login` removal is GUARDED (drops the dep but KEEPS the copied, user-owned auth
  UI + warns which files to delete by hand).
- `luckystack list` — read-only inventory: every manageable optional package as
  `installed (vRANGE)` vs `available` + a "core/other @luckystack" section.
- `luckystack manage` (also bare `add` / `remove` with no feature) — interactive ZERO-dep
  STEP-based reconfiguration wizard (ADR 0014): detects current state, opens a step per
  setting (auth mode + OAuth providers, email, monitoring, presence, sync, docs-ui), shows a
  per-change consequence preview, then applies (`commands/reconfigure.ts` + `transitions.ts`),
  then ONE `npm install`. Env edits are value-safe (key-presence only; `.env.local` placeholders
  appended on add, a filled block never deleted). **ORM-aware (ADR 0020)**: the wizard header +
  `list` print the detected data layer; on a non-Prisma layer the Auth row is annotated and the
  enable-auth preview warns that a custom UserAdapter is required (a per-ORM starter is
  generated on apply). The **ORM is itself a wizard step** (row 0): any ORM → any ORM via
  `commands/switchOrm.ts` (fresh-render based, like `update`) — `planOrm` runs FIRST in
  `planChanges` and orm-sensitive steps read the DESIRED orm, so switching the data layer and
  enabling auth in one pass interplay correctly (same model as sentry↔posthog monitoring swaps).
- `luckystack update` — refresh the FRAMEWORK-OWNED files the scaffold copied into the
  project (docs/luckystack, CLAUDE.md, skills, .claude/commands, generator scripts, shared
  eslint configs, `.luckystack/templates`) from the current framework version (ADR 0021
  phase 1a). Renders a fresh scaffold into a temp dir via
  `npx create-luckystack-app@<cli version>` with the choices RECORDED in
  `.luckystack/scaffold.json`, then per file: hash == manifest baseline → pristine →
  replaced; hash differs → user-modified → `<file>.new` sidecar + AI-merge report in
  `dump/UPDATE_<hash>.log` — user edits are NEVER overwritten. No manifest (pre-0.4.1
  scaffold) → sidecar-only mode. Never touches src/, functions/, config, prisma, .env*.
  Also: warns when the cli version ≠ the installed `@luckystack/core` version (the
  re-render happens at the CLI's version), and the report lists safe-surface files the
  new framework version NO LONGER SHIPS (left in place — delete manually). After every
  `add`/`remove`/`manage` apply, `lib/manifestSync.ts` re-derives the manifest's
  recorded `choices` from the detected project state so update never replays stale ones.
- `luckystack update --app` (ADR 0025) — the SAME command with a broadened scope: it
  ALSO refreshes framework-AUTHORED files under the app tree (`src/` UI + routes,
  `functions/`, `server/`, `luckystack/`, `config.ts`, `tsconfig`). This is the
  upgrade path for files that must land in `src/` after a feature release (e.g. the
  2FA `LoginForm` + `TwoFactorSection` in 0.6.0) — `npm install` can't deliver src/
  files and framework-scope update won't. Safety = two invariants: only files in the
  FRESH RENDER are considered (your own app code is never touched), and a file you
  edited gets a `<file>.new` sidecar + AI-merge note (never overwritten). A short
  deny-list still guards `prisma/`, `.env`/`.env.local`, `package.json`, and the
  manifest even in app scope. `isUpdatablePath(rel, scope)` is the predicate; `--app`
  → scope `'app'`, default `'framework'`. The report gains "new files delivered" +
  "refreshed" sections.
- `luckystack check-env` / `luckystack check-i18n` — codebase audits that write AI-feedable,
  per-run hashed logs to `dump/<KIND>_<hash>.log` (dead/missing env keys + i18n keys).

## When to USE

- A consumer scaffolded a base/partial project and now wants `login`, `presence`, `sync`,
  `email`, `cron`, `error-tracking`, or `docs-ui`.

## When to NOT suggest

- Brand-new project from scratch — use `create-luckystack-app`.
- Anything outside the known feature list (the `src/registry.ts` REGISTRY).

## Function Index

| Export / file | One-liner |
|---|---|
| `src/index.ts` (bin entry) | Parse `list` / `manage` / `add` / `remove` / `check-*`, locate the project, dispatch. |
| `src/registry.ts` | `REGISTRY` — the single typed source of truth for CLI-manageable optional packages (`id`, `pkg`, `kind`, `description`, `removable`, `note`). `add`/`list`/`manage`/`remove` all derive from it; mirror against server `OPTIONAL_PACKAGES`. |
| `commands/list.ts` | `list` — read-only: registry packages `installed (vRANGE)` vs `available` + core/other @luckystack deps. `installedRegistryIds` (pure). |
| `commands/reconfigure.ts` | `runReconfigureWizard` — the interactive STEP wizard for `manage`: detect state (`lib/state.ts`) → edit per-setting (row 0 = ORM/data layer, then auth/email/monitoring + toggles) → preview (`transitions.ts` `planChanges`) → confirm → apply → one install. |
| `commands/manage.ts` | Single-feature plan helpers used by `add <feature>` / `remove <feature>`: `computeManagePlan` (PURE diff, test-only) + `applyManagePlan` (run the plan, then ONE install). NOT the interactive wizard (that's reconfigure.ts). |
| `commands/switchOrm.ts` | `switchOrm(project, {from,to,dbProvider,cliVersion})` — the bidirectional data-layer switch (ADR 0020): renders a fresh scaffold with the TARGET orm (via `renderScaffoldToTemp`, the update-command seam — single source of truth for file content + dep VERSIONS), swaps package.json deps/scripts/keys per the `ORM_SURFACES` name tables, replaces the active shims (`functions/db.ts`, `luckystack/core/clients.ts`) with a `.orm-<from>.bak` backup, copies starters copy-if-absent, edits the config.ts `User` type BOTH ways (prisma import ↔ the render's placeholder block — never leaves a non-compiling half-state), writes a per-ORM UserAdapter starter when login is installed, updates manifest `choices.orm`/`dbProvider`, and NEVER deletes old-orm leftovers (reports them). Tokens/dep-names parity-tested against the scaffolder exports (`switchOrm.test.ts`). |
| `transitions.ts` | `planChanges(current, desired)` → granular `Change[]` each with a consequence preview + `apply`. `configFromState`, `TOGGLE_IDS`. The reconfigure engine. |
| `lib/state.ts` / `lib/envKeys.ts` / `lib/envFile.ts` | `detectProjectState` (authMode/oauth/email/monitoring/**orm**/packages from deps + env KEY names + the scaffold manifest) · `deriveOrm`/`readScaffoldOrm` — the DATA-LAYER detector (`'prisma' \| 'drizzle' \| 'mikro-orm' \| 'none'`; manifest `choices.orm` wins, else dep inference) that every orm-sensitive CLI path reads instead of assuming Prisma (ADR 0020) · `deriveDbProvider`/`readPrismaSchemaProvider` — the db detector (manifest `choices.dbProvider` wins, else the `prisma/schema.prisma` provider, else `postgresql`) · value-blind env-key reader (`.env.local` then `.env`) · value-safe env-block add/remove + EXTERNAL_ORIGINS edits. |
| `featureOptions.ts` | Reconfigurable option lists (authMode/oauth/email/monitoring) + provider→env-key/origin/dep maps. Mirrors the scaffolder's PROVIDER_OPTIONS (parity-tested). |
| `commands/remove.ts` | `removeFeature` — inverse of add by kind: backend = drop dep; presence = reverse JSX; login = GUARDED (keep files, warn); error-tracking = drop dep + delete `functions/sentry.ts`; secret-manager = re-comment blocks; router = drop dep + script + delete the topology config files (`services.config.ts` / `deploy.config.ts` / `server/config/presetLoader.ts`) + un-wire their two `server.ts` imports; ai-docs = drop mcp + `.mcp.json` entry. |
| `commands/addDispatch.ts` | `runAddByKind` — single source of truth mapping a `FeatureKind` to its add handler (used by `add <feature>`, manage, and reconfigure toggles; exhaustive). |
| `lib/wizard.ts` | `runSingleSelect` (radio) + `runCheckbox` (multi) — ZERO-dep readline-keypress prompts (↑/↓ · space/enter · ctrl-c), non-TTY + empty guards. |
| `commands/addLogin.ts` | Copy the auth bundle (UI + `functions/session.ts` + `server/hooks/notifications.ts`) into the project + add `@luckystack/login` + restore config.ts auth flags + register notification hooks (best-effort). **ORM-aware (ADR 0020/0023)**: on a non-Prisma data layer it writes a per-ORM starter `luckystack/login/userAdapter.ts` (drizzle/mikro-orm: commented-complete, byte-identical to the scaffolder's `USER_ADAPTER_STARTERS` — parity-tested; none: TODO skeleton — skip-if-exists) and WITHDRAWS the Prisma-bound files it just copied (`PRISMA_BOUND_SETTINGS_ROUTES` + notifications.ts; never a pre-existing consumer file) so the project keeps compiling; the hooks-wiring edit is prisma-only. `AUTH_SERVER_HOOKS` / `AUTH_NONE_SERVER_PLACEHOLDER` exported for the reverse. |
| `commands/addPresence.ts` | Re-add `@luckystack/presence` + inject `<LocationProvider/>` / `<SocketStatusIndicator/>` (inverse of the pruner) + install. |
| `commands/addDocsUi.ts` | Add `@luckystack/docs-ui` + copy the React API explorer into `src/docs/page.tsx`. Removal deletes the page. |
| `commands/addErrorTracking.ts` | Add `@luckystack/error-tracking` + copy the `functions/sentry.ts` shim. `copySentryShim` / `removeSentryShim` shared with planMonitoring. |
| `commands/addSecretManager.ts` | Add `@luckystack/secret-manager` + uncomment the config.ts + server/server.ts blocks (mirror of `wireSecretManager`); `removeSecretManager` re-comments. |
| `commands/addRouter.ts` | Add `@luckystack/router` + the `router` npm script AND copy the topology config files (`services.config.ts` + `deploy.config.ts` + `server/config/presetLoader.ts`) from `assets/router/` (idempotent) + wire their two `server.ts` side-effect imports (`import '../deploy.config';` / `import '../services.config';` after `import '../config';`). `removeRouter` drops the dep + script, un-wires those imports, and deletes the three config files. These files are NOT in a base install — `pruneRouter` strips them from a no-router scaffold; this is the inverse. |
| `commands/addAiDocs.ts` | Add `@luckystack/mcp` (devDep) + register the graph server in `.mcp.json`; `removeAiDocs` reverses. (The doc tree is NOT bundled — re-scaffold for that.) |
| `commands/addBackendOnly.ts` | Generic handler for `sync` / `email`: add dep + install (self-wire at boot). |
| `commands/update.ts` | `update` — framework-owned-files refresh (ADR 0021 phase 1a). Exports the pure pieces for tests/tooling: `readScaffoldManifest`, `choicesToFlags` (recorded choices → scaffolder flags), `isSafeSurfacePath` (the bucket-(a) allow-list), `planUpdate` (add/overwrite/sidecar/unchanged classification), `applyUpdate` (writes + manifest refresh + dump/ report), `runUpdate` (orchestrator; `renderFreshScaffold` injectable — default runs `npx create-luckystack-app@<version>` into a temp dir with the Windows-safe cmd /s /c quoting). Hash logic mirrors the scaffolder's `scaffoldManifest.ts` (sha256, CRLF→LF for text) — verified by a cross-scaffold check. |
| `commands/checkEnv.ts` | `check-env` — A: unused `.env` keys; B: env vars used but undefined. DEV_-aware; framework-key ignore list; env files via `getEnvFiles()` semantics (`LUCKYSTACK_ENV_FILES` else `.env`,`.env.local`). |
| `commands/checkI18n.ts` | `check-i18n` — C: unused locale keys; D: used keys missing per-language. Used-set = literal `{ key: '...' }` + `errorCode: '...'` (dotted) harvested repo-wide; dynamic `key:<var>` sites listed for review. |
| `lib/scan.ts` | Shared regex scanner: `collectSourceFiles` (skips node_modules/dist/tests/generated), `matchAll` (capture+line), `groupLocations`, `writeDumpLog` (`dump/<KIND>_<hash>.log`). |
| `lib/project.ts` | `findProjectRoot` (consumer dep OR framework `packages/core`), `addDependency` / `dropDependency`, `hasDependency` / `dependencyRange`, `editFile` (CRLF-safe), `copyDirIfAbsent` (idempotent), `assetPath`, `runNpmInstall`. |
| `assets/login/src/**` | The shipped auth UI bundle copied by `add login` (login/register/reset-password/settings pages + `_api` + `LoginForm`). |
| `assets/docs-ui/src/**` | The React API-explorer page (`src/docs/page.tsx`) copied by `add docs-ui`. |
| `assets/router/**` | The router topology config files (`services.config.ts` + `deploy.config.ts` + `server/config/presetLoader.ts`) copied by `add router` (the inverse of the scaffold's `pruneRouter`). |

## Notes

- All file edits normalize CRLF→LF before matching (Windows). Edits throw on a missing
  token so template drift surfaces loudly. Copies skip existing files (consumer owns them).
- The feature registry lives in `src/registry.ts` (`REGISTRY` — single source of truth;
  `index.ts` dispatch + `list`/`manage`/`remove` all derive from it). Mirror it against
  `OPTIONAL_PACKAGES` in `@luckystack/server` when adding a new optional package — the
  `assetParity.test.ts` parity test enforces this.
- The `assetParity.test.ts` parity check now also covers `router`: the files under
  `assets/router/**` (copied by `add router`) must match the scaffold template's router
  config files (the ones `pruneRouter` strips when router is OFF), so the add-asset and
  template copies can't drift.

## Peer dependencies

None. Uses only Node built-ins (`fs`, `path`, `child_process`, `module`, `url`).
