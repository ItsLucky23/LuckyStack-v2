# CLI Flags

Complete reference for the command-line interface exposed by `create-luckystack-app`. All flags are parsed by `parseArgs(argv)` (src/index.ts:39); the human-readable help banner is produced by `printHelp()` (src/index.ts:166).

## Invocation shape

```
npx create-luckystack-app <project-name> [options]
```

There is exactly one positional argument (the project name) and a small set of recognised flag tokens. Order of flags is irrelevant. There is no support for `--flag=value` syntax — every recognised flag is a bare token.

## Flags

| Flag | Default | Effect |
| --- | --- | --- |
| `<project-name>` (positional, required) | — | First non-flag token captured. Slugified for the directory name and `{{PROJECT_NAME}}`, Title-Cased for `{{PROJECT_TITLE}}`. Must not already exist. |
| `--no-install` | `install` runs | Skip `runNpmInstall(targetDir)` and `runPrismaGenerate(targetDir)`. Files are still copied; the consumer must run `npm install` and `npx prisma generate` themselves. |
| `--no-prompt` | prompts run | Skip `runPrompts()` and apply `DEFAULT_CHOICES` (Mongo + credentials + console email + no monitoring + i18n on). Useful in CI and smoke tests. |
| `--help`, `-h` | — | Print the usage banner via `printHelp()` and exit 0. Takes precedence over every other flag — if `--help` is present, nothing else runs. |

## Parsing semantics

```ts
const VALID_FLAGS = ['--no-install', '--no-prompt', '--help', '-h'] as const;

const parseArgs = (argv: string[]): CliArgs => {
  let projectName = '';
  let install = true;
  let prompt = true;
  let help = false;
  for (const arg of argv) {
    if (arg === '--no-install') install = false;
    else if (arg === '--no-prompt') prompt = false;
    else if (arg === '--help' || arg === '-h') help = true;
    else if (arg.startsWith('-')) {
      console.error(`Unknown flag: ${arg}`);
      console.error(`Valid flags: ${VALID_FLAGS.join(', ')}`);
      console.error('Run with --help for full usage.');
      process.exit(2);
    } else {
      projectName ||= arg;
    }
  }
  return { projectName, install, prompt, help };
};
```

Key behaviours:

- **Exact-match only.** `--no-INSTALL`, `--noinstall`, `--no_install` are NOT recognised. They are treated as unknown flags and the CLI exits.
- **No `--flag=value`.** The parser does not look at substrings after `=`. `--no-install=true` is therefore an unknown flag.
- **Unknown flags fail-fast.** Any token starting with `-` that is not on the recognised list causes the CLI to print an error and exit with code 2. See [Unknown-flag behaviour](#unknown-flag-behaviour) below.
- **First non-flag token wins.** `projectName ||= arg` captures the first non-flag token and ignores subsequent positionals. So `npx create-luckystack-app foo bar` scaffolds `foo`, not `bar`, and `bar` is silently dropped.
- **Flag/positional interleaving works.** `--no-install foo --no-prompt` is parsed identically to `foo --no-install --no-prompt`.

## Unknown-flag behaviour

If any argument starts with `-` (or `--`) and is not in `VALID_FLAGS`, the CLI prints a three-line error to stderr and exits with code 2. No prompts run, no files are written, no project name validation happens — the parser exits before returning.

Example — typo of `--no-install` as `--ni-install`:

```
$ npx create-luckystack-app my-app --no-prompt --ni-install
Unknown flag: --ni-install
Valid flags: --no-install, --no-prompt, --help, -h
Run with --help for full usage.
```

Exit code: `2`.

This was changed from the previous "silently ignore" behaviour because typos in flag names (e.g. `--ni-install` vs `--no-install`) were getting swallowed and the scaffold would proceed with default behaviour, which is the opposite of what the user asked for. The trade-off is that any future flag must be added to `VALID_FLAGS` (and `printHelp`) before it will be accepted — there is no quiet pass-through any more.

## Type: `CliArgs`

```ts
interface CliArgs {
  projectName: string;   // '' when no positional was given
  install: boolean;      // true unless --no-install
  prompt: boolean;       // true unless --no-prompt
  help: boolean;         // true if --help or -h was seen
}
```

This is the only value `parseArgs` produces. `main()` then validates `projectName` (non-empty after `slugify`) and gates every subsequent step on the boolean flags.

## Flag interactions

| Combination | Behaviour |
| --- | --- |
| `<name>` only | Default interactive flow. Prompts run, dependencies install, Prisma client generates. |
| `<name> --no-install` | Prompts run, files copied, `npm install` and `prisma generate` skipped. Consumer must run them later. |
| `<name> --no-prompt` | No prompts, `DEFAULT_CHOICES` applied, dependencies install normally. |
| `<name> --no-prompt --no-install` | Pure file-copy + framework-docs copy with zero network IO. The CI / smoke-test path. |
| `--help` (with or without other args) | Help printed, every other flag ignored, exit 0. |
| (no args) | "Missing project name." printed to stderr, help printed, exit 1. |
| `<name>` where the directory exists | "Target directory already exists: ..." printed to stderr, exit 1. No prompts run, no files written. |

## Exit codes

| Code | Cause |
| --- | --- |
| `0` | Help printed, or scaffold completed end-to-end. A non-zero exit from `npm install` or `npx prisma generate` does NOT change the CLI's overall exit code — those are logged as warnings and the next-step block still prints. |
| `1` | Missing project name; `slugify` produced an empty slug; target directory already exists; `TEMPLATE_DIR` missing at runtime (packaging bug); unexpected exception in `main()` caught by the top-level `.catch`. |
| `2` | Unknown flag passed (any `-`/`--` token not in `VALID_FLAGS`). The parser exits before returning, so nothing downstream runs. |

## Environment variables

`create-luckystack-app` reads **no** environment variables. All input flows through argv and interactive prompts. This is deliberate:

- Avoids the "stray env var on the developer's machine" footgun where an unrelated shell var (e.g. a different `PROJECT_NAME` from another tool) silently changes scaffold output.
- Keeps the smoke-test surface minimal — passing `--no-prompt` is a fully sufficient zero-env invocation.
- Makes the CLI safe to invoke from CI without configuring secrets.

## `printHelp()` output

The verbatim banner that `--help` produces (src/index.ts:166):

```
create-luckystack-app — scaffold a new LuckyStack project

Usage:
  npx create-luckystack-app <project-name> [options]

Options:
  --no-install   Don't run `npm install` or `npx prisma generate` after copying.
  --no-prompt    Skip the interactive prompts and use defaults (Mongo + credentials).
  --help, -h     Show this message.

Example:
  npx create-luckystack-app my-app
  npx create-luckystack-app my-app --no-prompt --no-install
```

The banner is also printed (to stderr, after a "Missing project name." line) when the CLI is invoked with no positional argument. In that case the exit code is 1.

## Future flags under consideration

The current set is the minimum needed to support the interactive flow plus a no-network smoke-test. Flags that have been discussed but are not implemented:

- `--db <provider>` — preset `dbProvider` without prompting.
- `--auth <mode>` — preset `authMode`.
- `--oauth <list>` — comma-joined OAuth providers when `--auth credentials+oauth`.
- `--email <adapter>` — preset email adapter.
- `--monitoring <backend>` — preset monitoring adapter.
- `--no-i18n` — disable the i18n integration.
- `--yes` / `-y` — accept all interactive defaults (currently you achieve this with `--no-prompt`, but `-y` would still print the prompt summary).
- `--template <path>` — point at a non-bundled `template/` directory for fork / dogfooding workflows.

None of these are present today. The reason for the deferral: every new flag is a permanent API surface, and we want to see real consumer feedback before committing to non-interactive presets. `--no-prompt` plus a hand-edited overlay covers the bulk of the use case today.

## Related

- Scaffold flow that consumes `CliArgs`: [`scaffold-flow.md`](./scaffold-flow.md)
- Template variables that are populated regardless of flags: [`template-variables.md`](./template-variables.md)
- Post-scaffold install/print behaviour gated by `--no-install`: [`post-scaffold-suggestions.md`](./post-scaffold-suggestions.md)
