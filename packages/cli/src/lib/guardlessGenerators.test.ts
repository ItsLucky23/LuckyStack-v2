//? Review 1 finding 7: the `--auth=none` scaffold strips the /login guard from
//? the generators for new pages (finding 098), but `manage` → Auth: none left
//? it in place. The CLI mirrors the scaffolder's edits; this pins them to the
//? scaffolder's output on the real template so the two cannot drift.

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruneAuthNone } from '../../../create-luckystack-app/src/index';
import { GUARDLESS_GENERATORS, stripGeneratorLoginGuards, unmatchedGuardedGenerators } from './guardlessGenerators';

const TEMPLATE = path.resolve(import.meta.dirname, '..', '..', '..', 'create-luckystack-app', 'template');
const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

//? A project tree as the scaffolder lays it out (`_dot_luckystack` → `.luckystack`).
const copyTemplate = (): string => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-guardless-'));
  created.push(target);
  fs.cpSync(TEMPLATE, target, { recursive: true });
  fs.renameSync(path.join(target, '_dot_luckystack'), path.join(target, '.luckystack'));
  return target;
};

describe('stripGeneratorLoginGuards', () => {
  it('leaves the same generators as the --auth=none scaffold', () => {
    const scaffolded = copyTemplate();
    pruneAuthNone(scaffolded);
    const managed = copyTemplate();

    expect(unmatchedGuardedGenerators(managed)).toEqual([]);
    expect(stripGeneratorLoginGuards(managed)).toEqual([]);
    for (const { rel } of GUARDLESS_GENERATORS) {
      expect(fs.readFileSync(path.join(managed, rel), 'utf8'), rel).toBe(fs.readFileSync(path.join(scaffolded, rel), 'utf8'));
    }
    //? A second run finds nothing left to strip and reports nothing.
    expect(stripGeneratorLoginGuards(managed)).toEqual([]);
  });

  it('leaves an edited generator alone and reports it', () => {
    const managed = copyTemplate();
    const rel = '.luckystack/templates/page_dashboard.template.tsx';
    const file = path.join(managed, rel);
    const edited = fs.readFileSync(file, 'utf8').replace('//? Default: require login.', '//? Our team default: require login.');
    fs.writeFileSync(file, edited);

    expect(unmatchedGuardedGenerators(managed)).toEqual([rel]);
    expect(stripGeneratorLoginGuards(managed)).toEqual([rel]);
    expect(fs.readFileSync(file, 'utf8')).toBe(edited);
  });
});
