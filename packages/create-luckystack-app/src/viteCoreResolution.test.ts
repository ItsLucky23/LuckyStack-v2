import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { tryCatchSync } from '@luckystack/core';

const TEMPLATE = path.resolve(import.meta.dirname, '../template');

const collectSourceFiles = (root: string): string[] => {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...collectSourceFiles(fullPath));
    else if (/\.tsx?$/.test(entry.name)) files.push(fullPath);
  }
  return files;
};

const withoutComments = (source: string): string => source
  .replaceAll(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');

const runtimeBareCoreImports = (filePath: string): string[] => {
  const source = withoutComments(fs.readFileSync(filePath, 'utf8'));
  const declarations = source.match(/\b(?:import|export)\b[\s\S]*?;/g) ?? [];
  const staticImports = declarations.filter((declaration) =>
    /from\s+['"]@luckystack\/core['"]|import\s+['"]@luckystack\/core['"]/.test(declaration)
    && !/^\s*(?:import|export)\s+type\b/.test(declaration));
  const dynamicImports = source.match(/import\(\s*['"]@luckystack\/core['"]\s*\)/g) ?? [];
  return [...staticImports, ...dynamicImports];
};

describe('scaffold Vite core resolution', () => {
  it('does not rewrite the server barrel to the client barrel for Vitest', () => {
    const viteConfig = fs.readFileSync(path.join(TEMPLATE, 'vite.config.ts'), 'utf8');

    expect(viteConfig).not.toContain("replacement: '@luckystack/core/client'");
    const [error, parsed] = tryCatchSync(() => JSON.parse('{"server":true}') as { server: boolean });
    expect(error).toBeNull();
    expect(parsed).toEqual({ server: true });
  });

  it('keeps browser runtime imports on the explicit client-safe entries', () => {
    const browserFiles = [
      path.join(TEMPLATE, 'config.ts'),
      ...collectSourceFiles(path.join(TEMPLATE, 'src'))
        .filter((file) => !/[\\/]_(?:api|sync)[\\/]/.test(file)),
      ...collectSourceFiles(path.join(TEMPLATE, 'luckystack', 'i18n')),
    ];
    const violations = browserFiles.flatMap((file) =>
      runtimeBareCoreImports(file).map((declaration) => ({
        file: path.relative(TEMPLATE, file).replaceAll('\\', '/'),
        declaration,
      })));

    expect(violations).toEqual([]);
    expect(fs.readFileSync(path.join(TEMPLATE, 'config.ts'), 'utf8'))
      .toContain("from '@luckystack/core/config'");
  });
});
