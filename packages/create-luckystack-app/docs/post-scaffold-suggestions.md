# Post-Scaffold Suggestions

What the CLI does after the file copy finishes, and what AI agents working in a freshly-scaffolded LuckyStack project should suggest as follow-up steps.

## Two post-copy spawns

When `--no-install` is NOT passed, `main()` runs two child processes in sequence after `copyTree` and the framework-docs copy.

### `runNpmInstall(cwd)` (src/index.ts:261)

```ts
const runNpmInstall = (cwd: string): void => {
  console.log('\nInstalling dependencies (this may take a minute)...\n');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmCmd, ['install'], { cwd, stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    console.error('\n[create-luckystack-app] npm install failed. You can run it manually in the project directory.');
  }
};
```

Key choices:

- **`npm.cmd` on Windows.** Without the `.cmd` suffix `spawnSync` cannot resolve npm on Windows because npm is shipped as a shell shim, not a real executable.
- **`stdio: 'inherit'`.** The consumer sees real npm progress (download counters, peer warnings, audit summary). This is critical UX — `npm install` is slow enough that a silent stall would look like a hang.
- **`shell: false`.** Avoids shell-injection vectors from the project name. The slug has already been validated against `[a-z0-9-]`, but defence-in-depth.
- **Non-zero exit logs a hint and continues.** The function does not throw. The scaffold has already produced a valid project tree, so a failed install is something the consumer can retry without re-scaffolding.

### `runPrismaGenerate(cwd)` (src/index.ts:274)

```ts
const runPrismaGenerate = (cwd: string): void => {
  console.log('\nGenerating Prisma client...\n');
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(npxCmd, ['prisma', 'generate'], { cwd, stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    console.error('\n[create-luckystack-app] `npx prisma generate` failed. Run it manually after setting DATABASE_URL.');
  }
};
```

Why **only** `prisma generate`, not `prisma db push` or `prisma migrate dev`:

- `prisma generate` reads the schema file and emits TypeScript types — it does NOT connect to the database. Safe to run without any `DATABASE_URL`.
- `prisma db push` and `prisma migrate dev` both connect to a live database. The consumer has not populated `.env.local` yet, so they would fail with an unhelpful "cannot reach database" error and that would be the first thing the consumer sees after scaffolding. Bad first impression.
- The next-steps block tells the consumer to run one of those commands manually once they have a `DATABASE_URL`. The output is also DB-specific (`prisma:db:push` for Mongo vs `prisma:migrate:dev` for SQL).

## Final "Next steps" block

After both spawns complete (or after the `Skipped npm install (--no-install).` log if installation was skipped), `main()` prints the closing banner verbatim:

```
Done — scaffold complete.

Choices:
  database:    <choices.dbProvider>
  auth:        <choices.authMode>[ (<oauthProviders comma-joined>)]
  email:       <choices.emailProvider>
  monitoring:  <choices.monitoringProvider>
  i18n:        on|off

Next steps:
  cd <project-name>
  cp .env_template .env
  cp .env.local_template .env.local   # fill in DATABASE_URL, etc.
  <db-specific>
  npm run server                       # starts the dev server

Docs:
  https://github.com/ItsLucky23/LuckyStack-v2#readme
```

The `<db-specific>` line resolves to:

- `npm run prisma:db:push           # initializes the Mongo schema` when `dbProvider === 'mongodb'`.
- `npm run prisma:migrate:dev       # creates the User table + initial migration` for every SQL provider (postgresql, mysql, sqlite).

Mongo gets `db push` because the Mongo Prisma flow does not produce migrations — it idempotently pushes the schema. SQL stacks use `migrate dev` so the consumer gets an initial timestamped migration in `prisma/migrations/`.

### Why the choices summary is re-printed

`runPrompts` is a fast interactive flow. By the time the user is staring at the final banner, they have already scrolled past their own answers in the terminal. Echoing the resolved choices at the end gives them one last chance to spot a wrong answer before they start editing files. Cheap to print, valuable for trust.

### What is deliberately NOT in the next-steps block

- **No automatic `git init`.** Some users scaffold inside an existing monorepo where a new `.git` directory would conflict. The consumer decides.
- **No automatic `npm run server`.** A blocking long-running process at the end of a scaffold hangs CI and prevents the user from doing the prerequisite `.env.local` edits.
- **No automatic browser open.** Same reason — premature and assumes a desktop environment.
- **No automatic editor open.** Editor choice is too personal to assume.

## Suggestions an AI assistant should make AFTER scaffold

Once the CLI exits cleanly, an AI agent attached to the freshly-scaffolded directory should walk the consumer through:

1. **Read the just-copied framework docs.**
   - Root `CLAUDE.md` — project-wide AI rules. Loaded automatically by Claude Code.
   - `docs/luckystack/DEVELOPER_GUIDE.md` — how to add a page, an API endpoint, a sync handler.
   - `docs/luckystack/ARCHITECTURE_PACKAGING.md` — the `luckystack/` overlay folder convention and `bootstrapLuckyStack`.
   - `docs/luckystack/ARCHITECTURE_*.md` — pick the doc that matches the feature the user is about to touch (API, auth, session, sync, socket, email, hosting).

2. **Fill `.env.local` with real secrets.**
   - `DATABASE_URL` — connection string for the selected `dbProvider`.
   - `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` if applicable.
   - OAuth client IDs / secrets for every entry in `choices.oauthProviders`.
   - `EMAIL_*` keys for `resend` or `smtp` when those adapters were picked.
   - `SENTRY_DSN` / `DATADOG_API_KEY` / `POSTHOG_KEY` when monitoring is wired.

3. **Run the database initialization step that the next-steps block printed.**
   - The consumer cannot start the server before this — Prisma needs the schema either pushed or migrated.

4. **Configure per-package opt-ins in the `luckystack/` overlay folder.**
   - `luckystack/login/oauthProviders.ts` — add provider client IDs.
   - `luckystack/login/userAdapter.ts` — extend the default Prisma adapter when the User model gets custom fields.
   - `luckystack/core/clients.ts` — override Redis / Prisma client wiring if needed.
   - `luckystack/server/index.ts` — bootstrap entry where adapters get injected.

5. **Start the dev server.** `npm run server` in one terminal. The Vite client proxy is already wired into `vite.config.ts`.

6. **Optional: initialise a git repo.** `git init && git add . && git commit -m "scaffold"`. The template ships a `.gitignore` (via the `_dot_` rename) so secrets are not accidentally committed.

## Failure-mode handling

The scaffold is not transactional:

- If `copyTree` partially completes and throws, the target directory is left with whatever files were written. The consumer is expected to delete it and retry. We do not roll back.
- If `runNpmInstall` exits non-zero, the directory is fully populated; only the `node_modules/` is missing. The consumer can run `npm install` manually inside the project. Same for `runPrismaGenerate`.
- If the consumer hits Ctrl-C during prompts, the readline interface is closed in `finally`, but no files have been written yet (prompts run before `copyTree`). Safe to retry.
- If the consumer hits Ctrl-C during `runNpmInstall`, npm itself handles cleanup. The target directory remains; retrying the install is safe.

## Related

- The two spawn helpers and the final banner all live inline in `src/index.ts`. There are no separate exports.
- Flag that disables this entire section: `--no-install` (see [`cli-flags.md`](./cli-flags.md)).
- Scaffold flow that leads up to these spawns: [`scaffold-flow.md`](./scaffold-flow.md).
- Framework docs the consumer should read first: [`framework-docs-copy.md`](./framework-docs-copy.md).
