# @luckystack/cli

The LuckyStack project CLI. Run it inside an existing LuckyStack project to add
optional features after the initial scaffold:

```bash
npx luckystack add <feature> [--no-install]
```

## Features

| Feature | What it does |
|---|---|
| `login` | Installs `@luckystack/login` (auth backend self-wires from env at boot) **and** copies the editable `/login`, `/register`, `/reset-password`, `/settings/**` pages + their `_api` handlers + `LoginForm` into your `src/`. The pages are file-routed — no router edits. Copies are skip-if-exists so re-running never overwrites your customizations. |
| `presence` | Installs `@luckystack/presence` and injects the client mounts a plain `npm i` can't: `<LocationProvider/>` (router root in `main.tsx`) and `<SocketStatusIndicator/>` (`TemplateProvider.tsx`). The inverse of the scaffold's `--no-presence` pruner. |
| `sync` | Installs `@luckystack/sync`. The client receive bridge attaches automatically (already wired in `socketInitializer.ts`). |
| `email` | Installs `@luckystack/email` (Resend / SMTP / console — env-driven). |
| `error-tracking` | Installs `@luckystack/error-tracking` (Sentry / PostHog — env-driven). |
| `docs-ui` | Installs `@luckystack/docs-ui` — API docs page auto-mounts at `/_docs` in dev. |

## Project audits (AI-feedable)

```bash
npx luckystack check-env     # unused .env keys + env vars used-but-undefined
npx luckystack check-i18n    # unused translation keys + used-but-missing-from-locales
```

Each command scans the project and writes structured logs to a `dump/` folder in
the project root (created if absent), one file per run with a random hash suffix
(e.g. `dump/MISSING_ENV_a7b8c9d0.log`) so earlier runs are never overwritten. The
logs are formatted to feed straight to an LLM, and the CLI prints a pointer line:
`Look in dump/<file> and resolve all <missing|unused> keys.`

| Command | Finds |
|---|---|
| `check-env` | **A.** `.env` keys (from the files `getEnvFiles()` loads — `.env`, `.env.local`, or `LUCKYSTACK_ENV_FILES`) referenced nowhere in code. **B.** `process.env.X` / `env('X')` references with no matching `.env` definition. DEV_-prefix aware; framework keys (Redis/Prisma/OAuth/`VITE_*`/`TEST_*`) are excluded. |
| `check-i18n` | **C.** translation keys in `*/_locales/*.json` referenced nowhere in code. **D.** keys used in code (incl. server `errorCode` strings used as `notify.error({ key })`) missing from one or more locale files — reported per language. Dynamic `key: <variable>` call sites are listed for manual review. |

> Run inside a single project (`src/` tree). Tests (`*.test.ts`) are skipped.

## Why this exists

`@luckystack/cli` is the inverse of `create-luckystack-app`'s optional-package
pruner. Backend-only features self-wire on a bare `npm i` (via each package's
`./register` subpath, auto-imported by `@luckystack/server`'s boot phase), so for
those `add` is just the dependency + `npm install`. But two things a plain
`npm i` can **not** do are what this CLI handles:

1. **Vite can't statically import an uninstalled package** — so the presence
   client mounts are injected as source, not imported from an absent dep.
2. **File-based routing only scans `src/`** — so the login pages are copied into
   your project (where you own and edit them), not served from `node_modules`.

## Flags

- `--no-install` — patch files + `package.json` but skip `npm install`.
- `-h`, `--help` — usage.
