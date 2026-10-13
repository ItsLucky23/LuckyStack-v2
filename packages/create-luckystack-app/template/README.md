# {{PROJECT_TITLE}}

Generated with [LuckyStack](https://github.com/ItsLucky23/LuckyStack-v2). This starter is yours to edit; the framework packages can be upgraded independently.

## Get started

```bash
cp .env_template .env
cp .env.local_template .env.local
# Set your local database and selected integration credentials in .env.local.
{{PRISMA_INIT_CMD}}
npm run server # terminal 1
npm run client # terminal 2
```

Before using auth with a non-Prisma data layer, finish the scaffolded user adapter; installing login does not make that starter functional.

Follow the generated package scripts for your selected data layer; if the scaffold was run with `--no-install`, install dependencies first. Never commit `.env.local` or copy secret values into reports. Open the frontend URL shown by the client command.

## Make it yours

Replace the sample page content and fill in `docs/PRODUCT.md` with what this application is for and who uses it. Add any new page intent beside the page. The selected features and their configuration live in your source and installed package types; this README is not a second inventory. Run `npm run generateArtifacts` after adding routes if your development setup has not already regenerated route types.

For the design behind routing, auth, packages and generated artifacts, consult `docs/luckystack/`. For existing-project framework copy updates, run `npx luckystack update` after upgrading packages and inspect `.new` sidecars before adopting changes.
