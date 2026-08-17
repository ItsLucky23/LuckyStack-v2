# CLI Flags

Reference for `create-luckystack-app`'s strict argv parser. The canonical implementation and option lists live in `src/index.ts` (`VALID_FLAGS`, `PROVIDER_OPTIONS`, `parseArgs`, and `DEFAULT_CHOICES`).

## Invocation

```bash
npx create-luckystack-app <project-name> [options]
```

The first non-flag token is slugified and used as the target directory. The target must remain below the current working directory and must not already exist. Later positional tokens are ignored.

Bare toggles require an exact match. Choice flags use `--key=value`; unknown flags or invalid values print the valid choices and exit with code 2.

## Flags

| Flag | Default | Effect |
| --- | --- | --- |
| `--orm=<prisma\|drizzle\|mikro-orm\|none>` | `prisma` | Data layer. Drizzle supports PostgreSQL/MySQL/SQLite; MikroORM supports all four databases; `none` supplies bring-your-own shims. |
| `--db=<mongodb\|postgresql\|mysql\|sqlite>` | `mongodb` | Database/provider used by the selected ORM. |
| `--pm=<npm\|bun>` | `npm` | Package manager for installation and later LuckyStack CLI operations. Bun must be on `PATH`; Prisma generation still runs through `npx`. |
| `--auth=<none\|credentials\|credentials+oauth>` | `none` | Authentication mode. Drizzle/MikroORM auth gets a starter `UserAdapter` to finish; `orm=none` forces auth off. |
| `--oauth=<google,github,discord,facebook,microsoft>` | empty | Comma-separated providers, retained only for `credentials+oauth`. Each value is validated. |
| `--email=<none\|console\|resend\|smtp>` | `none` | Transactional email package/adapter and matching SDK/env placeholders. |
| `--monitoring=<none\|sentry\|datadog\|posthog>` | `none` | Vendor SDK/env wiring. This is separate from installing the framework error-tracking layer. |
| `--presence` | off | Keep/wire `@luckystack/presence`. |
| `--error-tracking` | off | Keep/wire `@luckystack/error-tracking`. |
| `--docs-ui` | off | Keep/wire `@luckystack/docs-ui`. |
| `--secret-manager` | off | Add/wire `@luckystack/secret-manager`. |
| `--router` | off | Keep router topology, add `@luckystack/router`, and switch invocation to routed HTTP/SSE. |
| `--cron` | off | Add `@luckystack/cron`; jobs register from `luckystack/cron/*.ts`. |
| `--ai-docs` / `--no-ai-docs` | on | Include/omit framework AI context, index hook, and graph MCP wiring. |
| `--ai-browser=<all\|agent-browser\|none>` | `agent-browser` | Browser-testing tools. `all` also configures Playwright and Chrome DevTools MCP. Forced to `none` when AI docs are off. |
| `--no-install` | install runs | Skip package installation and Prisma client generation. |
| `--no-prompt` | wizard runs | Resolve from `DEFAULT_CHOICES` plus supplied flags without a TTY wizard. |
| `--help`, `-h` | — | Print help and exit 0. |

The translator/i18n surface always ships; there is no i18n toggle.

## Cross-field rules

- `--orm=drizzle --db=mongodb` is invalid and exits 2. When only `--orm=drizzle` is supplied, the untouched MongoDB default becomes PostgreSQL with a notice.
- Explicit `--orm=none --auth=credentials*` is invalid and exits 2. Interactive and normalized paths force auth to `none` for this ORM.
- OAuth providers are discarded unless auth is `credentials+oauth`.
- AI browser tooling is discarded when AI instructions are disabled.
- Selecting a monitoring backend injects its vendor SDK/env setup; full framework capture additionally requires the `errorTracking` choice.

## `CliArgs`

```ts
interface CliArgs {
  projectName: string;
  install: boolean;
  prompt: boolean;
  help: boolean;
  orm: 'prisma' | 'drizzle' | 'mikro-orm' | 'none' | null;
  dbProvider: 'mongodb' | 'postgresql' | 'mysql' | 'sqlite' | null;
  packageManager: 'npm' | 'bun' | null;
  authMode: 'none' | 'credentials' | 'credentials+oauth' | null;
  oauthProviders: OAuthProvider[] | null;
  emailProvider: 'none' | 'console' | 'resend' | 'smtp' | null;
  monitoringProvider: 'none' | 'sentry' | 'datadog' | 'posthog' | null;
  presence: boolean;
  errorTracking: boolean;
  docsUi: boolean;
  secretManager: boolean;
  router: boolean;
  cron: boolean;
  aiInstructions: boolean | null;
  aiBrowserTooling: 'all' | 'agent-browser' | 'none' | null;
}
```

`null` means the choice flag was not supplied. Interactive mode uses supplied values as presets and asks only unresolved questions; no-prompt mode overlays them on the defaults.

## Lean defaults

```ts
{
  orm: 'prisma',
  dbProvider: 'mongodb',
  packageManager: 'npm',
  authMode: 'none',
  oauthProviders: [],
  emailProvider: 'none',
  monitoringProvider: 'none',
  presence: false,
  errorTracking: false,
  docsUi: false,
  secretManager: false,
  router: false,
  cron: false,
  aiInstructions: true,
  aiBrowserTooling: 'agent-browser',
}
```

## Exit behavior

| Code | Cause |
| --- | --- |
| `0` | Help, or scaffold completion. Install/generation failures print a retry hint but leave the generated project intact. |
| `1` | Missing/invalid project name, unsafe/existing target, missing packaged template, or unexpected scaffold error. A scaffold-time exception removes the partial directory best-effort. |
| `2` | Unknown flag, invalid value, or invalid explicit ORM/database/auth combination. |

The CLI accepts no configuration choices from environment variables. It does consult operating-system variables such as `PATH`, `PATHEXT`, and `ComSpec` to resolve and safely spawn npm/Bun/npx.

## Examples

```bash
# Interactive wizard
npx create-luckystack-app my-app

# Deterministic lean scaffold
npx create-luckystack-app my-app --no-prompt --no-install

# Scripted Drizzle app
npx create-luckystack-app my-app --no-prompt \
  --orm=drizzle --db=postgresql --pm=npm \
  --auth=credentials+oauth --oauth=google,github \
  --email=resend --monitoring=sentry --error-tracking
```

## Related

- [`scaffold-flow.md`](./scaffold-flow.md)
- [`template-variables.md`](./template-variables.md)
- [`post-scaffold-suggestions.md`](./post-scaffold-suggestions.md)
