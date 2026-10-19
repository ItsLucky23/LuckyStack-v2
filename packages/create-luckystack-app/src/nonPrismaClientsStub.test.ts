//? Finding 099: the drizzle/mikro-orm `luckystack/core/clients.ts` stub always
//? said "Auth was scaffolded OFF … register a custom UserAdapter here", also in
//? an auth-on scaffold that already ships a starter in
//? luckystack/login/userAdapter.ts — inviting a second adapter in the wrong file.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyOrmChoice, DEFAULT_CHOICES } from './index';

const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const clientsStubFor = (orm: 'drizzle' | 'mikro-orm', authMode: 'none' | 'credentials'): string => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-clients-stub-'));
  created.push(target);
  fs.cpSync(path.resolve(import.meta.dirname, '../template'), target, { recursive: true });
  applyOrmChoice(target, { ...DEFAULT_CHOICES, orm, dbProvider: 'postgresql', authMode }, 'postgresql://localhost/app');
  return fs.readFileSync(path.join(target, 'luckystack', 'core', 'clients.ts'), 'utf8');
};

describe('drizzle / mikro-orm clients.ts auth note', () => {
  it.each(['drizzle', 'mikro-orm'] as const)('%s with auth on points at the starter UserAdapter', (orm) => {
    const stub = clientsStubFor(orm, 'credentials');
    expect(stub).not.toContain('Auth was scaffolded OFF');
    expect(stub).toContain('luckystack/login/userAdapter.ts');
    expect(stub).toContain('Register no second adapter');
  });

  it.each(['drizzle', 'mikro-orm'] as const)('%s with auth off says so and how to add it', (orm) => {
    const stub = clientsStubFor(orm, 'none');
    expect(stub).toContain('Auth was scaffolded OFF');
    expect(stub).toContain('npx luckystack add login');
  });
});
