//? Guards the entry-point check that decides whether `main()` runs at all.
//?
//? On macOS/Linux npm installs a bin as a SYMLINK
//? (`node_modules/.bin/create-luckystack-app` → `../create-luckystack-app/dist/
//? index.js`). Node reports the SYMLINK in `process.argv[1]` but resolves
//? `import.meta.url` to the link TARGET, so a raw string comparison of the two
//? is always false there: `npx create-luckystack-app my-app` loaded the module,
//? ran nothing, printed nothing and exited 0. Windows has no symlink (npm writes
//? a `.cmd` shim passing the real path), which is why every local run was green
//? and the Linux CI job had never once passed.
//?
//? A silent exit 0 is the worst possible shape for this failure: it is
//? indistinguishable from success to a human AND to the harness that shells out
//? to it. So the guard is pinned to the symlink case explicitly.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { isCliEntry } from './index.js';

const MODULE_PATH = path.resolve(__dirname, 'index.ts');

//? Windows refuses symlink creation without Developer Mode / elevation. Skip
//? there rather than fail — the platform that needs this assertion (CI on
//? ubuntu, and every macOS/Linux user) always runs it.
const canSymlink = (): boolean => {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-symlink-probe-'));
  try {
    fs.symlinkSync(MODULE_PATH, path.join(probeDir, 'probe.ts'));
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
};

const originalArgv1 = process.argv[1] ?? '';
let tempDir: string | null = null;

afterEach(() => {
  process.argv[1] = originalArgv1;
  if (tempDir !== null) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('isCliEntry', () => {
  it('is false when the module is imported rather than executed', () => {
    process.argv[1] = path.join(os.tmpdir(), 'some-other-runner.js');
    expect(isCliEntry()).toBe(false);
  });

  it('is true when this module is the entry point', () => {
    process.argv[1] = MODULE_PATH;
    expect(isCliEntry()).toBe(true);
  });

  it.skipIf(!canSymlink())('is true when reached through a bin SYMLINK (npm on macOS/Linux)', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-cli-entry-'));
    const link = path.join(tempDir, 'create-luckystack-app');
    fs.symlinkSync(MODULE_PATH, link);

    process.argv[1] = link;
    expect(isCliEntry()).toBe(true);
  });
});
