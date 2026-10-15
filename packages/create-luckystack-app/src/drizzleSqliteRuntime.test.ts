import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { applyOrmChoice, DEFAULT_CHOICES, DRIZZLE_DRIVER_DEPS, drizzleDbShimFor } from './index';

describe('Drizzle SQLite scaffold runtime parity', () => {
  it('ships both runtime-native driver paths without statically loading either one', () => {
    const shim = drizzleDbShimFor('sqlite', 'file:./dev.db');

    expect(shim).toContain("if ('Bun' in globalThis)");
    expect(shim).toContain("import('bun:sqlite')");
    expect(shim).toContain("import('drizzle-orm/bun-sqlite')");
    expect(shim).toContain("import('better-sqlite3')");
    expect(shim).toContain("import('drizzle-orm/better-sqlite3')");
    expect(shim).not.toContain("import Database from 'better-sqlite3'");
  });

  it('keeps bun:sqlite external in the production server bundle', () => {
    const bundler = fs.readFileSync(path.resolve(import.meta.dirname, '../template/scripts/bundleServer.mjs'), 'utf8');
    expect(bundler).toContain("'bun:sqlite'");
  });

  it('includes Bun SQLite declarations beside the Node driver declarations', () => {
    expect(DRIZZLE_DRIVER_DEPS.sqlite.deps['better-sqlite3']).toBe('^12.4.0');
    expect(DRIZZLE_DRIVER_DEPS.sqlite.devDeps['@types/better-sqlite3']).toBe('^7.6.13');
    expect(DRIZZLE_DRIVER_DEPS.sqlite.devDeps['bun-types']).toBe('^1.3.14');
  });

  //? The whole package declares Bun's globals for the entire program, including
  //? `import.meta.hot` as always present, which made the browser-side HMR guard in
  //? MenuHandler fail `no-unnecessary-condition` in every drizzle+sqlite scaffold.
  //? `bun install` runs no install script unless the package is trusted, so
  //? better-sqlite3 had no native binding and a `--pm=bun` sqlite project
  //? crashed on its first query under Node. Exactly that one package is trusted.
  it.each([
    ['drizzle', 'sqlite', true],
    ['mikro-orm', 'sqlite', true],
    ['drizzle', 'postgresql', false],
    ['mikro-orm', 'postgresql', false],
  ] as const)('%s + %s scaffold trusts better-sqlite3: %s', (orm, dbProvider, trustsDriver) => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'luckystack-orm-trusted-'));
    try {
      fs.cpSync(path.resolve(import.meta.dirname, '../template'), target, { recursive: true });
      const readTrusted = (): string[] =>
        (JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')) as { trustedDependencies: string[] }).trustedDependencies;
      const templateTrusted = readTrusted();
      applyOrmChoice(target, { ...DEFAULT_CHOICES, orm, dbProvider }, 'file:./dev.db');
      expect(readTrusted()).toEqual(trustsDriver ? [...templateTrusted, 'better-sqlite3'] : templateTrusted);
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it('loads only the bun:sqlite declarations, not all of bun-types', () => {
    const shim = drizzleDbShimFor('sqlite', 'file:./dev.db');
    expect(shim).toContain('/// <reference types="bun-types/sqlite" />');
    expect(shim).not.toContain('/// <reference types="bun-types" />');
  });
});
