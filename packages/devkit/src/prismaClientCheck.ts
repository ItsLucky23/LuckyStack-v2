import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT_DIR, tryCatch } from '@luckystack/core';

//? Where the Prisma generator writes its client by default: `node_modules/.prisma/
//? client`. The DIRECTORY existing is NOT proof of generation — `@prisma/client`'s
//? own postinstall writes an un-generated STUB there on a plain `npm install` (a
//? throwing `PrismaClient` + no model types, no schema, no query engine). So we
//? probe a marker that ONLY a real `prisma generate` produces: it copies the
//? schema into the output dir as `.prisma/client/schema.prisma` (absent in the
//? stub). That distinguishes "generated" from "stub-only".
const GENERATED_CLIENT_DIR = path.join(ROOT_DIR, 'node_modules', '.prisma', 'client');
const GENERATED_CLIENT_MARKER = path.join(GENERATED_CLIENT_DIR, 'schema.prisma');

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
	fs.existsSync(DEFAULT_SCHEMA_PATH) && !fs.existsSync(GENERATED_CLIENT_MARKER);

/**
 * Runs `prisma generate` once. `prisma generate` only reads the schema —
 * it needs NO database credentials — so this is safe to run on dev boot without
 * any `.env` loading. Resolves to the child's exit code (0 on success). Spawn
 * failures (ENOENT/EACCES) surface through the `tryCatch` tuple, not a throw.
 *
 * Uses the local `node_modules/.bin/prisma` binary directly (shell: false) to
 * avoid shell invocation on Windows. Falls back to `npx prisma` with
 * shell: false when the local binary is absent (e.g. prisma not yet installed).
 */
export const runPrismaGenerate = async (): Promise<[Error | null, number | null]> =>
	tryCatch(
		() =>
			new Promise<number>((resolve, reject) => {
				//? Prefer the local binary over `npx` — avoids shell invocation on
				//? Windows and is faster (no npx resolution overhead). On Windows the
				//? `.cmd` wrapper is what `PATH` resolves to from cmd.exe, but spawn
				//? with shell:false needs the real script path, not the .cmd shim.
				//? The actual JS CLI lives at `node_modules/prisma/build/index.js`
				//? but the cross-platform entry is the `.bin` shim.
				const localBinName = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
				const localBin = path.join(ROOT_DIR, 'node_modules', '.bin', localBinName);
				const useLocal = fs.existsSync(localBin);

				//? shell: false in both branches — argv is fully static (no user input).
				const [cmd, args] = useLocal
					? [localBin, ['generate']]
					: [process.platform === 'win32' ? 'npx.cmd' : 'npx', ['prisma', 'generate']];

				const child = spawn(cmd, args, {
					cwd: ROOT_DIR,
					stdio: 'inherit',
					shell: false,
				});
				child.on('error', reject);
				child.on('exit', (code) => { resolve(code ?? 0); });
			}),
	);
