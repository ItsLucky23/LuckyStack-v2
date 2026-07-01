/// <reference types="node" />

//? @adr 0017 — this wrapper (and its always-on/commented-block shape) is a
//? deliberate decision; read docs/luckystack/decisions before "simplifying" it.
//? Runs a Prisma CLI command with the project's env FULLY resolved — including
//? @luckystack/secret-manager pointers. `prisma db push` / `migrate` read
//? `url = env("DATABASE_URL")` from schema.prisma; when DATABASE_URL is a
//? secret-manager pointer (`NAME=BASE_V<n>`) the raw pointer string is useless to
//? Prisma, so we resolve it into process.env HERE — exactly like server boot —
//? before spawning prisma. Without secret-manager this is just `loadEnvFiles()`
//? (`.env` + `.env.local`) followed by prisma, i.e. a superset of the old
//? `dotenv -e .env.local -- prisma …`.
//?
//? The secret-resolution block below is COMMENTED until `npx luckystack add
//? secret-manager` (or a `--secret-manager` scaffold) uncomments it — mirroring
//? the identical enable-later block in `server/server.ts`. The two blocks are
//? byte-identical on purpose (the CLI + scaffolder toggle both with the same
//? find/replace); keep them in sync.

import { spawnSync } from 'node:child_process';
import { loadEnvFiles } from '@luckystack/core';

const run = async (): Promise<void> => {
  loadEnvFiles();

  //? Optional @luckystack/secret-manager (opt-in). Resolve `.env` pointers
  //? (NAME=BASE_V<n>) into process.env before prisma reads DATABASE_URL. Enabled
  //? by `luckystack add secret-manager`. See docs/luckystack/ARCHITECTURE_SECRET_MANAGER.md.
  // const projectConfig = (await import('../config')).default;
  // if (projectConfig.secretManager?.url) {
  //   const sm = await import('@luckystack/secret-manager');
  //   await sm.initSecretManager({ ...projectConfig.secretManager, source: 'remote' });
  // }

  const result = spawnSync('prisma', process.argv.slice(2), {
    stdio: 'inherit',
    env: process.env,
    shell: true,
  });
  if (result.error) console.error(result.error);
  process.exit(result.status ?? 1);
};

void run();
