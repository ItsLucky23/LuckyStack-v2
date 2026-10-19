//? Review 1 finding 2: the settings handlers wrote the session back after an
//? awaited DB update without `onlyIfExists`, so a logout or revoke that landed
//? in between was undone. The handlers are not compiled or run inside this
//? package, so these checks pin every shipped copy (reference app, scaffold
//? template, `add login` asset) in its source.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const SETTINGS_API_DIRS = [
  path.join(repoRoot, 'src', 'settings', '_api'),
  path.join(repoRoot, 'packages', 'create-luckystack-app', 'template', 'src', 'settings', '_api'),
  path.join(repoRoot, 'packages', 'cli', 'assets', 'login', 'src', 'settings', '_api'),
];
const HANDLERS = ['updateUser_v1.ts', 'updatePreferences_v1.ts'];

describe.each(SETTINGS_API_DIRS)('settings session write-back: %s', (dir) => {
  it.each(HANDLERS)('%s only updates a session that still exists and reports a vanished one', (file) => {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    const calls = [...source.matchAll(/functions\.session\.saveSession\(([^;]*)\);/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call[1]).toMatch(/undefined, \{ onlyIfExists: true \}$/);
    }
    expect(source).toContain(`if (!saved.ok) return { status: 'error', errorCode: saved.errorCode };`);
  });
});
