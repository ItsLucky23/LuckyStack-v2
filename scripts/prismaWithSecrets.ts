/// <reference types="node" />

//? @adr 0017 — this wrapper (and its always-on shape) is a deliberate decision;
//? read docs/decisions/0017 before "simplifying" the indirection away.
//? Runs a Prisma CLI command with the project's env FULLY resolved — including
//? @luckystack/secret-manager pointers. `prisma db push` / `migrate` read
//? `url = env("DATABASE_URL")` from schema.prisma; when DATABASE_URL is a
//? secret-manager pointer (`NAME=BASE_V<n>`) the raw pointer string is useless to
//? Prisma, so we resolve it into process.env HERE — via the same boot seam
//? server/server.ts uses — before spawning prisma. Without a configured
//? secret-manager URL this is just `loadEnvFiles()` (`.env` + `.env.local`)
//? followed by prisma, i.e. a superset of the old `dotenv -e .env.local`.

import { spawnSync } from 'node:child_process';
import { loadEnvFiles } from '@luckystack/core';

const run = async (): Promise<void> => {
  loadEnvFiles();
  const projectConfig = (await import('../config')).default;
  const { resolveSecretsIfConfigured } = await import('../server/bootstrap/initSecrets');
  await resolveSecretsIfConfigured(projectConfig.secretManager);

  const result = spawnSync('prisma', process.argv.slice(2), {
    stdio: 'inherit',
    env: process.env,
    shell: true,
  });
  if (result.error) console.error(result.error);
  process.exit(result.status ?? 1);
};

void run();
