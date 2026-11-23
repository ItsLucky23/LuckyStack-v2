import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveCommandPath } from './project';

//? Git's own three-way file merge, so `update` needs no merge dependency and
//? merges exactly the way the developer's own `git merge` would. A project
//? without git on PATH simply gets the old full-copy `.new` sidecar.
export type ThreeWayMergeResult =
  | { kind: 'clean'; merged: string }
  | { kind: 'conflict' }
  | { kind: 'unavailable'; reason: string };

//? Apply the change from `basePath` to `freshPath` onto `localPath`, in memory.
//? Nothing is written; the caller decides what to do with a clean result.
export const mergeThreeWay = (localPath: string, basePath: string, freshPath: string): ThreeWayMergeResult => {
  const git = resolveCommandPath('git');
  if (!git) return { kind: 'unavailable', reason: 'git was not found on PATH' };
  //? `-p` prints the result instead of rewriting `localPath`; the exit code is
  //? the number of conflicts (0 = clean), negative on an error.
  const result = spawnSync(git, ['merge-file', '-p', localPath, basePath, freshPath], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) return { kind: 'unavailable', reason: result.error.message };
  if (result.status === 0) return { kind: 'clean', merged: result.stdout };
  if (result.status !== null && result.status > 0 && result.status < 128) return { kind: 'conflict' };
  return { kind: 'unavailable', reason: `git merge-file exited with ${String(result.status)}: ${result.stderr.trim()}` };
};

//? The framework's own change to one file between two versions, as a unified
//? diff with `a/<path>` / `b/<path>` headers so `git apply` can read it.
//? Null when git is missing or the two files are identical.
export const frameworkDiff = (relativePath: string, basePath: string, freshPath: string): string | null => {
  const git = resolveCommandPath('git');
  if (!git) return null;
  //? Diffing copies at `a/<path>` and `b/<path>` puts the project path in the
  //? headers; git would print the absolute temp paths otherwise.
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luckystack-diff-'));
  try {
    const posixPath = relativePath.replaceAll('\\', '/');
    for (const [side, source] of [['a', basePath], ['b', freshPath]] as const) {
      const target = path.join(workDir, side, posixPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
    const result = spawnSync(
      git,
      ['diff', '--no-index', '--no-color', '--no-prefix', '--no-ext-diff', `a/${posixPath}`, `b/${posixPath}`],
      { cwd: workDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    //? `git diff --no-index` exits 1 when the files differ.
    return result.status === 1 && result.stdout.length > 0 ? result.stdout : null;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
};
