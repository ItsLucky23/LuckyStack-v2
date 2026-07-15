import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_ENV_FILES, getEnvFiles } from './env';

describe('getEnvFiles', () => {
  const original = process.env.LUCKYSTACK_ENV_FILES;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.LUCKYSTACK_ENV_FILES;
    } else {
      process.env.LUCKYSTACK_ENV_FILES = original;
    }
  });

  it('defaults to .env then .env.local', () => {
    delete process.env.LUCKYSTACK_ENV_FILES;
    expect(getEnvFiles()).toEqual(['.env', '.env.local']);
    expect(DEFAULT_ENV_FILES).toEqual(['.env', '.env.local']);
  });

  it('honors a comma-separated LUCKYSTACK_ENV_FILES override (trimmed, order preserved)', () => {
    process.env.LUCKYSTACK_ENV_FILES = '.env, .env.staging ,.env.local';
    expect(getEnvFiles()).toEqual(['.env', '.env.staging', '.env.local']);
  });

  it('falls back to the default when the override is blank', () => {
    process.env.LUCKYSTACK_ENV_FILES = '   ,  ';
    expect(getEnvFiles()).toEqual(['.env', '.env.local']);
  });
});

//? Bun auto-loads .env files before user code runs, which silently breaks the
//? loader's Node assumptions (see env.ts). The cure is `bunfig.toml` with
//? `env = false`; this guard is the loud fallback for when that file is missing.
//? Verified against real Bun 1.3.14: with auto-load on, `.env.development`'s
//? value for a shared key beats `.env`; with `env = false` the process env is
//? byte-identical to Node's.
describe('Bun env auto-load guard', () => {
  const realEnv = { ...process.env };
  const tempDirs: string[] = [];

  const firstWarning = (warn: ReturnType<typeof vi.fn>): string => String(warn.mock.calls[0]?.[0] ?? '');

  //? The guard is checked at most once per module instance, during the
  //? module-scope `bootstrapEnv()`. So each case builds its world first, then
  //? imports a FRESH copy of env.ts — that import IS the boot under test.
  const bootEnvModule = async (options: {
    files: Record<string, string>;
    preloaded: Record<string, string>;
    onBun: boolean;
  }): Promise<{ warn: ReturnType<typeof vi.fn> }> => {
    const dir = mkdtempSync(path.join(tmpdir(), 'luckystack-env-'));
    tempDirs.push(dir);
    for (const [name, contents] of Object.entries(options.files)) {
      writeFileSync(path.join(dir, name), contents);
    }

    //? `process.cwd()` (not chdir) so the case is independent of the vitest pool.
    //? dotenv resolves its relative `path` against cwd too, so this covers both.
    vi.spyOn(process, 'cwd').mockReturnValue(dir);

    //? Simulates what the runtime handed us before any LuckyStack code ran.
    //? afterEach restores process.env wholesale, so no cleanup is needed here.
    Object.assign(process.env, options.preloaded);

    if (options.onBun) {
      Reflect.set(globalThis, 'Bun', { version: '1.3.14' });
    } else {
      Reflect.deleteProperty(globalThis, 'Bun');
    }

    const warn = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(warn);

    vi.resetModules();
    await import('./env');
    return { warn };
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    Reflect.deleteProperty(globalThis, 'Bun');
    process.env = { ...realEnv };
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('warns when Bun has preloaded an env file the framework is about to load', async () => {
    const { warn } = await bootEnvModule({
      files: { '.env': 'HARNESS_A=from_env\nHARNESS_B=from_env\n' },
      preloaded: { HARNESS_A: 'from_env', HARNESS_B: 'from_env' },
      onBun: true,
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(firstWarning(warn)).toContain('auto-loaded .env');
    expect(firstWarning(warn)).toContain('env = false');
  });

  it('names the mode file Bun loads behind the framework\'s back', async () => {
    const { warn } = await bootEnvModule({
      files: {
        '.env': 'HARNESS_A=from_env\n',
        '.env.development': 'HARNESS_A=from_dev\n',
      },
      //? Mirrors real Bun: .env.development outranks .env for the shared key.
      preloaded: { HARNESS_A: 'from_dev', NODE_ENV: 'development' },
      onBun: true,
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(firstWarning(warn)).toContain('.env.development');
  });

  it('stays silent on Bun when auto-load is disabled (bunfig env = false)', async () => {
    const { warn } = await bootEnvModule({
      files: { '.env': 'HARNESS_A=from_env\n' },
      preloaded: {},
      onBun: true,
    });

    expect(warn).not.toHaveBeenCalled();
  });

  it('stays silent on Node even when a real ambient var matches the file', async () => {
    const { warn } = await bootEnvModule({
      files: { '.env': 'HARNESS_A=from_env\n' },
      preloaded: { HARNESS_A: 'from_env' },
      onBun: false,
    });

    expect(warn).not.toHaveBeenCalled();
  });

  //? The false-positive guard: a Docker/K8s deploy that ambiently overrides SOME
  //? keys must not be mistaken for auto-load. Only an all-keys-identical file is
  //? evidence the runtime preloaded it.
  it('stays silent on Bun when only some keys match ambiently', async () => {
    const { warn } = await bootEnvModule({
      files: { '.env': 'HARNESS_A=from_env\nHARNESS_B=from_env\n' },
      preloaded: { HARNESS_A: 'from_real_ambient' },
      onBun: true,
    });

    expect(warn).not.toHaveBeenCalled();
  });
});
