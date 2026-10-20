import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConsumerProject } from '../lib/project';
import { detectProjectState } from '../lib/state';
import { configFromState, planChanges } from '../transitions';
import { addLogin } from './addLogin';
import { LOGIN_COPIED_PATHS } from './remove';
import { GUARDLESS_GENERATORS, stripGeneratorLoginGuards } from '../lib/guardlessGenerators';

const TEMPLATE = path.resolve(import.meta.dirname, '..', '..', '..', 'create-luckystack-app', 'template');
const TEMPLATE_EN_LOCALE = path.join(TEMPLATE, 'src', '_locales', 'en.json');

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

  //? The scaffold's English locale, optionally without some keys (as an older
  //? project that predates them).
  const writeEnglishLocale = (without: readonly string[]): void => {
    const locale = JSON.parse(fs.readFileSync(TEMPLATE_EN_LOCALE, 'utf8')) as Record<string, Record<string, unknown>>;
    for (const key of without) {
      const parts = key.split('.');
      const leaf = parts.pop() ?? '';
      let node: Record<string, unknown> = locale;
      for (const part of parts) node = node[part] as Record<string, unknown>;
      expect(node[leaf], key).toBeTypeOf('string');
      Reflect.deleteProperty(node, leaf);
    }
    fs.mkdirSync(path.join(root, 'src', '_locales'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', '_locales', 'en.json'), JSON.stringify(locale));
  };

  it('lists exactly the locale keys the copied files use and the project lacks', () => {
    //? Review 2 T3: 0.12.1 added the confirm keys, 0.15 managedByProvider and
    //? session.notFound (reached only through an onlyIfExists session save).
    const lacking = [
      'session.notFound',
      'settings.emailChange.confirmButton',
      'settings.emailChange.confirmPrompt',
      'settings.emailChange.managedByProvider',
    ];
    writeEnglishLocale(lacking);
    const lines = logged();

    expect(addLogin(project(), { install: false, cliVersion: '0.15.0' }).ok).toBe(true);

    const listed = lines.filter((line) => /^ {4}[\w.-]+$/.test(line)).map((line) => line.trim());
    expect(listed).toEqual(lacking);
    expect(lines.join('\n')).toContain('npx luckystack check-i18n');
  });

  it('names no key when the English locale has every key the copied files use', () => {
    writeEnglishLocale([]);
    const lines = logged();

    addLogin(project(), { install: false, cliVersion: '0.15.0' });

    expect(lines.join('\n')).not.toContain('locale key');
  });

  it('points to check-i18n when the project has no English locale', () => {
    const lines = logged();

    addLogin(project(), { install: false, cliVersion: '0.15.0' });

    expect(lines.join('\n')).toContain('npx luckystack check-i18n');
  });

  it('stays quiet about the keys when the page was already there', () => {
    const lines = logged();
    addLogin(project(), { install: false, cliVersion: '0.14.0' });
    lines.length = 0;

    addLogin(project(), { install: false, cliVersion: '0.14.0' });

    expect(lines.join('\n')).not.toContain('settings.emailChange.confirmPrompt');
  });
});

describe('add login names the missing providerAccountId column (ADR 0086)', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-add-login-schema-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const run = (dependencies: Record<string, string>, schema: string | null): string => {
    const pkg = { name: 'app', dependencies };
    const pkgPath = path.join(root, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify(pkg));
    if (schema !== null) {
      fs.mkdirSync(path.join(root, 'prisma'), { recursive: true });
      fs.writeFileSync(path.join(root, 'prisma', 'schema.prisma'), schema);
    }
    const warnings: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(() => { /* quiet */ });
    vi.spyOn(console, 'warn').mockImplementation((line: unknown) => { warnings.push(String(line)); });
    expect(addLogin({ root, pkg, pkgPath }, { install: false, cliVersion: '0.16.0' }).ok).toBe(true);
    return warnings.join('\n');
  };

  const PRE_016_USER = 'model User {\n  id String @id\n  email String\n  provider String\n}\n';

  it('warns on a Prisma schema from before 0.16', () => {
    expect(run({ '@prisma/client': '^6.0.0' }, PRE_016_USER)).toContain('prisma/schema.prisma has no providerAccountId');
  });

  it('stays quiet when the schema has the column', () => {
    const schema = PRE_016_USER.replace('}\n', '  providerAccountId String?\n  @@index([provider, providerAccountId])\n}\n');
    expect(run({ '@prisma/client': '^6.0.0' }, schema)).not.toContain('providerAccountId');
  });

  it('stays quiet without a Prisma schema', () => {
    expect(run({ '@prisma/client': '^6.0.0' }, null)).not.toContain('providerAccountId');
  });
});

describe('add login restores the /login guard in the new-page generators (review 2 T2)', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-add-login-guard-'));
    vi.spyOn(console, 'log').mockImplementation(() => { /* quiet */ });
    vi.spyOn(console, 'warn').mockImplementation(() => { /* quiet */ });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('undoes the --auth=none strip', () => {
    for (const { rel } of GUARDLESS_GENERATORS) {
      const source = path.join(TEMPLATE, rel.replace(/^\.luckystack\//, '_dot_luckystack/'));
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.copyFileSync(source, path.join(root, rel));
    }
    expect(stripGeneratorLoginGuards(root)).toEqual([]);
    const pkg = { name: 'app', dependencies: { '@prisma/client': '^6.0.0' } };
    const pkgPath = path.join(root, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify(pkg));

    expect(addLogin({ root, pkg, pkgPath }, { install: false, cliVersion: '0.15.0' }).ok).toBe(true);

    for (const { rel } of GUARDLESS_GENERATORS) {
      const source = path.join(TEMPLATE, rel.replace(/^\.luckystack\//, '_dot_luckystack/'));
      expect(fs.readFileSync(path.join(root, rel), 'utf8'), rel).toBe(fs.readFileSync(source, 'utf8'));
    }
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
