import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const assertMethodMapBootstrap = (source: string): void => {
  expect(source).toContain("import { registerApiMethodMap } from '@luckystack/core/client';");
  expect(source).toContain("import { apiMethodMap } from './apiTypes.generated';");
  expect(source).toContain('registerApiMethodMap(apiMethodMap);');
};

describe('routed HTTP method-map bootstrap', () => {
  it('registers the generated map in fresh scaffold clients', () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, '..', 'template', 'src', '_sockets', 'apiRequest.ts'),
      'utf8',
    );

    assertMethodMapBootstrap(source);
  });

  it('keeps the framework reference app aligned with the scaffold', () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, '..', '..', '..', 'src', '_sockets', 'apiRequest.ts'),
      'utf8',
    );

    assertMethodMapBootstrap(source);
  });
});
