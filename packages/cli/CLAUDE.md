# @luckystack/cli

> AI summary + function INDEX. For deep specs see the repo `docs/` + `SESSION_STATE.md`.

## What this package does

The `luckystack` CLI (`bin: luckystack`). Commands:
- `luckystack add <feature>` — INVERSE of `create-luckystack-app`'s `pruneOptionalPackages`:
  installs an optional `@luckystack/*` package AND injects the consumer-`src/` assets a plain
  `npm i` cannot (Vite can't statically import an uninstalled package; file-based routing only
  scans `src/`). Backend-only features (self-wiring via `./register`, or the sync client bridge)
  just get the dependency line + `npm install`.
- `luckystack check-env` / `luckystack check-i18n` — codebase audits that write AI-feedable,
  per-run hashed logs to `dump/<KIND>_<hash>.log` (dead/missing env keys + i18n keys).

## When to USE

- A consumer scaffolded a base/partial project and now wants `login`, `presence`, `sync`,
  `email`, `error-tracking`, or `docs-ui`.

## When to NOT suggest

- Brand-new project from scratch — use `create-luckystack-app`.
- Removing a feature — that is the scaffold pruner's job (a future `luckystack remove`).
- Anything outside the known feature list.

## Function Index

| Export / file | One-liner |
|---|---|
| `src/index.ts` (bin entry) | Parse `add <feature> [--no-install]`, locate the project, dispatch. |
| `commands/addLogin.ts` | Copy auth UI assets into `src/` (skip-if-exists) + add `@luckystack/login` + install. |
| `commands/addPresence.ts` | Re-add `@luckystack/presence` + inject `<LocationProvider/>` / `<SocketStatusIndicator/>` (inverse of the pruner) + install. |
| `commands/addBackendOnly.ts` | Generic handler for `sync` / `email` / `error-tracking` / `docs-ui`: add dep + install (they self-wire at boot). |
| `commands/checkEnv.ts` | `check-env` — A: unused `.env` keys; B: env vars used but undefined. DEV_-aware; framework-key ignore list; env files via `getEnvFiles()` semantics (`LUCKYSTACK_ENV_FILES` else `.env`,`.env.local`). |
| `commands/checkI18n.ts` | `check-i18n` — C: unused locale keys; D: used keys missing per-language. Used-set = literal `{ key: '...' }` + `errorCode: '...'` (dotted) harvested repo-wide; dynamic `key:<var>` sites listed for review. |
| `lib/scan.ts` | Shared regex scanner: `collectSourceFiles` (skips node_modules/dist/tests/generated), `matchAll` (capture+line), `groupLocations`, `writeDumpLog` (`dump/<KIND>_<hash>.log`). |
| `lib/project.ts` | `findProjectRoot` (consumer dep OR framework `packages/core`), `addDependency`, `editFile` (CRLF-safe), `copyDirIfAbsent` (idempotent), `assetPath`, `runNpmInstall`. |
| `assets/login/src/**` | The shipped auth UI bundle copied by `add login` (login/register/reset-password/settings pages + `_api` + `LoginForm`). |

## Notes

- All file edits normalize CRLF→LF before matching (Windows). Edits throw on a missing
  token so template drift surfaces loudly. Copies skip existing files (consumer owns them).
- The feature registry lives in `src/index.ts` (`FEATURES`). Mirror it against
  `OPTIONAL_PACKAGES` in `@luckystack/server` when adding a new optional package.

## Peer dependencies

None. Uses only Node built-ins (`fs`, `path`, `child_process`, `module`, `url`).
