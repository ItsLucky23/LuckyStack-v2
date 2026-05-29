# Scaffold Flow

End-to-end execution path of `create-luckystack-app` from `npx` invocation to the final "Done — scaffold complete." banner.

## High-level sequence

```
npx create-luckystack-app <name> [flags]
   |
   v
[1] main()                                src/index.ts:283
   |
   |-- parseArgs(process.argv.slice(2))   src/index.ts:39
   |     -> CliArgs { projectName, install, prompt, help }
   |
   |-- if (args.help) -> printHelp() -> return
   |
   |-- if (!args.projectName) -> printHelp() -> exit 1
   |
   |-- slug = slugify(args.projectName)
   |     -> if (!slug) exit 1   // "Invalid project name"
   |
   |-- targetDir = path.resolve(cwd, args.projectName)
   |     -> if (fs.existsSync) exit 1   // "Target directory already exists"
   |
   |-- if (!fs.existsSync(TEMPLATE_DIR)) exit 1   // packaging bug
   |
   |-- choices = args.prompt ? await runPrompts() : DEFAULT_CHOICES
   |
   |-- vars = { PROJECT_NAME, PROJECT_TITLE, LUCKYSTACK_VERSION, DB_PROVIDER,
   |            AUTH_MODE, OAUTH_PROVIDERS, EMAIL_PROVIDER, MONITORING_PROVIDER,
   |            I18N_ENABLED }
   |
   |-- copyTree(TEMPLATE_DIR, targetDir, vars)
   |
   |-- [Fase E.2] framework-docs copy block
   |     CLAUDE.md            -> targetDir/CLAUDE.md
   |     docs/                -> targetDir/docs/luckystack/
   |     skills/              -> targetDir/skills/
   |     .claude/commands/    -> targetDir/.claude/commands/
   |     branch-logs/README.md -> targetDir/branch-logs/README.md
   |
   |-- if (args.install):
   |     runNpmInstall(targetDir)
   |     runPrismaGenerate(targetDir)
   |
   v
"Done — scaffold complete." + Next-steps block
```

## Functions

### `main()` (src/index.ts:283)

CLI entrypoint, auto-invoked at the bottom of the module via `main().catch(...)`. Returns `Promise<void>`. Failure modes:

- Help requested -> `printHelp()`, return cleanly (exit 0).
- Missing project name -> stderr message, `printHelp()`, `process.exit(1)`.
- Slug empty after `slugify()` -> stderr "Invalid project name", `process.exit(1)`.
- Target directory already exists -> stderr, `process.exit(1)`. The CLI never overwrites.
- `TEMPLATE_DIR` not present at runtime -> stderr "This is a packaging bug", `process.exit(1)`.
- Any other thrown error bubbles up to the `.catch` on line 390, logged as `[create-luckystack-app] unexpected error:`, exit 1.

`main` does NOT swallow errors from `runPrompts`, `copyTree`, or `readSelfVersion` — they propagate to the top-level catch.

### `parseArgs(argv)` (src/index.ts:39)

Pure function. Walks the argv array once. Recognises:

- `--no-install` -> `install = false`
- `--no-prompt` -> `prompt = false`
- `--help` / `-h` -> `help = true`
- First non-flag token -> `projectName` (only the first is captured because of `projectName ||= arg`)

Unknown flags are silently ignored. There is no `--flag=value` syntax. Order of flags does not matter. Returns `CliArgs`.

### `runPrompts()` (src/index.ts:124)

Opens a `readline` interface bound to `process.stdin` / `process.stdout`, then asks six questions in this order:

1. `dbProvider` — `pickFromList` over `['mongodb', 'postgresql', 'mysql', 'sqlite']`, default `'mongodb'`.
2. `authMode` — `pickFromList` over `['none', 'credentials', 'credentials+oauth']`, default `'credentials'`.
3. `oauthProviders` — **conditional**: only asked when `authMode === 'credentials+oauth'`. `pickMulti` over `['google', 'github', 'discord', 'facebook', 'microsoft']`. Default empty.
4. `emailProvider` — `pickFromList` over `['none', 'console', 'resend', 'smtp']`, default `'console'`.
5. `monitoringProvider` — `pickFromList` over `['none', 'sentry', 'datadog', 'posthog']`, default `'none'`.
6. `i18n` — `askYesNo`, default `true`.

The readline interface is always closed in `finally` so a Ctrl-C during prompts does not leave the TTY in raw mode.

Skipped entirely when `parseArgs` set `prompt: false`. In that case `DEFAULT_CHOICES` is used as-is.

### `pickFromList(rl, label, options, defaultValue)` (src/index.ts:77)

Single-choice prompt helper. Behaviour:

- Prints the label, then a numbered menu (`1) optionA`, `2) optionB`, ...). The default option is marked `(default)`.
- Blank input -> returns `defaultValue`.
- Numeric input within `[1, options.length]` -> returns `options[n-1]`.
- Otherwise case-insensitive name match against the option list -> returns the matching option.
- No match -> returns `defaultValue` (silent fallback, not an error). This makes the prompt forgiving for typos.

### `pickMulti(rl, label, options)` (src/index.ts:95)

Multi-choice prompt helper. Behaviour:

- Prints `label (comma-separated, blank = none)` followed by a numbered menu.
- Blank input -> returns `[]`.
- Otherwise splits on `,`, trims each part, and for each part: accepts a numeric index OR a case-insensitive option name. Unknown parts are silently dropped.
- Deduplicates via an internal `Set<T>`. Order in the return is the insertion order of the user's input.

There is no "all" sentinel — to pick everything the user must list each option.

### `askYesNo(rl, label, defaultValue)` (src/index.ts:117)

Boolean prompt helper. Behaviour:

- Prompt suffix is `(Y/n)` when default is `true`, `(y/N)` otherwise.
- Blank input -> returns `defaultValue`.
- Lowercase compare: `y` / `yes` -> `true`. Anything else -> `false`. Note: this means typing `n`, `no`, or even `maybe` all map to `false`.

### Self-contained `npm run test` in the scaffold

The bundled `template/` tree includes the artifact-generation scripts and preset loader that `npm run test` depends on so a fresh checkout is testable without any extra wiring:

- `template/scripts/generateTypeMaps.ts` — emits `apiTypes.generated.ts` + `apiInputSchemas.generated.ts` + `apiDocs.generated.json` via `@luckystack/devkit`.
- `template/scripts/generateServerRequests.ts` — emits the server-request typings the test runner consumes.
- `template/server/config/presetLoader.ts` — loads the project's preset config so the runtime maps line up with what the test runner expects.
- `template/package.json` declares a `generateArtifacts` script that runs both generators, and the `test` script chains `generateArtifacts` before invoking `@luckystack/test-runner`. Without this chain, `testAll.ts` imports `apiInputSchemas.generated` / `apiTypes.generated` files that don't exist on first checkout and `npm run test` errors before any layer starts.

`copyTree` carries these files into the scaffolded project unchanged. Consumers who customize the artifact pipeline should edit the scripts in `<scaffold>/scripts/` rather than removing them.

### `copyTree(src, dest, vars)` (src/index.ts:241)

Recursive directory copier. For every entry under `src`:

1. Rewrite the destination filename via `renameDotFile` (`_dot_` -> `.`).
2. If the entry is a directory -> create the destination dir and recurse.
3. If the entry is a file:
   - `isTextFile(destPath)` -> read as UTF-8, run `replacePlaceholders(content, vars)`, write the result.
   - Otherwise -> `fs.copyFileSync` for byte-exact binary copy.

`fs.mkdirSync(dest, { recursive: true })` is called once per recursion level so missing intermediate dirs are created on demand. There is no manifest / allowlist — every file under `template/` is copied. To exclude a file from the scaffold, remove it from `template/`.

### `renameDotFile(name)` (src/index.ts:221)

Filename rewriter. Replaces every occurrence of the literal substring `_dot_` with `.`. Examples:

| Source name in `template/` | Final name in scaffold |
| --- | --- |
| `_dot_gitignore` | `.gitignore` |
| `_dot_env_template` | `.env_template` |
| `_dot_env_dot_local_template` | `.env.local_template` |
| `regular.ts` | `regular.ts` (unchanged) |

This works around npm's tarball-publish behavior, which silently drops files whose names start with `.` (so a real `.gitignore` in `template/` never reaches consumers). Multiple `_dot_` occurrences in one name are all rewritten.

## Constants

### `TEMPLATE_DIR` (src/index.ts:30)

```ts
const TEMPLATE_DIR = path.resolve(__dirname, '..', 'template');
```

Resolves to `<package-root>/template/` at runtime. In the published npm tarball this is `node_modules/create-luckystack-app/template/`. When running from source (`dist/index.js`) it points at the monorepo's `packages/create-luckystack-app/template/`. The CLI aborts with a packaging-bug message when this directory does not exist.

### `DEFAULT_CHOICES` (src/index.ts:68)

```ts
const DEFAULT_CHOICES: ScaffoldChoices = {
  dbProvider: 'mongodb',
  authMode: 'credentials',
  oauthProviders: [],
  emailProvider: 'console',
  monitoringProvider: 'none',
  i18n: true,
};
```

Applied only when `--no-prompt` is passed. Tuned for the "smoke test" / CI scenario — Mongo because it needs the least local setup, `console` email because it writes to stdout without any external service.

## Type: `ScaffoldChoices`

```ts
interface ScaffoldChoices {
  dbProvider: 'mongodb' | 'postgresql' | 'mysql' | 'sqlite';
  authMode: 'none' | 'credentials' | 'credentials+oauth';
  oauthProviders: ('google' | 'github' | 'discord' | 'facebook' | 'microsoft')[];
  emailProvider: 'none' | 'console' | 'resend' | 'smtp';
  monitoringProvider: 'none' | 'sentry' | 'datadog' | 'posthog';
  i18n: boolean;
}
```

The shape is the union of every prompt answer plus the conditional `oauthProviders`. It is converted to the string-keyed `vars` map in `main` immediately after prompting.

## Error handling and exit codes

| Exit code | Condition |
| --- | --- |
| `0` | Help printed, or scaffold completed (even if `npm install` exited non-zero — that only logs a manual-fallback hint). |
| `1` | Missing project name, invalid slug after `slugify`, target directory exists, `TEMPLATE_DIR` missing, unexpected exception. |

The scaffold is not transactional — if `copyTree` partially completes and then throws, the target directory is left in whatever state the failure caused. The user is expected to delete it and retry. This is deliberate: rollback logic would mask the real failure.

## Non-TTY behaviour

If `runPrompts` is invoked under a non-interactive stdin (e.g. piped input), readline still works — it just receives whatever is fed on stdin line-by-line. Blank lines are interpreted as "use the default", which means a piped empty stream produces `DEFAULT_CHOICES`-equivalent answers. For deterministic CI usage prefer `--no-prompt`.

## Related

- Flag reference: [`cli-flags.md`](./cli-flags.md)
- Template variable reference: [`template-variables.md`](./template-variables.md)
- Framework-docs copy step: [`framework-docs-copy.md`](./framework-docs-copy.md)
- Post-scaffold install + next steps: [`post-scaffold-suggestions.md`](./post-scaffold-suggestions.md)
