# Template Variables

Reference for create-app-time `{{TOKEN}}` replacement. Source: `buildTemplateVars`, `buildDockerTemplateVars`, `replacePlaceholders`, and `copyTree` in `src/index.ts`.

## Substitution contract

```ts
content.replaceAll(/{{(\w+)}}/g, (match, key) =>
  Object.prototype.hasOwnProperty.call(vars, key) ? (vars[key] ?? match) : match,
);
```

- Keys use ASCII word characters; framework variables follow `SCREAMING_SNAKE_CASE`.
- Unknown placeholders remain verbatim.
- Replacement is a single pass.
- Only text files are rendered; binaries are copied unchanged.
- Symlinks are skipped.

Unknown placeholders remaining in `.luckystack/templates/` are intentional: tokens such as `{{REL_PATH}}`, `{{PAGE_PATH}}`, and `{{SYNC_NAME}}` belong to the later route/page scaffold commands, not create-app.

## Project variables

| Variable | Source | Main destinations |
| --- | --- | --- |
| `PROJECT_NAME` | `slugify(rawProjectName)` | `package.json`, env templates, Compose project/service data |
| `PROJECT_TITLE` | `titleCase(rawProjectName)` | `config.ts`, `index.html`, README, `docs/PRODUCT.md` |
| `LUCKYSTACK_VERSION` | create-app's own validated package version | Every rendered `@luckystack/*` range |

### Slug rules

`slugify` lowercases, trims, replaces each run outside `[a-z0-9]` with `-`, and removes edge dashes. The sanitized slug—not the raw argument—is the directory name. Empty slugs abort; the resolved target is checked to remain under the current working directory.

Examples: `My Cool App` → `my-cool-app`; `café` → `caf`; `../Admin` → `admin`.

`titleCase` splits the original input on whitespace/dash/underscore, capitalizes each part, and falls back to `My LuckyStack App`.

## Data-layer variables

| Variable | Source/meaning |
| --- | --- |
| `DB_PROVIDER` | Selected `mongodb`, `postgresql`, `mysql`, or `sqlite`; consumed by the base Prisma schema before non-Prisma pruning/adaptation. |
| `USER_ID_ATTRS` | MongoDB ObjectId attributes or SQL/SQLite cuid attributes for Prisma's `User.id`. |
| `DATABASE_URL` | Provider-specific local example inserted into `.env.local_template` and reused by generated ORM config starters. MongoDB includes the required single-node replica-set query. |
| `PRISMA_INIT_CMD` | Historical token name retained in `template/README.md`; value is now ORM-aware: Prisma push/migrate, `db:push`, `db:schema:update`, or an `orm=none` instruction. |

Provider examples:

| Provider | Rendered development shape |
| --- | --- |
| MongoDB | `mongodb://localhost:27017/<slug>?replicaSet=rs0&directConnection=true` |
| PostgreSQL | `postgresql://user:password@localhost:5432/<slug>` |
| MySQL | `mysql://user:password@localhost:3306/<slug>` |
| SQLite | `file:./dev.db` |

## Integration env blocks

| Variable | Builder | Behavior |
| --- | --- | --- |
| `OAUTH_ENV_VARS` | `buildOAuthEnvVars` | Selected providers are active empty-key blocks; alternatives remain enable-later comments. Auth-off emits an add-login pointer. Both development-prefixed and production keys are documented. |
| `EXTERNAL_ORIGINS` | selected OAuth authorization origins | Comma-separated CORS/origin allow-list contribution. |
| `EMAIL_ENV_VARS` | `buildEmailEnvVars` | Console/Resend/SMTP-specific active block plus commented alternatives and `EMAIL_FROM`. |
| `MONITORING_ENV_VARS` | `buildMonitoringEnvVars` | Sentry/PostHog/Datadog env blocks. The selected vendor is uncommented; Datadog also explains first-import setup. |

The associated SDK dependencies are injected separately; these strings only render the environment contract.

## Docker variables

`buildDockerTemplateVars(slug, choices)` renders the Dockerfile, `compose.yaml`, nginx config, and `.env.docker_template` for the selected provider and optional router topology.

| Variable | Purpose |
| --- | --- |
| `DOCKER_DATABASE_SERVICES` | PostgreSQL/MySQL/MongoDB service definitions, Mongo replica initializer, or no external SQLite service. |
| `DOCKER_DATABASE_URL` | App-container connection URL. |
| `DOCKER_BUILD_DATABASE_URL` | Build-stage safe URL used while generating/building artifacts. |
| `DOCKER_DATABASE_DEPENDS_ON` | Provider health/init dependency block. |
| `DOCKER_DATABASE_VOLUMES` | External database volume declaration. |
| `DOCKER_APP_DATA_VOLUME` | SQLite app-data mount. |
| `DOCKER_APP_DATA_DECLARATION` | SQLite named volume declaration. |
| `DOCKER_REMOTE_DATABASE_URL_EXAMPLE` | Host/external database override example. |
| `DOCKER_BACKEND_TARGET` | nginx target: app directly, or router when selected. |
| `DOCKER_ROUTER_SERVICE` | Optional router Compose service. |
| `DOCKER_WEB_DEPENDENCY` | Web service dependency (`app` or `router`). |

These assets use non-root containers, private Redis/database services, health gates, and preset-aware startup; see the scaffold's generated `docs/DOCKER.md`.

## Text detection

`isTextFile` renders:

- `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.json`, `.md`, `.css`, `.html`, `.prisma`, `.yaml`, `.yml`, `.sh`, `.conf`;
- any post-rename basename starting with `.`;
- `Dockerfile`.

Other files are byte-copied. `_dot_` is replaced everywhere in a destination filename, allowing npm-safe sources such as `_dot_env_dot_local_template` to become `.env.local_template`.

## Framework-doc rendering differs intentionally

Template files receive the full variable map. When AI docs are copied, framework `docs/` are copied with an empty map so documentation examples containing `{{...}}` remain examples. Other text entries such as root `CLAUDE.md` can receive project substitutions. Dated framework findings are removed after copying.

## Adding a create-app placeholder

1. Add the value to `buildTemplateVars` or `buildDockerTemplateVars`.
2. Use a `SCREAMING_SNAKE_CASE` token in a recognized text template.
3. Add/update tests for the rendered choice matrix.
4. Update this reference and the create-app `CLAUDE.md` index.
5. Verify no unexpected tokens remain outside `.luckystack/templates/`.

Scaffold choices that primarily alter structure should continue using prune/wire/adapt functions rather than embedding large conditional source blocks in string variables.

## Related

- [`scaffold-flow.md`](./scaffold-flow.md)
- [`cli-flags.md`](./cli-flags.md)
- [`framework-docs-copy.md`](./framework-docs-copy.md)
