import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConsumerProject } from '../lib/project';
import { detectProjectState } from '../lib/state';
import { configFromState, planChanges } from '../transitions';
import { addLogin } from './addLogin';
import { LOGIN_COPIED_PATHS } from './remove';

describe('addLogin locale-key hint', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-add-login-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const project = (): ConsumerProject => {
    const pkg = { name: 'app', dependencies: { '@prisma/client': '^6.0.0' } };
    const pkgPath = path.join(root, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify(pkg));
    return { root, pkg, pkgPath };
  };

  const logged = (): string[] => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => { lines.push(String(line)); });
    vi.spyOn(console, 'warn').mockImplementation(() => { /* quiet */ });
    return lines;
  };

  it('names the confirm-email locale keys and check-i18n when it delivers that page', () => {
    const lines = logged();

    expect(addLogin(project(), { install: false, cliVersion: '0.14.0' }).ok).toBe(true);

    const output = lines.join('\n');
    expect(output).toContain('settings.emailChange.confirmPrompt');
    expect(output).toContain('settings.emailChange.confirmButton');
    expect(output).toContain('npx luckystack check-i18n');
  });

  it('stays quiet about the keys when the page was already there', () => {
    const lines = logged();
    addLogin(project(), { install: false, cliVersion: '0.14.0' });
    lines.length = 0;

    addLogin(project(), { install: false, cliVersion: '0.14.0' });

    expect(lines.join('\n')).not.toContain('settings.emailChange.confirmPrompt');
  });
});

describe('add login ↔ manage auth → none symmetry (finding 005)', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-add-login-sym-'));
    vi.spyOn(console, 'log').mockImplementation(() => { /* quiet */ });
    vi.spyOn(console, 'warn').mockImplementation(() => { /* quiet */ });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('delivers src/_api/logout_v1.ts, and auth → none removes every unedited file the add copied', () => {
    const pkg = { name: 'app', dependencies: { '@prisma/client': '^6.0.0' } };
    const pkgPath = path.join(root, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify(pkg));
    const project: ConsumerProject = { root, pkg, pkgPath };

    expect(addLogin(project, { install: false, cliVersion: '0.14.0' }).ok).toBe(true);
    expect(fs.existsSync(path.join(root, 'src', '_api', 'logout_v1.ts'))).toBe(true);

    const change = planChanges(
      { ...configFromState(detectProjectState(project)), authMode: 'credentials' },
      { ...configFromState(detectProjectState(project)), authMode: 'none' },
    ).find((c) => c.summary.includes('Auth: → none'));
    expect(change?.apply({ project, cliVersion: '0.14.0', declaredKeys: new Set() }).ok).toBe(true);

    const leftovers = LOGIN_COPIED_PATHS.filter((rel) => fs.existsSync(path.join(root, rel)));
    expect(leftovers).toEqual([]);
  });
});
