//? Characterization tests for the helpers extracted out of the `checkI18n`
//? god-function (audit #13 / Q41). These pin the scan semantics so the
//? decomposition stays behavior-equivalent: same used-key set + locations, same
//? dynamic-site filtering, same locale flattening + bad-file skip.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { harvestUsedKeys, collectDynamicSites, loadLocaleKeys } from './checkI18n';
import type { SourceFile } from '../lib/scan';

//? Build a minimal in-memory SourceFile (rel + text + derived lines). Mirrors
//? what `collectSourceFiles` produces, so the helpers see realistic input.
const sourceFile = (rel: string, text: string): SourceFile => {
  const normalized = text.replaceAll('\r\n', '\n');
  return { abs: `/fake/${rel}`, rel, text: normalized, lines: normalized.split('\n') };
};

//? Write a locale JSON at `root/rel`, creating parent dirs.
const writeLocale = (root: string, rel: string, json: string): void => {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, json, 'utf8');
};

describe('harvestUsedKeys', () => {
  it('harvests literal key: and errorCode: dotted keys with their locations', () => {
    const files = [
      sourceFile(
        'src/a.ts',
        [
          `notify.error({ key: 'common.connectionError' });`,
          `translate({ key: 'sync.invalidName' });`,
          `const e = { errorCode: 'auth.tokenExpired' };`,
        ].join('\n'),
      ),
      sourceFile('src/b.ts', `t({ key: 'common.connectionError' });`),
    ];

    const { locations, keys } = harvestUsedKeys(files);

    expect([...keys].toSorted()).toEqual([
      'auth.tokenExpired',
      'common.connectionError',
      'sync.invalidName',
    ]);
    //? Same key seen in two files → both locations, in file/line order.
    expect(locations.get('common.connectionError')).toEqual(['src/a.ts:1', 'src/b.ts:1']);
    expect(locations.get('auth.tokenExpired')).toEqual(['src/a.ts:3']);
    //? keys set is exactly the locations map's keys.
    expect(keys).toEqual(new Set(locations.keys()));
  });

  it('filters out non-dotted key: props (e.g. { key: \'name\' })', () => {
    const files = [sourceFile('src/c.ts', `render({ key: 'name' }); notify({ key: 'a.b' });`)];
    const { keys } = harvestUsedKeys(files);
    expect([...keys]).toEqual(['a.b']);
  });

  it('returns empty sets for no hits', () => {
    const { locations, keys } = harvestUsedKeys([sourceFile('src/d.ts', `const x = 1;`)]);
    expect(keys.size).toBe(0);
    expect(locations.size).toBe(0);
  });
});

describe('collectDynamicSites', () => {
  it('captures key:<identifier> sites and drops type annotations / literals', () => {
    const files = [
      sourceFile(
        'src/e.ts',
        [
          `notify.error({ key: errorCode });`, // dynamic — kept
          `interface P { key: string }`, // type annotation — dropped
          `fn({ key: someVar })`, // dynamic — kept
          `if (key: boolean) {}`, // type-ish word — dropped
        ].join('\n'),
      ),
    ];
    const sites = collectDynamicSites(files);
    expect(sites.map((s) => s.value).toSorted()).toEqual(['errorCode', 'someVar']);
    expect(sites.find((s) => s.value === 'errorCode')).toMatchObject({ file: 'src/e.ts', line: 1 });
  });

  it('returns empty when only literal keys are present', () => {
    const files = [sourceFile('src/f.ts', `notify({ key: 'a.b' });`)];
    expect(collectDynamicSites(files)).toEqual([]);
  });
});

describe('loadLocaleKeys', () => {
  let tmp: string;

  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('flattens nested locale JSON to dotted leaf keys, keyed by posix rel-path', () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'i18n-'));
    writeLocale(tmp, path.join('src', '_locales', 'en.json'), JSON.stringify({ common: { connectionError: 'x', ok: 'y' } }));
    writeLocale(tmp, path.join('src', '_locales', 'nl.json'), JSON.stringify({ common: { ok: 'ja' } }));

    const localeKeys = loadLocaleKeys(tmp);

    //? Sorted by path (findLocaleFiles sorts) → en before nl.
    expect([...localeKeys.keys()]).toEqual(['src/_locales/en.json', 'src/_locales/nl.json']);
    expect([...(localeKeys.get('src/_locales/en.json') ?? [])].toSorted()).toEqual(['common.connectionError', 'common.ok']);
    expect([...(localeKeys.get('src/_locales/nl.json') ?? [])]).toEqual(['common.ok']);
  });

  it('warns and skips a locale file that fails to parse (does not crash the scan)', () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'i18n-'));
    writeLocale(tmp, path.join('src', '_locales', 'good.json'), JSON.stringify({ a: { b: 'c' } }));
    writeLocale(tmp, path.join('src', '_locales', 'bad.json'), `{ not valid json `);
    const warn = vi.spyOn(console, 'warn').mockImplementation(vi.fn());

    const localeKeys = loadLocaleKeys(tmp);

    //? Bad file skipped — only the good one is present.
    expect([...localeKeys.keys()]).toEqual(['src/_locales/good.json']);
    expect([...(localeKeys.get('src/_locales/good.json') ?? [])]).toEqual(['a.b']);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('src/_locales/bad.json');
  });

  it('ignores .json files outside a _locales directory', () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'i18n-'));
    writeLocale(tmp, path.join('src', 'data', 'config.json'), JSON.stringify({ a: 'b' }));
    expect(loadLocaleKeys(tmp).size).toBe(0);
  });
});
