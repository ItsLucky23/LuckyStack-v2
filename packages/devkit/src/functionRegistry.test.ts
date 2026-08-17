import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

//? The registry only needs `ROOT_DIR` (to relativize discovered paths) and
//? `getServerFunctionDirs` (which every test overrides via the `roots` option).
//? Stubbing keeps the test free of a built core. Mirrors functionsMeta.test.ts.
let mockRootDir = '/project';
vi.mock('@luckystack/core', async (importOriginal) => {
  //? The test-file predicates are pure string helpers and are the thing under
  //? test in the exclusion cases below — use the REAL implementations so the
  //? mock cannot drift from the shipped convention.
  const actual = await importOriginal<typeof import('@luckystack/core')>();
  return {
    get ROOT_DIR() { return mockRootDir; },
    getServerFunctionDirs: vi.fn(() => []),
    isTestFile: actual.isTestFile,
    isTestDirectory: actual.isTestDirectory,
  };
});

import {
  collectFunctionModules,
  renderFunctionsMap,
  formatFunctionKeyPath,
} from './functionRegistry';
import { registerRoutingRules } from './routingRules';

let workspace: string;

const write = (relativePath: string, content = 'export const noop = () => {};\n'): void => {
  const absolute = path.join(workspace, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
};

const rootsOf = (...names: string[]): string[] => names.map((name) => path.join(workspace, name));

const dottedKeys = (modules: { keyPath: string[] }[]): string[] =>
  modules.map((module) => formatFunctionKeyPath(module.keyPath));

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'luckystack-fnreg-'));
  //? `fs.realpathSync` because macOS/Windows temp dirs are symlinked; without
  //? it `path.relative(ROOT_DIR, discovered)` yields `../..`-prefixed garbage.
  workspace = fs.realpathSync(workspace);
  mockRootDir = workspace;
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
  registerRoutingRules({ ignore: () => false });
});

describe('collectFunctionModules', () => {
  it('nests by directory instead of collapsing onto the bare filename (the deploy bug)', () => {
    write('shared/rbac/engine.ts');
    write('shared/rbac/policies/admin.ts');
    write('shared/sleep.ts');

    const modules = collectFunctionModules({ roots: rootsOf('shared') });

    expect(dottedKeys(modules)).toEqual([
      'rbac.engine',
      'rbac.policies.admin',
      'sleep',
    ]);
  });

  it('walks EVERY configured root, not just the project functions dir', () => {
    write('functions/db.ts');
    write('shared/tryCatch.ts');

    const modules = collectFunctionModules({ roots: rootsOf('functions', 'shared') });

    //? The production generator used to scan `functions/` + `server/functions/`
    //? only, so `shared/tryCatch` + `shared/sleep` were missing from every
    //? deployed bundle while dev and the generated types had them.
    expect(dottedKeys(modules)).toEqual(['db', 'tryCatch']);
  });

  it('reports the source file and root for each discovered module', () => {
    write('shared/rbac/engine.ts');

    const modules = collectFunctionModules({ roots: rootsOf('shared') });

    expect(modules).toHaveLength(1);
    expect(modules[0]?.sourcePath).toBe('shared/rbac/engine.ts');
    expect(modules[0]?.rootPath).toBe('shared');
  });

  it('skips a nested node_modules tree', () => {
    write('functions/db.ts');
    write('functions/node_modules/left-pad/index.ts');

    expect(dottedKeys(collectFunctionModules({ roots: rootsOf('functions') }))).toEqual(['db']);
  });

  it('honours the RoutingRules ignore predicate', () => {
    write('functions/db.ts');
    write('functions/vendor/legacy.ts');

    registerRoutingRules({ ignore: (relativePath) => relativePath.includes('/vendor') });

    expect(dottedKeys(collectFunctionModules({ roots: rootsOf('functions') }))).toEqual(['db']);
  });

  it('excludes test files so they are never injected or baked into the prod map', () => {
    write('functions/db.ts');
    write('functions/db.tests.ts');
    write('functions/db.test.ts');
    write('functions/db.spec.ts');
    write('functions/nested/helper.tests.ts');

    expect(dottedKeys(collectFunctionModules({ roots: rootsOf('functions') }))).toEqual(['db']);
  });

  it('skips conventional test directories', () => {
    write('functions/db.ts');
    write('functions/__tests__/fixtures.ts');
    write('functions/__mocks__/redis.ts');

    expect(dottedKeys(collectFunctionModules({ roots: rootsOf('functions') }))).toEqual(['db']);
  });

  it('ignores non-TypeScript files', () => {
    write('functions/db.ts');
    write('functions/notes.md', '# not a module\n');

    expect(dottedKeys(collectFunctionModules({ roots: rootsOf('functions') }))).toEqual(['db']);
  });

  it('tolerates a configured root that does not exist', () => {
    write('functions/db.ts');

    expect(dottedKeys(collectFunctionModules({ roots: rootsOf('functions', 'shared') }))).toEqual(['db']);
  });

  it('throws on a cross-root key collision', () => {
    write('functions/sleep.ts');
    write('shared/sleep.ts');

    expect(() => collectFunctionModules({ roots: rootsOf('functions', 'shared') }))
      .toThrow(/Conflict at `functions\.sleep`.*functions\/sleep\.ts.*shared\/sleep\.ts/s);
  });

  it('throws when a key would be both a module and a namespace', () => {
    write('functions/rbac.ts');
    write('shared/rbac/engine.ts');

    expect(() => collectFunctionModules({ roots: rootsOf('functions', 'shared') }))
      .toThrow(/cannot be both a module and a namespace/);
  });

  it('warns and keeps the first claim when onConflict is supplied (dev-loader mode)', () => {
    write('functions/sleep.ts');
    write('shared/sleep.ts');

    const onConflict = vi.fn();
    const modules = collectFunctionModules({ roots: rootsOf('functions', 'shared'), onConflict });

    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(dottedKeys(modules)).toEqual(['sleep']);
    expect(modules[0]?.sourcePath).toBe('functions/sleep.ts');
  });

  it('drops the nested module and warns on a namespace conflict in dev-loader mode', () => {
    write('functions/rbac.ts');
    write('shared/rbac/engine.ts');

    const onConflict = vi.fn();
    const modules = collectFunctionModules({ roots: rootsOf('functions', 'shared'), onConflict });

    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(dottedKeys(modules)).toEqual(['rbac']);
  });

  it('merges two roots contributing to the same namespace', () => {
    write('functions/admin/users.ts');
    write('shared/admin/roles.ts');

    expect(dottedKeys(collectFunctionModules({ roots: rootsOf('functions', 'shared') })))
      .toEqual(['admin.roles', 'admin.users']);
  });
});

describe('renderFunctionsMap', () => {
  it('emits a nested object literal reachable as functions.<dir>.<file>', () => {
    write('shared/rbac/engine.ts');
    write('shared/sleep.ts');

    const { imports, source } = renderFunctionsMap({
      modules: collectFunctionModules({ roots: rootsOf('shared') }),
      importPrefix: '../../',
    });

    expect(imports).toEqual([
      "import * as fn0 from '../../shared/rbac/engine';",
      "import * as fn1 from '../../shared/sleep';",
    ]);
    expect(source).toContain('"rbac": {\n');
    expect(source).toContain('"engine": (() => {');
    expect(source).toContain('"sleep": (() => {');
  });

  it('aliases a default-only export to the file name, not to `default`', () => {
    write('shared/sleep.ts');

    const { source } = renderFunctionsMap({
      modules: collectFunctionModules({ roots: rootsOf('shared') }),
      importPrefix: '../../',
    });

    //? `shared/sleep.ts` is a default re-export; handlers must reach it as
    //? `functions.sleep.sleep(ms)` — this alias is what makes that work.
    expect(source).toContain('return _default !== undefined ? { "sleep": _default } : {};');
  });

  it('produces source that still satisfies the declared map type at depth', () => {
    write('shared/a/b/c.ts');

    const { source } = renderFunctionsMap({
      modules: collectFunctionModules({ roots: rootsOf('shared') }),
      importPrefix: '../../',
    });

    expect(source.startsWith('export const functions: Record<string, Record<string, unknown>> = {')).toBe(true);
    expect(source.trimEnd().endsWith('};')).toBe(true);
    expect(source).toContain('"a": {');
    expect(source).toContain('"b": {');
    expect(source).toContain('"c": (() => {');
  });

  it('emits an empty map body when no modules were discovered', () => {
    const { imports, source } = renderFunctionsMap({ modules: [], importPrefix: '../../' });

    expect(imports).toEqual([]);
    expect(source).toBe('export const functions: Record<string, Record<string, unknown>> = {\n};');
  });
});
