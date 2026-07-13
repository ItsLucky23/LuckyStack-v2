# CLI Flags

Complete reference for the command-line interface exposed by `create-luckystack-app`. All flags are parsed by `parseArgs(argv)` (src/index.ts); the human-readable help banner is produced by `printHelp()`.

## Invocation shape

```
npx create-luckystack-app <project-name> [options]
```

There is exactly one positional argument (the project name) and a set of recognised flag tokens. Order of flags is irrelevant. Flags come in two shapes:

- **bare toggles** — e.g. `--no-install`, `--presence`, `--router`.
- **`--key=value` choice flags** — e.g. `--db=postgresql`, `--auth=credentials+oauth`. The value is everything after the `=`; an invalid value exits with code 2.

## Flags

| Flag | Default | Effect |
| --- | --- | --- |
| `<project-name>` (positional, required) | — | First non-flag token captured. Slugified for the directory name and `{{PROJECT_NAME}}`, Title-Cased for `{{PROJECT_TITLE}}`. Must not already exist. |
| `--no-install` | install runs | Skip `runNpmInstall(targetDir)` and `runPrismaGenerate(targetDir)`. Files are still copied; the consumer runs `npm install` + `npx prisma generate` later. |
| `--no-prompt` | prompts run | Skip `runPrompts()` and apply `DEFAULT_CHOICES`, overlaid by any choice flags below. Useful in CI / scripted / AI runs. |
| `--db=<mongodb\|postgresql\|mysql\|sqlite>` | `mongodb` | Database provider for `schema.prisma`. Pre-fills the wizard step, or applies under `--no-prompt`. |
| `--auth=<none\|credentials\|credentials+oauth>` | `none` | Authentication mode. `none` ships no auth wiring. |
| `--oauth=<google,github,discord,facebook,microsoft>` | (empty) | Comma-separated OAuth providers. Only used when auth resolves to `credentials+oauth`. `--oauth=` (empty) yields no providers. |
| `--email=<none\|console\|resend\|smtp>` | `none` | Transactional email adapter. |
| `--monitoring=<none\|sentry\|datadog\|posthog>` | `none` | Observability backend. |
| `--presence` | off | Opt INTO `@luckystack/presence` (AFK / presence / socket-status). |
| `--error-tracking` | off | Opt INTO `@luckystack/error-tracking` (error capture + auto-instrumentation). |
| `--docs-ui` | off | Opt INTO `@luckystack/docs-ui` (in-app API docs viewer). |
| `--secret-manager` | off | Opt INTO `@luckystack/secret-manager` (`.env`-pointer secret resolution). |
| `--router` | off | Opt INTO `@luckystack/router` (multi-instance load-balancer) + a `npm run router` script. |
| `--cron` | off | Opt INTO `@luckystack/cron` (leader-elected recurring jobs). Dependency-only; self-wires at boot, register jobs in `luckystack/cron/*.ts`. |
| `--ai-docs` / `--no-ai-docs` | on | Include / omit the LuckyStack AI dev-context (root `CLAUDE.md`, `docs/luckystack/`, `skills/`, `.claude/commands/`, the pre-commit AI-index hook + `@luckystack/mcp`). |
| `--ai-browser=<all\|agent-browser\|none>` | `agent-browser` | AI browser-testing tooling. `all` also wires the Playwright + Chrome DevTools MCP servers. Forced to `none` when AI instructions are off. |
| `--help`, `-h` | — | Print the usage banner via `printHelp()` and exit 0. Takes precedence over every other flag. |

> i18n is NOT a flag — the multi-language setup (nl/de/fr locales + switcher) always ships, because the translator is core. There is no `--no-i18n`.

## Parsing semantics

`VALID_FLAGS` is the single source of truth for recognised tokens (used by both the parser's unknown-flag error and the help banner):

```ts
export const VALID_FLAGS = [
  '--no-install', '--no-prompt',
  '--db=<mongodb|postgresql|mysql|sqlite>',
  '--auth=<none|credentials|credentials+oauth>',
  '--oauth=<google,github,discord,facebook,microsoft>',
  '--email=<none|console|resend|smtp>',
  '--monitoring=<none|sentry|datadog|posthog>',
  '--presence', '--error-tracking', '--docs-ui', '--secret-manager', '--router', '--cron',
  '--ai-docs', '--no-ai-docs',
  '--ai-browser=<all|agent-browser|none>',
  '--help', '-h',
] as const;
```

Key behaviours:

- **Exact-match for bare toggles.** `--no-INSTALL`, `--noinstall`, `--no_install` are NOT recognised — they hit the unknown-flag branch and the CLI exits 2.
- **`--key=value` for choice flags.** `--db=`, `--auth=`, `--oauth=`, `--email=`, `--monitoring=`, `--ai-browser=` read the substring after `=`. A value not in the canonical list prints `Invalid <flag> value: …` + the valid values and exits 2 (`parseValueFlag`).
- **Unknown flags fail-fast.** Any token starting with `-` that is neither a known toggle nor a known `--key=` prefix prints a three-line error and exits 2.
- **First non-flag token wins.** `projectName ||= arg` captures the first non-flag token; later positionals are silently dropped (`foo bar` scaffolds `foo`).
- **Choice flags overlay the defaults under `--no-prompt`.** A flag left unset is `null`, meaning "ask the wizard" (interactive) or "use `DEFAULT_CHOICES`" (`--no-prompt`).

## Type: `CliArgs`

```ts
interface CliArgs {
  projectName: string;
  install: boolean;                              // false with --no-install
  prompt: boolean;                               // false with --no-prompt
  help: boolean;
  presence: boolean;
  errorTracking: boolean;
  docsUi: boolean;
  secretManager: boolean;
  router: boolean;
  cron: boolean;
  aiBrowserTooling: 'all' | 'agent-browser' | 'none' | null;
  dbProvider: 'mongodb' | 'postgresql' | 'mysql' | 'sqlite' | null;
  authMode: 'none' | 'credentials' | 'credentials+oauth' | null;
  oauthProviders: ('google' | 'github' | 'discord' | 'facebook' | 'microsoft')[] | null;
  emailProvider: 'none' | 'console' | 'resend' | 'smtp' | null;
  monitoringProvider: 'none' | 'sentry' | 'datadog' | 'posthog' | null;
  aiInstructions: boolean | null;                // --ai-docs / --no-ai-docs
}
```

A `null` choice means the flag was not passed: the wizard asks for it, or `DEFAULT_CHOICES` supplies it under `--no-prompt`.

## Defaults (`DEFAULT_CHOICES`)

Applied under `--no-prompt` (and as the wizard's pre-selected values). **Lean by default — every optional package/feature is OFF unless opted in:**

| Choice | Default |
| --- | --- |
| `dbProvider` | `mongodb` |
| `authMode` | `none` |
| `oauthProviders` | `[]` |
| `emailProvider` | `none` |
| `monitoringProvider` | `none` |
| `presence` / `errorTracking` / `docsUi` / `secretManager` / `router` / `cron` | all `false` |
| `aiInstructions` | `true` (docs + git hook only; no app-runtime weight) |
| `aiBrowserTooling` | `agent-browser` |

## Exit codes

| Code | Cause |
| --- | --- |
| `0` | Help printed, or scaffold completed end-to-end. A non-zero exit from `npm install` / `npx prisma generate` is logged as a warning and does NOT change the CLI's exit code. |
| `1` | Missing project name; `slugify` produced an empty slug; target directory already exists; `TEMPLATE_DIR` missing at runtime (packaging bug); unexpected exception caught by the top-level `.catch`. |
| `2` | Unknown flag, or an invalid `--key=value` value. The parser exits before returning, so nothing downstream runs. |

## Environment variables

`create-luckystack-app` reads **no** environment variables. All input flows through argv and interactive prompts — deliberate, so a stray shell var can't silently change scaffold output and the CLI is safe to invoke from CI without configuring secrets.

## `printHelp()` output

```
create-luckystack-app — scaffold a new LuckyStack project

Usage:
  npx create-luckystack-app <project-name> [options]

Options:
  --no-install   Don't run `npm install` or `npx prisma generate` after copying.
  --no-prompt    Skip the interactive prompts and use defaults + any flags below.

  Scaffold choices (each pre-fills the matching wizard step, or applies under --no-prompt):
  Lean by default: every optional package/feature is OFF unless you opt in below.
  --db=<mongodb|postgresql|mysql|sqlite>      Database provider (default mongodb).
  --auth=<none|credentials|credentials+oauth> Authentication mode (default 'none' = no auth).
  --oauth=<google,github,discord,facebook,microsoft>  OAuth providers (comma list; needs --auth=credentials+oauth).
  --email=<none|console|resend|smtp>          Transactional email adapter (default 'none').
  --monitoring=<none|sentry|datadog|posthog>  Observability backend (default 'none').
  --presence     Install @luckystack/presence (AFK / presence / socket-status).
  --error-tracking  Install @luckystack/error-tracking (error capture + auto-instrumentation).
  --docs-ui      Install @luckystack/docs-ui (in-app API docs viewer).
  --secret-manager  Install @luckystack/secret-manager (.env-pointer secrets).
  --router       Install @luckystack/router (multi-instance load-balancer; npm run router).
  --cron         Install @luckystack/cron (leader-elected recurring jobs; register in luckystack/cron/*.ts).
  --ai-docs / --no-ai-docs   Include / omit LuckyStack AI dev instructions (default on).
  --ai-browser=<all|agent-browser|none>
                 AI browser-testing tooling (default agent-browser). 'all' also wires the
                 Playwright + Chrome DevTools MCP servers. Needs the AI instructions on.
  --help, -h     Show this message.

Example:
  npx create-luckystack-app my-app
  npx create-luckystack-app my-app --no-prompt --no-install
  npx create-luckystack-app my-app --no-prompt --db=postgresql --auth=credentials+oauth --oauth=google,github --email=resend --monitoring=sentry
```

The banner is also printed (to stderr, after a "Missing project name." line) when invoked with no positional argument — exit code 1 in that case.

## Future flags under consideration

Genuinely not implemented yet (every new flag is a permanent API surface):

- `--yes` / `-y` — accept all interactive defaults while still printing the prompt summary (today `--no-prompt` covers the silent case).
- `--template <path>` — point at a non-bundled `template/` directory for fork / dogfooding workflows.

## Related

- Scaffold flow that consumes `CliArgs`: [`scaffold-flow.md`](./scaffold-flow.md)
- Template variables that are populated regardless of flags: [`template-variables.md`](./template-variables.md)
- Post-scaffold install/print behaviour gated by `--no-install`: [`post-scaffold-suggestions.md`](./post-scaffold-suggestions.md)
