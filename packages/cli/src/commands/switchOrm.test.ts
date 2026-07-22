import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { switchOrm, ORM_SURFACES, PRISMA_USER_TYPE_IMPORT, NON_PRISMA_USER_TYPE_HEADER } from './switchOrm';
import { addDependency, type ConsumerProject } from '../lib/project';
import { USER_ADAPTER_STARTERS as CLI_USER_ADAPTER_STARTERS } from './addLogin';
import {
  PRISMA_USER_TYPE_IMPORT as SCAFFOLDER_PRISMA_IMPORT,
  ORM_NONE_CONFIG_USER_TYPE,
  DRIZZLE_DRIVER_DEPS,
  MIKRO_DRIVER_PACKAGES,
  USER_ADAPTER_STARTERS as SCAFFOLDER_USER_ADAPTER_STARTERS,
} from '../../../create-luckystack-app/src/index';

let consumerDir: string;
let freshDir: string;

beforeEach(() => {
  consumerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-sworm-c-'));
  freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-sworm-f-'));
});
afterEach(() => {
  fs.rmSync(consumerDir, { recursive: true, force: true });
  fs.rmSync(freshDir, { recursive: true, force: true });
});

const write = (root: string, relative: string, content: string): void => {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
};

const project = (): ConsumerProject => ({
  root: consumerDir,
  pkg: JSON.parse(fs.readFileSync(path.join(consumerDir, 'package.json'), 'utf8')) as ConsumerProject['pkg'],
  pkgPath: path.join(consumerDir, 'package.json'),
});

//? Fixture: a prisma project + a fresh drizzle render, then switch.
const seedPrismaProject = (): void => {
  write(consumerDir, 'package.json', JSON.stringify({
    name: 'app',
    dependencies: { '@luckystack/core': '^0.5.0', '@prisma/client': '^6.19.3' },
    devDependencies: { prisma: '^6.19.3' },
    scripts: { 'prisma:generate': 'x', 'prisma:db:push': 'y', 'prisma:migrate:dev': 'z', build: 'vite build' },
  }, null, 2));
  write(consumerDir, 'functions/db.ts', 'export { prisma } from "@luckystack/core";\n');
  write(consumerDir, 'luckystack/core/clients.ts', '// prisma examples\nexport {};\n');
  write(consumerDir, 'prisma/schema.prisma', 'datasource db { provider = "postgresql" }\nmodel User {}\n');
  write(consumerDir, 'config.ts', `${PRISMA_USER_TYPE_IMPORT}\nexport interface SessionLayout {}\n`);
  write(consumerDir, '.luckystack/scaffold.json', JSON.stringify({
    schemaVersion: 1,
    luckystackVersion: '0.5.0',
    createdAt: 'x',
    projectName: 'app',
    choices: { orm: 'prisma', dbProvider: 'postgresql' },
    files: [],
  }, null, 2));
};

//? Mirrors the scaffolder's stripPrismaSurface output shape (header … `};`).
const PLACEHOLDER_BLOCK = `${NON_PRISMA_USER_TYPE_HEADER}\ntype User = {\n  id: string;\n  email: string;\n};`;

const seedFreshDrizzleRender = (): void => {
  write(freshDir, 'package.json', JSON.stringify({
    name: 'app',
    dependencies: { '@luckystack/core': '^0.5.0', 'drizzle-orm': '^0.45.2', pg: '^8.16.0' },
    devDependencies: { 'drizzle-kit': '^0.31.0', '@types/pg': '^8.15.0' },
    scripts: { 'db:generate': 'drizzle-kit generate', 'db:migrate': 'drizzle-kit migrate', 'db:push': 'drizzle-kit push', 'db:studio': 'drizzle-kit studio' },
  }, null, 2));
  write(freshDir, 'functions/db.ts', '// drizzle client shim\nexport const db = {};\n');
  write(freshDir, 'luckystack/core/clients.ts', '// drizzle hooks\nexport {};\n');
  write(freshDir, 'server/db/schema.ts', '// drizzle schema starter\n');
  write(freshDir, 'drizzle.config.ts', '// drizzle-kit config\n');
  write(freshDir, 'config.ts', `${PLACEHOLDER_BLOCK}\nexport interface SessionLayout {}\n`);
};

describe('switchOrm — prisma → drizzle (fixture render)', () => {
  it('swaps deps/scripts, replaces shims with backups, adds starters, updates the manifest', () => {
    seedPrismaProject();
    seedFreshDrizzleRender();

    const consumerProject = project();
    const result = switchOrm(consumerProject, {
      from: 'prisma',
      to: 'drizzle',
      dbProvider: 'postgresql',
      cliVersion: '0.5.0',
      renderFreshScaffold: () => ({ projectDir: freshDir, cleanup: () => undefined }),
    });
    expect(result.ok).toBe(true);

    //? The manage wizard reuses this object for every later transition in the
    //? same pass. Prove a subsequent dependency write starts from the switched
    //? snapshot instead of serializing the old Prisma package over it.
    expect(consumerProject.pkg.dependencies?.['drizzle-orm']).toBe('^0.45.2');
    addDependency(consumerProject, '@luckystack/email', '^0.5.0');

    const pkg = JSON.parse(fs.readFileSync(path.join(consumerDir, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    //? Old surface gone, new surface in (versions from the fresh render).
    expect(pkg.dependencies['@prisma/client']).toBeUndefined();
    expect(pkg.devDependencies.prisma).toBeUndefined();
    expect(pkg.scripts['prisma:generate']).toBeUndefined();
    expect(pkg.dependencies['drizzle-orm']).toBe('^0.45.2');
    expect(pkg.dependencies.pg).toBe('^8.16.0');
    expect(pkg.dependencies['@luckystack/email']).toBe('^0.5.0');
    expect(pkg.devDependencies['drizzle-kit']).toBe('^0.31.0');
    expect(pkg.scripts['db:push']).toBe('drizzle-kit push');
    //? Untouched user scripts survive.
    expect(pkg.scripts.build).toBe('vite build');

    //? Shims replaced + previous versions backed up.
    expect(fs.readFileSync(path.join(consumerDir, 'functions/db.ts'), 'utf8')).toContain('drizzle client shim');
    expect(fs.existsSync(path.join(consumerDir, 'functions/db.ts.orm-prisma.bak'))).toBe(true);
    expect(fs.existsSync(path.join(consumerDir, 'luckystack/core/clients.ts.orm-prisma.bak'))).toBe(true);

    //? Starters copied; prisma leftovers NOT deleted.
    expect(fs.existsSync(path.join(consumerDir, 'server/db/schema.ts'))).toBe(true);
    expect(fs.existsSync(path.join(consumerDir, 'drizzle.config.ts'))).toBe(true);
    expect(fs.existsSync(path.join(consumerDir, 'prisma/schema.prisma'))).toBe(true);

    //? config.ts: prisma User import swapped for the render's placeholder block
    //? (NOT just removed — SessionLayout must keep compiling).
    const config = fs.readFileSync(path.join(consumerDir, 'config.ts'), 'utf8');
    expect(config).not.toContain("from '@prisma/client'");
    expect(config).toContain(NON_PRISMA_USER_TYPE_HEADER);

    //? Manifest records the new choice (detection reads this first).
    const manifest = JSON.parse(fs.readFileSync(path.join(consumerDir, '.luckystack/scaffold.json'), 'utf8')) as {
      choices: { orm: string; dbProvider: string };
    };
    expect(manifest.choices.orm).toBe('drizzle');
    expect(manifest.choices.dbProvider).toBe('postgresql');
  });

  it('keeps an existing starter file (copy-if-absent)', () => {
    seedPrismaProject();
    seedFreshDrizzleRender();
    write(consumerDir, 'server/db/schema.ts', '// MY OWN TABLES\n');

    const result = switchOrm(project(), {
      from: 'prisma',
      to: 'drizzle',
      dbProvider: 'postgresql',
      cliVersion: '0.5.0',
      renderFreshScaffold: () => ({ projectDir: freshDir, cleanup: () => undefined }),
    });
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(consumerDir, 'server/db/schema.ts'), 'utf8')).toBe('// MY OWN TABLES\n');
  });

  it('round-trips back to prisma: block → import, deps restored', () => {
    //? Consumer is a drizzle project (post-switch shape) …
    write(consumerDir, 'package.json', JSON.stringify({
      name: 'app',
      dependencies: { '@luckystack/core': '^0.5.0', 'drizzle-orm': '^0.44.0', pg: '^8.16.0' },
      devDependencies: { 'drizzle-kit': '^0.31.0' },
      scripts: { 'db:push': 'drizzle-kit push', build: 'vite build' },
    }, null, 2));
    write(consumerDir, 'functions/db.ts', '// drizzle client shim\n');
    write(consumerDir, 'luckystack/core/clients.ts', '// drizzle hooks\n');
    write(consumerDir, 'server/db/schema.ts', '// drizzle schema\n');
    write(consumerDir, 'config.ts', `${PLACEHOLDER_BLOCK}\nexport interface SessionLayout {}\n`);
    write(consumerDir, '.luckystack/scaffold.json', JSON.stringify({
      schemaVersion: 1, luckystackVersion: '0.5.0', createdAt: 'x', projectName: 'app',
      choices: { orm: 'drizzle', dbProvider: 'postgresql' }, files: [],
    }, null, 2));
    //? … and the fresh render is a prisma scaffold.
    write(freshDir, 'package.json', JSON.stringify({
      name: 'app',
      dependencies: { '@luckystack/core': '^0.5.0', '@prisma/client': '^6.19.3' },
      devDependencies: { prisma: '^6.19.3' },
      scripts: { 'prisma:generate': 'prisma generate', 'prisma:db:push': 'prisma db push', 'prisma:migrate:dev': 'prisma migrate dev' },
    }, null, 2));
    write(freshDir, 'functions/db.ts', '// prisma client shim\n');
    write(freshDir, 'luckystack/core/clients.ts', '// prisma hooks\n');
    write(freshDir, 'prisma/schema.prisma', 'datasource db { provider = "postgresql" }\n');
    write(freshDir, 'config.ts', `${PRISMA_USER_TYPE_IMPORT}\nexport interface SessionLayout {}\n`);

    const result = switchOrm(project(), {
      from: 'drizzle',
      to: 'prisma',
      dbProvider: 'postgresql',
      cliVersion: '0.5.0',
      renderFreshScaffold: () => ({ projectDir: freshDir, cleanup: () => undefined }),
    });
    expect(result.ok).toBe(true);

    const pkg = JSON.parse(fs.readFileSync(path.join(consumerDir, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.dependencies['@prisma/client']).toBe('^6.19.3');
    expect(pkg.dependencies['drizzle-orm']).toBeUndefined();
    expect(pkg.devDependencies.prisma).toBe('^6.19.3');
    expect(pkg.scripts['prisma:generate']).toBe('prisma generate');
    expect(pkg.scripts['db:push']).toBeUndefined();

    //? Placeholder block fully replaced by the import (both at once would be a
    //? duplicate-identifier compile error).
    const config = fs.readFileSync(path.join(consumerDir, 'config.ts'), 'utf8');
    expect(config).toContain(PRISMA_USER_TYPE_IMPORT);
    expect(config).not.toContain(NON_PRISMA_USER_TYPE_HEADER);

    expect(fs.existsSync(path.join(consumerDir, 'functions/db.ts.orm-drizzle.bak'))).toBe(true);
    expect(fs.existsSync(path.join(consumerDir, 'prisma/schema.prisma'))).toBe(true);
    //? Drizzle leftovers reported, never deleted.
    expect(fs.existsSync(path.join(consumerDir, 'server/db/schema.ts'))).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(path.join(consumerDir, '.luckystack/scaffold.json'), 'utf8')) as {
      choices: { orm: string };
    };
    expect(manifest.choices.orm).toBe('prisma');
  });

  it('fails cleanly when the fresh render cannot be produced', () => {
    seedPrismaProject();
    const result = switchOrm(project(), {
      from: 'prisma',
      to: 'drizzle',
      dbProvider: 'postgresql',
      cliVersion: '0.5.0',
      renderFreshScaffold: () => null,
    });
    expect(result.ok).toBe(false);
  });
});

describe('switchOrm parity with the scaffolder (drift guards)', () => {
  it('config.ts tokens are byte-identical to the scaffolder exports', () => {
    expect(PRISMA_USER_TYPE_IMPORT).toBe(SCAFFOLDER_PRISMA_IMPORT);
    expect(ORM_NONE_CONFIG_USER_TYPE.startsWith(NON_PRISMA_USER_TYPE_HEADER)).toBe(true);
  });

  it('UserAdapter starters are byte-identical to the scaffolder copies', () => {
    //? Scaffold-time (auth on drizzle/mikro-orm) and add-login/switch-time must
    //? generate the SAME starter — the two packages cannot import each other at
    //? runtime, so the duplicated strings are pinned here.
    expect(CLI_USER_ADAPTER_STARTERS.drizzle).toBe(SCAFFOLDER_USER_ADAPTER_STARTERS.drizzle);
    expect(CLI_USER_ADAPTER_STARTERS['mikro-orm']).toBe(SCAFFOLDER_USER_ADAPTER_STARTERS['mikro-orm']);
  });

  it('dependency-name tables cover every scaffolder driver dep', () => {
    const drizzleNames = new Set([...ORM_SURFACES.drizzle.deps, ...ORM_SURFACES.drizzle.devDeps]);
    for (const driver of Object.values(DRIZZLE_DRIVER_DEPS)) {
      for (const name of [...Object.keys(driver.deps), ...Object.keys(driver.devDeps)]) {
        expect(drizzleNames.has(name), `drizzle surface must include ${name}`).toBe(true);
      }
    }
    const mikroNames = new Set(ORM_SURFACES['mikro-orm'].deps);
    for (const driverPackage of Object.values(MIKRO_DRIVER_PACKAGES)) {
      expect(mikroNames.has(driverPackage), `mikro surface must include ${driverPackage}`).toBe(true);
    }
  });
});
