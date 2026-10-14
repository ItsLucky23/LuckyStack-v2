//? Guards the parallel build scripts the scaffold ships (`threadBudget.mjs`,
//? `withThreads.mjs`, `runParallel.mjs`) and the `build`/`verify` scripts that
//? use them, in the framework repo and in the template.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

//? The scripts are plain .mjs without declarations; this is the surface the test uses.
interface ThreadBudgetModule {
  getThreadBudget: () => number;
  splitThreads: (total: number, weights: number[]) => number[];
  threadEnv: (threads: number) => Record<string, string | undefined>;
}
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- untyped .mjs module, shape declared above
const { getThreadBudget, splitThreads, threadEnv } = (await import(
  pathToFileURL(path.join(REPO_ROOT, 'scripts', 'threadBudget.mjs')).href
)) as ThreadBudgetModule;
const TEMPLATE = path.join(REPO_ROOT, 'packages', 'create-luckystack-app', 'template');
const SHIPPED = ['scripts/threadBudget.mjs', 'scripts/withThreads.mjs', 'scripts/runParallel.mjs'];

const scriptsOf = (dir: string): Record<string, string> => {
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
  return pkg.scripts ?? {};
};

//? The quoted task list a `node scripts/runParallel.mjs "a" "b"` script runs at once.
const parallelTasks = (script: string): string[] => {
  const start = script.indexOf('scripts/runParallel.mjs');
  if (start === -1) return [];
  return [...script.slice(start).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => (match[1] ?? '').replace(/^\d+:/, ''));
};

const runNode = (script: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', script), ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

describe('parallel build scripts', () => {
  for (const rel of SHIPPED) {
    it(`${rel} is byte-identical in the template`, () => {
      expect(readFileSync(path.join(TEMPLATE, rel), 'utf8')).toBe(readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
    });
  }

  for (const [label, dir] of [['framework repo', REPO_ROOT], ['template', TEMPLATE]] as const) {
    it(`${label}: the client build and the server bundle never run as separate parallel tasks`, () => {
      //? `vite build` empties dist/ when it writes; a server bundle written by a
      //? concurrent task disappears and `npm run prod` has nothing to run.
      const scripts = scriptsOf(dir);
      for (const name of ['build', 'verify']) {
        const tasks = parallelTasks(scripts[name] ?? '');
        const writers = tasks.filter((task) => task.includes('vite build') || task.includes('bundleServer'));
        expect(writers.length, `${name}: ${JSON.stringify(tasks)}`).toBeLessThanOrEqual(1);
        for (const task of writers) {
          if (task.includes('bundleServer')) expect(task.indexOf('vite build'), name).toBeLessThan(task.indexOf('bundleServer'));
        }
      }
    });

    it(`${label}: TypeScript 7 is called by path, never as a bare tsc`, () => {
      for (const [name, script] of Object.entries(scriptsOf(dir))) {
        expect(/(?:^|[\s"&])tsc(?:\s|$)/.test(script), `${name}: ${script}`).toBe(false);
      }
    });
  }
});

describe('threadBudget', () => {
  const saved = process.env.LUCKYSTACK_MAX_THREADS;
  afterEach(() => {
    if (saved === undefined) Reflect.deleteProperty(process.env, 'LUCKYSTACK_MAX_THREADS');
    else process.env.LUCKYSTACK_MAX_THREADS = saved;
  });

  it('reads LUCKYSTACK_MAX_THREADS and ignores values that are not a positive integer', () => {
    process.env.LUCKYSTACK_MAX_THREADS = '3';
    expect(getThreadBudget()).toBe(3);
    Reflect.deleteProperty(process.env, 'LUCKYSTACK_MAX_THREADS');
    const machine = getThreadBudget();
    expect(machine).toBeGreaterThan(0);
    for (const invalid of ['0', '-2', 'abc', '']) {
      process.env.LUCKYSTACK_MAX_THREADS = invalid;
      expect(getThreadBudget(), invalid).toBe(machine);
    }
  });

  it('splits the budget by weight without exceeding it', () => {
    expect(splitThreads(12, [4, 2, 1, 1, 4])).toEqual([4, 2, 1, 1, 4]);
    expect(splitThreads(10, [1, 1, 1])).toEqual([4, 3, 3]);
    for (const total of [1, 2, 5, 7, 12, 24]) {
      const weights = [4, 2, 1, 4];
      const shares = splitThreads(total, weights);
      const sum = shares.reduce((a, b) => a + b, 0);
      expect(shares.every((share) => share >= 1)).toBe(true);
      expect(sum).toBe(Math.max(total, weights.length));
    }
  });

  it('caps child tools through GOMAXPROCS, RAYON_NUM_THREADS and LUCKYSTACK_MAX_THREADS', () => {
    const env = threadEnv(5);
    expect([env.GOMAXPROCS, env.RAYON_NUM_THREADS, env.LUCKYSTACK_MAX_THREADS]).toEqual(['5', '5', '5']);
  });
});

describe('runParallel.mjs', () => {
  it('runs every task, gives each its thread share and fails when one fails', () => {
    const result = runNode('runParallel.mjs', [
      `3:node -e "console.log('share=' + process.env.GOMAXPROCS)"`,
      `node -e "process.exit(4)"`,
    ], { LUCKYSTACK_MAX_THREADS: '4' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('share=3');
    expect(result.stdout).toContain('1 failed');
  });

  it('exits 0 when every task succeeds and 2 without tasks', () => {
    expect(runNode('runParallel.mjs', ['node -e "0"', 'node -e "0"']).status).toBe(0);
    expect(runNode('runParallel.mjs', []).status).toBe(2);
  });
});

describe('withThreads.mjs', () => {
  it('substitutes {threads}, caps by memory and passes the exit code on', () => {
    const echo = ['node', '-e', 'console.log(process.argv[1]); process.exit(7)', '{threads}'];
    const plain = runNode('withThreads.mjs', echo, { LUCKYSTACK_MAX_THREADS: '3' });
    expect(plain.stdout.trim()).toBe('3');
    expect(plain.status).toBe(7);
    const capped = runNode('withThreads.mjs', ['--mb-per-thread', '100000000', ...echo], { LUCKYSTACK_MAX_THREADS: '3' });
    expect(capped.stdout.trim()).toBe('1');
    expect(runNode('withThreads.mjs', []).status).toBe(2);
  });
});
