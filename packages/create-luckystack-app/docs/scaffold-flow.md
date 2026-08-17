# Scaffold Flow

End-to-end behavior of `create-luckystack-app`, from argv parsing to the final next-steps banner. Source of truth: `src/index.ts` and `src/scaffoldManifest.ts`.

## High-level sequence

```text
parseArgs
  -> validate project slug + safe fresh target
  -> resolve choices (TTY wizard or defaults + flags)
  -> read create-app's own version
  -> build project/provider/Docker template variables
  -> copy bundled template with placeholder rendering
  -> inject selected SDK/package dependencies
  -> prune deselected features and auth/router surfaces
  -> apply selected ORM + optional-package wiring
  -> wire package-manager metadata
  -> optionally copy AI context + MCP/browser tooling
  -> write .luckystack/scaffold.json with rendered-file hashes
  -> selected package-manager install
  -> Prisma generate only when ORM=prisma
  -> print choices + ORM-specific next steps
```

A thrown scaffold-time error triggers best-effort removal of the directory created by that run. A pre-existing target is never touched.

## 1. Parse and validate

`parseArgs(process.argv.slice(2))` is strict:

- exact bare toggles and validated `--key=value` choices;
- first non-flag token becomes the project-name source;
- unknown/invalid flags exit 2;
- `--help` prints help and exits cleanly.

`validateArgsOrExit` then:

1. requires a project name;
2. derives the ASCII kebab-case slug;
3. resolves the target from that sanitized slug (not the raw argument);
4. verifies it remains inside the current directory;
5. rejects an existing target;
6. verifies the packaged `template/` directory exists.

## 2. Resolve choices

### Interactive TTY

`runPrompts(presets)` presents an arrow-key wizard with progress, details toggles, conditional steps, and a final review/edit screen. Supplied CLI flags pre-fill their matching steps.

The logical order is:

1. ORM/data layer;
2. compatible database provider;
3. auth mode;
4. OAuth providers when applicable;
5. email adapter;
6. monitoring backend;
7. presence;
8. error-tracking layer;
9. docs UI;
10. secret manager;
11. router;
12. cron;
13. AI instructions;
14. browser tooling when AI instructions are on;
15. package manager.

### Non-TTY fallback

`runPromptsFallback` uses numbered readline prompts and the same normalization/conversion logic. Unrecognized values warn and fall back rather than silently changing a choice.

### `--no-prompt`

`buildNoPromptChoices` overlays explicit flags on `DEFAULT_CHOICES` and enforces the same cross-field invariants. See [`cli-flags.md`](./cli-flags.md).

## 3. Render the base template

`copyTree(template, target, vars)` recursively:

- rewrites `_dot_` in destination names to `.`;
- skips symlinks;
- renders known text formats with `replacePlaceholders`;
- byte-copies binary files.

Text detection includes TypeScript/JavaScript/JSON/Markdown/CSS/HTML/Prisma/YAML/shell/nginx extensions, dotfiles, and `Dockerfile`.

Every base template contains the complete feature surface. Subsequent transformations remove or adapt files so each resolved choice produces a buildable project rather than merely an over-installed one.

## 4. Apply feature and data-layer choices

The transformation order matters:

1. **`injectOptionalDeps`** adds selected email, monitoring, docs UI, secret-manager, cron, and related SDK dependencies at the current lockstep version.
2. **`pruneOptionalPackages`** removes deselected presence/error-tracking/docs-ui/router surfaces and handles auth-off.
3. **Non-Prisma ORM adaptation:**
   - strips Prisma schema/dependencies/scripts and Prisma-bound imports;
   - Drizzle writes `server/db/schema.ts`, `drizzle.config.ts`, a live `functions/db.ts`, driver dependencies, and `db:*` scripts;
   - MikroORM writes EntitySchema/config/client files and the programmatic `db:schema:update` script;
   - `none` leaves explicit bring-your-own `functions/db.ts` and core-client registration stubs.
4. **Auth + Drizzle/MikroORM** keeps adapter-driven login/register/reset flows, writes a starter `luckystack/login/userAdapter.ts`, and prunes only Prisma-bound settings/notification surfaces. The developer must finish that adapter before sign-in works.
5. **Secret manager** uncomments its config/server bootstrap seams.
6. **Presence** flips the client/server gates that would otherwise leave the installed package dormant.
7. **Router** keeps topology files, adds its script/dependency, and switches typed invocation to routed HTTP/SSE.
8. **Package manager** writes a stable Bun `packageManager` field when selected; npm retains ecosystem-default metadata.

Provider-aware Dockerfile, Compose, nginx, health, non-root, Redis, database, and optional-router assets are rendered for every scaffold.

## 5. Copy optional AI context

When `aiInstructions=true`, `copyAiDocs` copies five bundled source groups:

- root `CLAUDE.md`;
- framework `docs/` into `docs/luckystack/`;
- `skills/`;
- `.claude/commands/`;
- the branch-log convention README.

It also installs the AI-index pre-commit hook and configures `@luckystack/mcp`. Dated framework finding runs are stripped while the findings protocol/index remain. Browser tooling is then wired according to `aiBrowserTooling`.

See [`framework-docs-copy.md`](./framework-docs-copy.md).

## 6. Write the scaffold manifest

The last file-producing step before installation is `.luckystack/scaffold.json`:

```ts
interface ScaffoldManifest {
  schemaVersion: 1;
  luckystackVersion: string;
  createdAt: string;
  projectName: string;
  choices: Record<string, unknown>;
  files: Array<{ path: string; sha256: string }>;
}
```

Hashes cover rendered scaffold files with CRLF normalized for text. `node_modules`, `.git`, `.env`, `.env.local`, `.secret-manager-token`, and the manifest itself are excluded. `luckystack update` uses this baseline to overwrite pristine framework files while placing changed replacements beside user-modified files as `.new` sidecars.

## 7. Install and generate

Unless `--no-install`:

- `runNpmInstall(targetDir, packageManager)` resolves npm or Bun from absolute `PATH` entries and runs `<manager> install` with Windows-safe command-shim handling;
- for Prisma only, `runPrismaGenerate` resolves `npx` and runs `npx prisma generate`;
- Drizzle, MikroORM, and `none` do not mutate a database during scaffolding.

Install/generation failure prints a manual retry hint. It does not delete an otherwise complete project or run schema changes automatically.

## 8. Final next steps

The banner reports every resolved choice and an ORM-specific command:

| ORM | Suggested initialization |
| --- | --- |
| Prisma + MongoDB | `npm run prisma:db:push` |
| Prisma + SQL | `npm run prisma:migrate:dev` |
| Drizzle | `npm run db:push` |
| MikroORM | `npm run db:schema:update` |
| none | Wire the project-owned data layer first |

It also reminds the developer to create `.env`/`.env.local`, start backend and frontend in separate terminals, and finish any selected non-Prisma auth adapter.

## Fresh-checkout testability

The template ships its artifact generators and `npm run test` chains `generateArtifacts` before the test runner. Router-free projects remove the preset loader and use the default-bundle path; routed projects retain the topology/preset loader.

## Related

- [`cli-flags.md`](./cli-flags.md)
- [`template-variables.md`](./template-variables.md)
- [`framework-docs-copy.md`](./framework-docs-copy.md)
- [`post-scaffold-suggestions.md`](./post-scaffold-suggestions.md)
