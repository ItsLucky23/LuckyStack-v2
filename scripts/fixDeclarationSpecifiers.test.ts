import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { fixDeclarationSpecifiers } from './fixDeclarationSpecifiers.mjs';

const dirs: string[] = [];
const makeDist = (files: Record<string, string>): string => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-dts-'));
  dirs.push(dist);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dist, rel)), { recursive: true });
    fs.writeFileSync(path.join(dist, rel), content);
  }
  return dist;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('fixDeclarationSpecifiers', () => {
  it('adds .js / index.js to relative specifiers and leaves comments, packages and explicit extensions alone', () => {
    const dist = makeDist({
      'index.d.ts': [
        "// see './hooks' for details",
        "export * from './hooks';",
        "export type { A } from './types';",
        "export type B = import('./types').A;",
        "export { c } from './done.js';",
        "import type { Z } from 'zod';",
        '',
      ].join('\n'),
      'hooks/index.d.ts': 'export declare const h: 1;\n',
      'types.d.ts': 'export type A = 1;\n',
      'done.d.ts': 'export declare const c: 1;\n',
    });
    expect(fixDeclarationSpecifiers(dist)).toEqual([]);
    expect(fs.readFileSync(path.join(dist, 'index.d.ts'), 'utf8')).toBe([
      "// see './hooks' for details",
      "export * from './hooks/index.js';",
      "export type { A } from './types.js';",
      "export type B = import('./types.js').A;",
      "export { c } from './done.js';",
      "import type { Z } from 'zod';",
      '',
    ].join('\n'));
  });

  it('reports a relative specifier without an emitted declaration', () => {
    const dist = makeDist({ 'index.d.ts': "export * from './missing';\n" });
    const problems = fixDeclarationSpecifiers(dist);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('./missing');
  });

  it('reports a generated dot-folder package path such as .prisma/client', () => {
    const dist = makeDist({
      'db.d.ts': "export declare const prisma: import('.prisma/client').PrismaClient;\n",
    });
    const problems = fixDeclarationSpecifiers(dist);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('.prisma/client');
  });
});
