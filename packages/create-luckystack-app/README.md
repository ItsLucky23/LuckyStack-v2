# create-luckystack-app

Scaffold a new [LuckyStack](https://github.com/ItsLucky23/LuckyStack-v2) project.

## Prerequisites

- Node.js 20+
- npm or Bun on `PATH` (the scaffold defaults to npm)
- Redis and a database only when the selected project features require them

## Usage

```bash
npx create-luckystack-app my-app
cd my-app

# Create tracked non-secret config + local secrets:
cp .env_template .env
cp .env.local_template .env.local
$EDITOR .env.local

# Two terminals:
npm run server
npm run client
```

Open <http://localhost:5173>.

## What it generates

A starter project pre-configured with:

- The `luckystack/` overlay folder for per-package configuration and adapters.
- The selected ORM/data-layer setup: Prisma, Drizzle, MikroORM, or `none`.
- `config.ts`, a single-source `config.ports.ts`, and the server/client bootstrap.
- `.env_template` + `.env.local_template` documenting the environment contract.
- A working `server/server.ts` that calls `bootstrapLuckyStack`.
- A minimal Vite + React 19 frontend with proxy rules for framework endpoints.
- The framework AI context when `aiInstructions` is enabled: `CLAUDE.md`, `docs/luckystack/`, `skills/`,
  `.claude/commands/`, and the AI-index pre-commit hook.

Router topology files (`services.config.ts`, `deploy.config.ts`, and
`server/config/presetLoader.ts`) are optional. They are included only when `--router` is selected or
later added with `npx luckystack add router`.

## Important options

| Flag | Description |
|---|---|
| `--orm=<prisma|drizzle|mikro-orm|none>` | Select the data layer. Default: Prisma. |
| `--db=<mongodb|postgresql|mysql|sqlite>` | Select the database provider, subject to the selected ORM. |
| `--pm=<npm|bun>` | Select the package manager for installation. Default: npm. |
| `--auth=<none|credentials|credentials+oauth>` | Select authentication. Default: none. |
| `--oauth=<providers>` | Comma-separated OAuth providers when auth supports OAuth. |
| `--email=<none|console|resend|smtp>` | Select the email adapter. |
| `--monitoring=<none|sentry|datadog|posthog>` | Select the monitoring backend. |
| `--presence` / `--error-tracking` / `--docs-ui` / `--secret-manager` / `--router` / `--cron` | Opt into an optional package. |
| `--ai-docs` / `--no-ai-docs` | Include or omit the framework AI context. Default: included. |
| `--ai-browser=<all|agent-browser|none>` | Select optional browser-testing tooling. |
| `--no-install` | Skip dependency installation and ORM generation. |
| `--no-prompt` | Skip the wizard and use the defaults. |
| `--help`, `-h` | Show help. |

## Updating an existing project

This CLI is for fresh directories. For an existing LuckyStack project, upgrade the installed
`@luckystack/*` packages and run:

```bash
npx luckystack update
```

That command refreshes framework-owned copied files while preserving user edits through `.new` sidecars.

## Related architecture docs

- [`docs/DEVELOPER_GUIDE.md`](https://github.com/ItsLucky23/LuckyStack-v2/blob/main/docs/DEVELOPER_GUIDE.md) — full walkthrough after scaffolding.
- [`docs/ARCHITECTURE_PACKAGING.md`](https://github.com/ItsLucky23/LuckyStack-v2/blob/main/docs/ARCHITECTURE_PACKAGING.md) — package boundaries, overlays, generated artifacts, and bundle selection.

## License

MIT — see the [repository LICENSE](https://github.com/ItsLucky23/LuckyStack-v2/blob/main/LICENSE).
