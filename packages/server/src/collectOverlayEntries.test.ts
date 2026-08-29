import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { collectOverlayEntries } from './bootstrap';

//? What a `luckystack/<pkg>/` folder contributes at boot. The runtime loader
//? and `scripts/bundleServer.mjs` both go through this, so anything asserted
//? here holds for dev AND the production bundle.

let packageDir: string;

const write = (relativePath: string, content = 'export {};\n'): void => {
  const absolute = path.join(packageDir, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
};

beforeEach(() => {
  packageDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'luckystack-overlay-')));
});

afterEach(() => {
  fs.rmSync(packageDir, { recursive: true, force: true });
});

describe('collectOverlayEntries', () => {
  it('loads index first, then the rest alphabetically', () => {
    write('zebra.ts');
    write('index.ts');
    write('alpha.ts');

    expect(collectOverlayEntries(packageDir).fileNames).toEqual(['index.ts', 'alpha.ts', 'zebra.ts']);
  });

  it('excludes test files so they never boot or reach the production bundle', () => {
    write('userAdapter.ts');
    write('userAdapter.tests.ts');
    write('userAdapter.test.ts');
    write('userAdapter.spec.ts');

    expect(collectOverlayEntries(packageDir).fileNames).toEqual(['userAdapter.ts']);
  });

  it('ignores files that are neither .ts nor .js', () => {
    write('userAdapter.ts');
    write('notes.md', '# notes\n');
    write('fixture.json', '{}\n');

    expect(collectOverlayEntries(packageDir).fileNames).toEqual(['userAdapter.ts']);
  });

  it('reports a skipped subdirectory so overlay code parked there is not lost silently', () => {
    write('userAdapter.ts');
    write('helpers/rbac.ts');

    const result = collectOverlayEntries(packageDir);

    //? The walk is flat: `helpers/rbac.ts` would never run. Before this it was
    //? dropped without a word, which is the whole point of surfacing it.
    expect(result.fileNames).toEqual(['userAdapter.ts']);
    expect(result.ignoredDirectoryNames).toEqual(['helpers']);
  });

  it('does not warn about conventional test folders — those SHOULD be ignored', () => {
    write('userAdapter.ts');
    write('__tests__/userAdapter.tests.ts');
    write('__mocks__/redis.ts');

    const result = collectOverlayEntries(packageDir);

    expect(result.fileNames).toEqual(['userAdapter.ts']);
    expect(result.ignoredDirectoryNames).toEqual([]);
  });

  it('handles an empty package folder', () => {
    expect(collectOverlayEntries(packageDir)).toEqual({ fileNames: [], ignoredDirectoryNames: [] });
  });
});
