import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DRIZZLE_DRIVER_DEPS, drizzleDbShimFor } from './index';

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
});
