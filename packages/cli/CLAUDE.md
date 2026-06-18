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
  checkbox wizard, pre-checked for installed packages; on confirm it diffs the selection and
  runs the add path for newly-checked + remove path for unchecked, then ONE `npm install`.
- `luckystack check-env` / `luckystack check-i18n` — codebase audits that write AI-feedable,
  per-run hashed logs to `dump/<KIND>_<hash>.log` (dead/missing env keys + i18n keys).

## When to USE

- A consumer scaffolded a base/partial project and now wants `login`, `presence`, `sync`,
  `email`, `error-tracking`, or `docs-ui`.

## When to NOT suggest

- Brand-new project from scratch — use `create-luckystack-app`.
- Anything outside the known feature list (the `src/registry.ts` REGISTRY).

## Function Index

| Export / file | One-liner |
|---|---|
| `src/index.ts` (bin entry) | Parse `list` / `manage` / `add` / `remove` / `check-*`, locate the project, dispatch. |
| `src/registry.ts` | `REGISTRY` — the single typed source of truth for CLI-manageable optional packages (`id`, `pkg`, `kind`, `description`, `removable`, `note`). `add`/`list`/`manage`/`remove` all derive from it; mirror against server `OPTIONAL_PACKAGES`. |
| `commands/list.ts` | `list` — read-only: registry packages `installed (vRANGE)` vs `available` + core/other @luckystack deps. `installedRegistryIds` (pure). |
| `commands/manage.ts` | `manage` — `computeManagePlan` (PURE diff of installed vs selected) + `applyManagePlan` (run adds/removes, then ONE install). |
| `commands/remove.ts` | `removeFeature` — inverse of add by kind: backend = drop dep; presence = drop dep + reverse JSX (mirror of `prunePresence`); login = GUARDED (drop dep, keep files, warn). |
| `lib/wizard.ts` | `runCheckbox` — ZERO-dep readline-keypress multi-select (↑/↓ · space · enter · ctrl-c). `isInteractive` non-TTY guard. |
| `commands/addLogin.ts` | Copy auth UI assets into `src/` (skip-if-exists) + add `@luckystack/login` + install. |
| `commands/addPresence.ts` | Re-add `@luckystack/presence` + inject `<LocationProvider/>` / `<SocketStatusIndicator/>` (inverse of the pruner) + install. |
| `commands/addBackendOnly.ts` | Generic handler for `sync` / `email` / `error-tracking` / `docs-ui`: add dep + install (they self-wire at boot). |
| `commands/checkEnv.ts` | `check-env` — A: unused `.env` keys; B: env vars used but undefined. DEV_-aware; framework-key ignore list; env files via `getEnvFiles()` semantics (`LUCKYSTACK_ENV_FILES` else `.env`,`.env.local`). |
| `commands/checkI18n.ts` | `check-i18n` — C: unused locale keys; D: used keys missing per-language. Used-set = literal `{ key: '...' }` + `errorCode: '...'` (dotted) harvested repo-wide; dynamic `key:<var>` sites listed for review. |
| `lib/scan.ts` | Shared regex scanner: `collectSourceFiles` (skips node_modules/dist/tests/generated), `matchAll` (capture+line), `groupLocations`, `writeDumpLog` (`dump/<KIND>_<hash>.log`). |
| `lib/project.ts` | `findProjectRoot` (consumer dep OR framework `packages/core`), `addDependency` / `dropDependency`, `hasDependency` / `dependencyRange`, `editFile` (CRLF-safe), `copyDirIfAbsent` (idempotent), `assetPath`, `runNpmInstall`. |
| `assets/login/src/**` | The shipped auth UI bundle copied by `add login` (login/register/reset-password/settings pages + `_api` + `LoginForm`). |

## Notes

- All file edits normalize CRLF→LF before matching (Windows). Edits throw on a missing
  token so template drift surfaces loudly. Copies skip existing files (consumer owns them).
- The feature registry lives in `src/registry.ts` (`REGISTRY` — single source of truth;
  `index.ts` dispatch + `list`/`manage`/`remove` all derive from it). Mirror it against
  `OPTIONAL_PACKAGES` in `@luckystack/server` when adding a new optional package — the
  `assetParity.test.ts` parity test enforces this.

## Peer dependencies

None. Uses only Node built-ins (`fs`, `path`, `child_process`, `module`, `url`).
