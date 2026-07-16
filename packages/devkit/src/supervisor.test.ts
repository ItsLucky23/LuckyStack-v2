import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import type { ResolveChildSpawnInput } from './supervisor';

//? Guard for the stale-env bug (2026-06-10): the supervisor process must NEVER
//? import @luckystack/core — core runs `bootstrapEnv()` as an import side-effect,
//? which merges `.env` into the supervisor's process.env. The child inherits
//? that env and its own `.env` load uses `override: false`, so inherited stale
//? values would win over freshly edited file values on every restart. The
//? original ambientEnvSnapshot workaround silently broke when tsup inlined the
//? snapshot module into the entry body (ESM imports are hoisted), so we now
//? assert the invariant at both the source and bundle level.
const here = path.dirname(fileURLToPath(import.meta.url));

describe('supervisor env hygiene', () => {
  it('src/supervisor.ts imports nothing from @luckystack/core', () => {
    const source = readFileSync(path.join(here, 'supervisor.ts'), 'utf8');
    expect(source).not.toMatch(/from '@luckystack\/core'/);
  });

  const distPath = path.join(here, '..', 'dist', 'supervisor.js');
  it.skipIf(!existsSync(distPath))('dist/supervisor.js bundles no @luckystack/core import', () => {
    const bundle = readFileSync(distPath, 'utf8');
    expect(bundle).not.toContain('@luckystack/core');
  });
});

//? Guard for the silent-Node bug (2026-07-15): on Windows npm generates a
//? `.cmd` bin shim that hardcodes `node`, so `bun run server` launches NODE
//? while looking completely green. The supervisor detects the `bun run` launch
//? via the fingerprints Bun leaves (`npm_config_user_agent` / `npm_execpath`)
//? and re-execs the CHILD through the real bun binary. These cases pin the
//? resolution table so a regression cannot silently reinstate Node-in-disguise.
describe('resolveChildSpawn — runtime honouring', () => {
  //? Imported lazily behind the import-only flag: this module is an ENTRY and
  //? would otherwise boot a real server (spawn + chokidar) on import.
  let resolveChildSpawn: typeof import('./supervisor').resolveChildSpawn;

  beforeAll(async () => {
    process.env.LUCKYSTACK_SUPERVISOR_IMPORT_ONLY = 'true';
    ({ resolveChildSpawn } = await import('./supervisor'));
  });

  const BUN_BINARY = String.raw`C:\tools\bun\bun.exe`;
  const NODE_BINARY = String.raw`C:\Program Files\nodejs\node.exe`;
  const TSX_CLI = String.raw`C:\proj\node_modules\tsx\dist\cli.mjs`;
  const ENTRY = String.raw`C:\proj\server\server.ts`;

  const baseInput = (overrides: Partial<ResolveChildSpawnInput> = {}): ResolveChildSpawnInput => ({
    isBun: false,
    execPath: NODE_BINARY,
    npmUserAgent: 'npm/11.6.1 node/v22.14.0 win32 x64 workspaces/false',
    npmExecPath: String.raw`C:\Users\x\AppData\Roaming\npm\node_modules\npm\bin\npm-cli.js`,
    tsxCliPath: TSX_CLI,
    tsconfigServerArgs: ['--tsconfig', 'tsconfig.server.json'],
    entry: ENTRY,
    fileExists: () => true,
    ...overrides,
  });

  it('`npm run server` keeps the canonical Node + tsx path', () => {
    const result = resolveChildSpawn(baseInput());
    expect(result).toEqual({
      ok: true,
      spec: {
        command: NODE_BINARY,
        args: [TSX_CLI, '--tsconfig', 'tsconfig.server.json', ENTRY],
        runtime: 'node',
      },
    });
  });

  it('`bun run server` (Windows .cmd shim => we are Node) re-execs the child through bun', () => {
    const result = resolveChildSpawn(
      baseInput({
        //? Exactly what bun 1.3.14 sets while still handing off to Node.
        npmUserAgent: 'bun/1.3.14 npm/? node/v24.3.0 win32 x64',
        npmExecPath: BUN_BINARY,
      }),
    );
    expect(result).toEqual({
      ok: true,
      spec: { command: BUN_BINARY, args: ['--bun', 'run', ENTRY], runtime: 'bun' },
    });
  });

  it('never silently serves from Node once a bun launch is detected', () => {
    const result = resolveChildSpawn(
      baseInput({ npmUserAgent: 'bun/1.3.14 npm/? node/v24.3.0 win32 x64', npmExecPath: BUN_BINARY }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.runtime).toBe('bun');
    expect(result.spec.command).not.toContain('node');
    //? tsx must be gone: Bun compiles TypeScript natively, and `--tsconfig` is
    //? not a Bun flag.
    expect(result.spec.args).not.toContain(TSX_CLI);
    expect(result.spec.args).not.toContain('--tsconfig');
  });

  it('detects a bun launch from npm_execpath even when the user agent is absent', () => {
    const result = resolveChildSpawn(baseInput({ npmUserAgent: undefined, npmExecPath: BUN_BINARY }));
    expect(result.ok && result.spec.runtime).toBe('bun');
  });

  it('already running under Bun spawns execPath directly, without tsx', () => {
    //? Under `bun --bun run server` process.execPath is the node-shim Bun injects
    //? at %TEMP%\bun-node-<hash>\node.exe — it re-enters Bun, so spawning it is
    //? correct and keeps the child on Bun.
    const bunNodeShim = String.raw`C:\Users\x\AppData\Local\Temp\bun-node-0d9b296af\node.exe`;
    const result = resolveChildSpawn(
      baseInput({ isBun: true, execPath: bunNodeShim, npmExecPath: BUN_BINARY }),
    );
    expect(result).toEqual({
      ok: true,
      spec: { command: bunNodeShim, args: [ENTRY], runtime: 'bun' },
    });
  });

  it('fails LOUD when a bun launch is detected but the bun binary is missing', () => {
    const result = resolveChildSpawn(
      baseInput({
        npmUserAgent: 'bun/1.3.14 npm/? node/v24.3.0 win32 x64',
        npmExecPath: BUN_BINARY,
        fileExists: () => false,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    //? The message must name the refusal, not just the miss — this is the whole
    //? point of the branch.
    expect(result.message).toMatch(/refusing to silently fall back to node/i);
  });

  it('passes an ABSOLUTE entry to `bun run` so it can never resolve as a script name', () => {
    //? `bun run <name>` prefers a package.json SCRIPT over a file. A relative
    //? `server/server.ts` could re-enter the `server` script => fork bomb.
    const result = resolveChildSpawn(
      baseInput({ npmUserAgent: 'bun/1.3.14 npm/? node/v24.3.0 win32 x64', npmExecPath: BUN_BINARY }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const passedEntry = result.spec.args.at(-1) ?? '';
    //? This case intentionally simulates the Windows `.cmd` shim even when the
    //? suite itself runs on Linux CI, so parse the fixture with Windows semantics.
    expect(path.win32.isAbsolute(passedEntry)).toBe(true);
  });

  it('omits the tsconfig args on the Node path when no server tsconfig exists', () => {
    const result = resolveChildSpawn(baseInput({ tsconfigServerArgs: [] }));
    expect(result).toEqual({
      ok: true,
      spec: { command: NODE_BINARY, args: [TSX_CLI, ENTRY], runtime: 'node' },
    });
  });
});
