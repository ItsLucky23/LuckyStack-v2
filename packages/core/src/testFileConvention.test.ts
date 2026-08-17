import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isTestFile, isTestDirectory, TEST_FILE_PATTERN } from './testFileConvention';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

//? The two server bundlers are plain `.mjs` build scripts that must run on a
//? fresh checkout, BEFORE `@luckystack/core` has a dist to import. They
//? therefore carry an inline copy of this pattern as a fallback. That copy is
//? exactly the kind of duplicate that silently drifts — a hardcoded overlay
//? list in the same file once dropped the `cron` slot from production — so pin
//? it here, the same way OVERLAY_ORDER is pinned.
const BUNDLERS = [
  'scripts/bundleServer.mjs',
  'packages/create-luckystack-app/template/scripts/bundleServer.mjs',
];

describe('isTestFile', () => {
  it('matches the test suffixes a runner would pick up', () => {
    for (const name of [
      'db.tests.ts', 'db.test.ts', 'db.spec.ts',
      'db.tests.tsx', 'db.test.js', 'db.spec.mjs', 'db.test.cjs', 'db.tests.mts',
    ]) {
      expect(isTestFile(name), name).toBe(true);
    }
  });

  it('does not match ordinary runtime modules', () => {
    for (const name of [
      'db.ts', 'index.ts', 'testHelpers.ts', 'latest.ts', 'manifest.ts',
      'contest.ts', 'spec.ts', 'my.tests.json',
    ]) {
      expect(isTestFile(name), name).toBe(false);
    }
  });

  it('examines only the last path segment', () => {
    expect(isTestFile('luckystack/login/db.tests.ts')).toBe(true);
    expect(isTestFile('some.tests.dir/db.ts')).toBe(false);
    expect(isTestFile('some.tests.dir\\db.ts')).toBe(false);
  });
});

describe('isTestDirectory', () => {
  it('recognises the conventional test folders', () => {
    expect(isTestDirectory('__tests__')).toBe(true);
    expect(isTestDirectory('__mocks__')).toBe(true);
  });

  it('leaves ordinary folders alone', () => {
    expect(isTestDirectory('helpers')).toBe(false);
    expect(isTestDirectory('tests')).toBe(false);
  });
});

describe('bundler fallback parity', () => {
  for (const relativePath of BUNDLERS) {
    it(`${relativePath} inlines the same pattern as core`, () => {
      const source = fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
      const match = /const FALLBACK_TEST_FILE_PATTERN = (\/.*\/[a-z]*);/.exec(source);

      expect(match, 'FALLBACK_TEST_FILE_PATTERN not found — did the bundler stop guarding this?').toBeTruthy();
      expect(match?.[1]).toBe(TEST_FILE_PATTERN.toString());
    });
  }
});
