# Template Variables

Reference for every `{{KEY}}` placeholder substituted into the scaffolded project tree, including the source function for each variable and the helper utilities that drive substitution.

## Substitution engine

`replacePlaceholders(content, vars)` (src/index.ts:223) walks the text content of every file flagged as text by `isTextFile`, looking for the literal pattern `{{KEY}}` (one or more word characters between two curly-brace pairs).

```ts
const replacePlaceholders = (
  content: string,
  vars: Record<string, string>,
): string => {
  return content.replace(/{{(\w+)}}/g, (match, key: string) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match;
  });
};
```

Key behaviours:

- Pattern is `/{{(\w+)}}/g` — only ASCII word chars (`[A-Za-z0-9_]`). Hyphens or dots in a placeholder key would not match. This is intentional; we use SCREAMING_SNAKE_CASE keys exclusively.
- Unknown keys are **preserved verbatim** (the regex returns `match` for non-own keys). A `{{UNKNOWN_KEY}}` in a template file therefore lands in the scaffolded output unchanged, which is easy to spot in code review.
- `hasOwnProperty` check guards against prototype pollution (e.g. `{{toString}}` would otherwise resolve to `Function.prototype.toString.toString`).
- Substitution is single-pass — the replacement value is NOT re-scanned for placeholders. A var like `PROJECT_NAME: '{{PROJECT_TITLE}}'` would not chain.

## The full variable set

Constructed in `main()` (src/index.ts:319) right after prompts settle:

```ts
const vars: Record<string, string> = {
  PROJECT_NAME: slug,
  PROJECT_TITLE: titleCase(args.projectName),
  LUCKYSTACK_VERSION: readSelfVersion(),
  DB_PROVIDER: choices.dbProvider,
  AUTH_MODE: choices.authMode,
  OAUTH_PROVIDERS: choices.oauthProviders.join(','),
  EMAIL_PROVIDER: choices.emailProvider,
  MONITORING_PROVIDER: choices.monitoringProvider,
  I18N_ENABLED: choices.i18n ? 'true' : 'false',
};
```

### `{{PROJECT_NAME}}`

- **Source**: `slugify(args.projectName)` (src/index.ts:184).
- **Type**: kebab-case ASCII slug.
- **Used for**: directory name, `package.json` `"name"` field, default header label in the scaffolded UI.

`slugify` lower-cases the raw input, replaces every run of non-alphanumeric characters (regex `/[^a-z0-9]+/g`) with a single `-`, then trims leading and trailing dashes.

Examples:

| Raw input | `slugify` output |
| --- | --- |
| `MyApp` | `myapp` |
| `My Cool App` | `my-cool-app` |
| `acme-corp` | `acme-corp` |
| `--weird--name__` | `weird-name` |
| `123start` | `123start` (digit leads are allowed) |
| `cafe` | `cafe` |
| `café` | `caf` (non-ASCII chars are stripped, the diacritic falls out) |
| `   ` | `''` (empty slug aborts with "Invalid project name") |

Unicode handling is deliberately strict: only `[a-z0-9]` survives. If a user wants emoji or non-ASCII in their project name they must wrap that handling themselves at the consumer level.

### `{{PROJECT_TITLE}}`

- **Source**: `titleCase(args.projectName)` (src/index.ts:191).
- **Type**: human-readable Title Case string.
- **Used for**: page titles, headings in landing / login pages, README banner.

`titleCase` splits the raw input on whitespace / `-` / `_`, filters out empty parts, Title-Cases each part, and joins with a single space. If the result is empty, it returns the fallback string `'My LuckyStack App'`.

Examples:

| Raw input | `titleCase` output |
| --- | --- |
| `my-cool-app` | `My Cool App` |
| `acme corp` | `Acme Corp` |
| `acme_corp_inc` | `Acme Corp Inc` |
| `myapp` | `Myapp` |
| `---` | `My LuckyStack App` (fallback) |

Note: `titleCase` is applied to the ORIGINAL `args.projectName`, not to the slug, so casing and word boundaries in the user's input are preserved.

### `{{LUCKYSTACK_VERSION}}`

- **Source**: `readSelfVersion()` (src/index.ts:198).
- **Type**: semver string, e.g. `"0.4.2"`.
- **Used for**: pinning `@luckystack/*` ranges in the generated `package.json`. The template ships these as `"^{{LUCKYSTACK_VERSION}}"` so the scaffolded app installs matching versions of every framework package.

`readSelfVersion` reads its own `package.json` (`path.resolve(__dirname, '..', 'package.json')`), parses it, and asserts the `version` field matches `/^\d+\.\d+\.\d+/`. It throws loudly when the version is missing or malformed.

Rationale for the throw (from the inline comment): silently falling back to `'0.0.1'` would lock every newly-scaffolded project to a stale dependency set, which is almost always worse than aborting.

### `{{DB_PROVIDER}}`

- **Source**: `choices.dbProvider` (`pickFromList` result).
- **Type**: `'mongodb' | 'postgresql' | 'mysql' | 'sqlite'`.
- **Used for**: the `provider` field in `prisma/schema.prisma`, the conditional database-init script in the next-steps block (`prisma:db:push` vs `prisma:migrate:dev`).

### `{{AUTH_MODE}}`

- **Source**: `choices.authMode`.
- **Type**: `'none' | 'credentials' | 'credentials+oauth'`.
- **Used for**: feature flag in the scaffolded `luckystack/login/userAdapter.ts` and `luckystack/login/oauthProviders.ts` to enable/disable auth wiring.

### `{{OAUTH_PROVIDERS}}`

- **Source**: `choices.oauthProviders.join(',')`.
- **Type**: comma-joined string. Empty string when no providers are picked.
- **Used for**: list of OAuth provider keys to register in `luckystack/login/oauthProviders.ts`. The template parses the comma-separated list at scaffold time.

The fact that this is a STRING (not an array literal) is significant — the value is interpolated into source code that itself runs `.split(',')`. Consumers should treat the empty string as "no providers".

### `{{EMAIL_PROVIDER}}`

- **Source**: `choices.emailProvider`.
- **Type**: `'none' | 'console' | 'resend' | 'smtp'`.
- **Used for**: which `@luckystack/email` adapter to instantiate in the overlay.

### `{{MONITORING_PROVIDER}}`

- **Source**: `choices.monitoringProvider`.
- **Type**: `'none' | 'sentry' | 'datadog' | 'posthog'`.
- **Used for**: which monitoring adapter to wire into `bootstrapLuckyStack` (or to leave unwired when `'none'`).

### `{{I18N_ENABLED}}`

- **Source**: `choices.i18n ? 'true' : 'false'`.
- **Type**: literal string `'true'` or `'false'` (NOT a boolean — the regex substitutes raw text).
- **Used for**: feature flag in `luckystack/i18n/locales.ts` to short-circuit translator initialisation when the user opted out.

## Text vs binary detection

`isTextFile(filePath)` (src/index.ts:232) decides whether `copyTree` runs `replacePlaceholders` or falls back to a binary copy.

```ts
const isTextFile = (filePath: string): boolean => {
  const textExts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json',
                    '.md', '.css', '.html', '.prisma'];
  if (textExts.includes(path.extname(filePath))) return true;
  const base = path.basename(filePath);
  if (base.startsWith('.')) return true;
  return false;
};
```

Behaviour:

- Any path with one of the listed extensions is treated as text.
- Any basename starting with `.` is treated as text. This is checked AFTER `renameDotFile`, so `_dot_env_template` (renamed to `.env_template`) qualifies. This catches dotfiles that have no extension (`.gitignore`, `.env`, `.env_template`).
- Everything else (images, fonts, binary blobs) is byte-copied via `fs.copyFileSync`. Adding a new text extension is a one-line change to `textExts`.

Files that contain `{{...}}` tokens but match no extension and no dot-prefix would be byte-copied with the tokens left intact. We do not have any such files today, but it is worth flagging as a footgun for future template additions.

## Adding a new placeholder

1. Add a new question to `runPrompts` (or extend `DEFAULT_CHOICES` if it should be auto-chosen).
2. Add the key to `ScaffoldChoices`.
3. Add a `KEY: value` line to the `vars` map in `main()`.
4. Reference `{{KEY}}` from the relevant file(s) in `template/`.

Always use SCREAMING_SNAKE_CASE for keys — the regex requires `\w+`, and the convention helps reviewers spot unfilled placeholders during code review.

**Do not** read placeholder values from environment variables. The CLI is run on the consumer's machine, where stray env vars (`PROJECT_NAME=...`) could leak unintended values into a scaffold. All input must flow through argv or interactive prompts.

## Where each placeholder lands

The lookup below was generated by grepping the `template/` tree. It is illustrative — when files are added, the list will grow.

| Placeholder | Files that reference it (representative) |
| --- | --- |
| `{{PROJECT_NAME}}` | `package.json`, `index.html`, `src/_locales/*.json`, `README.md` |
| `{{PROJECT_TITLE}}` | `index.html`, `src/_locales/*.json`, `README.md`, login / register pages |
| `{{LUCKYSTACK_VERSION}}` | `package.json` (every `@luckystack/*` dependency range) |
| `{{DB_PROVIDER}}` | `prisma/schema.prisma`, `package.json` scripts |
| `{{AUTH_MODE}}` | `luckystack/login/userAdapter.ts`, `luckystack/login/oauthProviders.ts` |
| `{{OAUTH_PROVIDERS}}` | `luckystack/login/oauthProviders.ts` |
| `{{EMAIL_PROVIDER}}` | `luckystack/server/index.ts`, `services.config.ts` |
| `{{MONITORING_PROVIDER}}` | `luckystack/server/index.ts` |
| `{{I18N_ENABLED}}` | `luckystack/i18n/locales.ts`, `src/main.tsx` |

## Related

- Scaffold execution flow: [`scaffold-flow.md`](./scaffold-flow.md)
- CLI flag reference: [`cli-flags.md`](./cli-flags.md)
- Framework-docs copy step (uses the same `vars` set on the AI docs): [`framework-docs-copy.md`](./framework-docs-copy.md)
