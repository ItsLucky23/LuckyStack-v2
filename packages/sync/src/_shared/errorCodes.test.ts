import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYNC_ERROR_CODES } from './errorCodes';

//? Two-sided parity guard for the exported error-code list:
//?   1. SOURCE → LIST: every `'sync.<code>'` literal the framework emits (this
//?      package + the server's HTTP sync route) is in `SYNC_ERROR_CODES`, and
//?      every listed code is emitted somewhere (no dead entries).
//?   2. LIST → LOCALES: the scaffold's four locale files carry a translation
//?      for every code, so a fresh project never renders a raw key.
//? A code that fails (1) is a framework bug; a code that fails (2) is a
//? scaffold bug. Both are the exact failure a consumer reported (DEV-376 N-08).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGES = path.resolve(HERE, '..', '..', '..');
const SYNC_SRC = path.resolve(PACKAGES, 'sync', 'src');
const SERVER_SYNC_ROUTE = path.resolve(PACKAGES, 'server', 'src', 'httpRoutes', 'syncRoute.ts');
const LOCALES_DIR = path.resolve(PACKAGES, 'create-luckystack-app', 'template', 'src', '_locales');
const LOCALES = ['nl', 'en', 'de', 'fr'] as const;

//? Client-side sentinel, not an error code (see errorCodes.ts header).
const NOT_ERROR_CODES: ReadonlySet<string> = new Set(['sync.ignore']);

const listSourceFiles = (dir: string): string[] =>
  fs
    .readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((relative) => path.join(dir, relative))
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('errorCodes.ts'));

const collectLiterals = (files: string[]): Map<string, string[]> => {
  const found = new Map<string, string[]>();
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/'(sync\.[A-Za-z]+)'/g)) {
      const code = match[1];
      if (code === undefined || NOT_ERROR_CODES.has(code)) continue;
      const seen = found.get(code) ?? [];
      seen.push(path.relative(PACKAGES, file));
      found.set(code, seen);
    }
  }
  return found;
};

describe('SYNC_ERROR_CODES parity', () => {
  const literals = collectLiterals([...listSourceFiles(SYNC_SRC), SERVER_SYNC_ROUTE]);
  const listed = new Set<string>(SYNC_ERROR_CODES);

  it('contains no duplicates', () => {
    expect(listed.size).toBe(SYNC_ERROR_CODES.length);
  });

  it('lists every sync.* code the source emits', () => {
    const missing = [...literals.entries()]
      .filter(([code]) => !listed.has(code))
      .map(([code, files]) => `${code} (${files.join(', ')})`);
    expect(missing).toEqual([]);
  });

  it('has no entry the source never emits', () => {
    const dead = SYNC_ERROR_CODES.filter((code) => !literals.has(code));
    expect(dead).toEqual([]);
  });

  for (const locale of LOCALES) {
    it(`is fully translated in the scaffold locale ${locale}.json`, () => {
      const raw: unknown = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf8'));
      const syncBlock =
        typeof raw === 'object' && raw !== null && 'sync' in raw && typeof raw.sync === 'object' && raw.sync !== null
          ? raw.sync
          : {};
      const keys = new Set(Object.keys(syncBlock));
      const missing = SYNC_ERROR_CODES.map((code) => code.slice('sync.'.length)).filter((key) => !keys.has(key));
      expect(missing).toEqual([]);
    });
  }
});
