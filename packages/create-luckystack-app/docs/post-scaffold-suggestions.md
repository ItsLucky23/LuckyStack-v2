# Post-Scaffold Suggestions

What the CLI does after copying files, and what an AI assistant should suggest in a freshly-scaffolded
LuckyStack project.

## Post-copy steps

When `--no-install` is not passed, `main()` runs the selected package-manager install and then the relevant
ORM generation step. The exact choice is stored in `.luckystack/scaffold.json` so `luckystack update` can
re-render the same framework surface later.

### Package-manager install

The scaffold supports npm and Bun. The selected manager installs the generated project dependencies. A
non-zero exit leaves the complete project tree in place and prints a manual retry hint; it does not require
re-scaffolding.

### ORM generation

- **Prisma:** runs `npx prisma generate` after installation. This reads the schema and emits types without
  connecting to the database. It deliberately stays on `npx` even in a Bun project because the Bun-forced
  `prisma generate` path has a known Windows hang.
- **Drizzle:** installs the selected driver/tooling but does not run a database migration automatically.
- **MikroORM:** installs the selected driver/tooling; schema updates are run explicitly with the generated
  project command.
- **`none`:** no ORM generation runs. The consumer supplies the database/client registration when needed.

Database push/migration commands are never run automatically because they require a configured live
`DATABASE_URL` and are data-changing operations.

## Final next-steps block

The CLI prints the resolved choices and tells the consumer to:

1. enter the generated directory;
2. copy `.env_template` and `.env.local_template` as appropriate;
3. fill real secrets and connection settings;
4. run the database initialization command for the selected ORM/provider;
5. start `npm run server` and `npm run client` (or the equivalent Bun command).

The exact database command is ORM-specific and is generated from the selected choices. No database write,
server start, browser launch, editor launch, or `git init` happens automatically.

## Suggestions an AI assistant should make after scaffolding

1. Read the copied framework contract and targeted deep dive:
   - root `CLAUDE.md` — project-wide AI rules;
   - `docs/luckystack/DEVELOPER_GUIDE.md` — day-one workflow;
   - `docs/luckystack/ARCHITECTURE_PACKAGING.md` — package boundaries and consumer update path;
   - the relevant API, sync, auth, session, socket, hosting, or multi-instance document.
2. Fill `.env.local` with real secrets and selected database/Redis settings.
3. Run the generated ORM initialization command after verifying the target database.
4. Configure per-package adapters in `luckystack/` only where the selected feature needs customization.
5. Start the development server and client.
6. Commit the fresh project once the generated files and initial configuration are reviewed.

## Updating a consumer later

After upgrading the installed `@luckystack/*` packages, run:

```bash
npx luckystack update
```

The update command refreshes framework-owned files such as `CLAUDE.md`, `docs/luckystack/`, skills,
commands, generators, and templates. Pristine files are overwritten with the matching new render; modified
files receive `.new` sidecars and are never overwritten automatically. Use `npx luckystack update --app`
only when deliberately adopting framework-owned app assets as well.

## Related

- Scaffold flow: [`scaffold-flow.md`](./scaffold-flow.md).
- Framework-doc copy: [`framework-docs-copy.md`](./framework-docs-copy.md).
- CLI flags: [`cli-flags.md`](./cli-flags.md).
