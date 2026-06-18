import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT_DIR, tryCatch } from '@luckystack/core';

//? Where the Prisma generator writes its client by default. `prisma generate`
//? emits into `node_modules/.prisma/client` (the engine + generated client),
//? which `@prisma/client` re-exports at runtime. Its presence is the most
//? robust "client has been generated" signal — far more reliable than probing
//? `@prisma/client` itself, which ships an un-generated stub on a fresh install.
const GENERATED_CLIENT_DIR = path.join(ROOT_DIR, 'node_modules', '.prisma', 'client');

//? Default schema location in a scaffolded LuckyStack project. `prisma generate`
//? auto-discovers `prisma/schema.prisma` from the project root, so no explicit
//? `--schema` flag is needed when this path exists.
const DEFAULT_SCHEMA_PATH = path.join(ROOT_DIR, 'prisma', 'schema.prisma');

/**
 * True when a Prisma schema exists in the consumer project but the generated
 * client output is absent — i.e. the consumer has not run `prisma generate`
 * yet. This is the only condition under which we auto-generate (or surface the
 * "run prisma:generate" hint), so an unrelated type-map failure never triggers
 * the Prisma-specific path.
 */
export const isPrismaClientMissing = (): boolean =>
	fs.existsSync(DEFAULT_SCHEMA_PATH) && !fs.existsSync(GENERATED_CLIENT_DIR);

/**
 * Runs `npx prisma generate` once. `prisma generate` only reads the schema —
 * it needs NO database credentials — so this is safe to run on dev boot without
 * any `.env` loading. Resolves to the child's exit code (0 on success). Spawn
 * failures (ENOENT/EACCES) surface through the `tryCatch` tuple, not a throw.
 */
export const runPrismaGenerate = async (): Promise<[Error | null, number | null]> =>
	tryCatch(
		() =>
			new Promise<number>((resolve, reject) => {
				const child = spawn('npx', ['prisma', 'generate'], {
					cwd: ROOT_DIR,
					stdio: 'inherit',
					//? `npx` resolves to `npx.cmd` on Windows, which requires shell
					//? invocation to be found on PATH. Dev-only, fixed argv (no user
					//? input interpolated), so the shell is not an injection surface.
					shell: process.platform === 'win32',
				});
				child.on('error', reject);
				child.on('exit', (code) => { resolve(code ?? 0); });
			}),
	);
