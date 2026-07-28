import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const assertGeneratedPresetImport = (source: string): void => {
  expect(source).toContain('import(`./prod/generatedApis.${preset}.ts`)');
  expect(source).not.toContain('import(`./prod/generatedApis.${preset}`)');
};

describe('production generated-preset bundle loading', () => {
  it('uses the extension included in esbuild glob keys in fresh scaffolds', () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, '..', 'template', 'server', 'server.ts'),
      'utf8',
    );

    assertGeneratedPresetImport(source);
  });

  it('keeps the framework reference app aligned with the scaffold', () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, '..', '..', '..', 'server', 'server.ts'),
      'utf8',
    );

    assertGeneratedPresetImport(source);
  });
});
