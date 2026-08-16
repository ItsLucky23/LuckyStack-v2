import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');

const runtimeFiles = [
  'config.ts',
  'server/server.ts',
  'packages/core/src/env.ts',
  'packages/core/src/bindAddress.ts',
  'packages/core/src/checkOrigin.ts',
  'packages/server/src/argv.ts',
  'packages/server/src/parseArgv.ts',
  'packages/server/src/portResolution.ts',
  'packages/server/src/createServer.ts',
  'packages/create-luckystack-app/template/config.ts',
  'packages/create-luckystack-app/template/server/server.ts',
  'packages/create-luckystack-app/template/_dot_env_template',
] as const;

describe('legacy backend-port environment removal', () => {
  it('keeps active runtime and scaffold surfaces free of the removed key', () => {
    for (const relativePath of runtimeFiles) {
      const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
      expect(source, relativePath).not.toMatch(/process\.env\.SERVER_PORT\b/);
      if (relativePath.includes('template/')) {
        expect(source, relativePath).not.toMatch(/\bSERVER_PORT\b/);
      }
    }
  });

  it('retains the separate auto-increment policy flag', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'packages/server/src/createServer.ts'),
      'utf8',
    );
    expect(source).toContain('SERVER_PORT_AUTO_INCREMENT');
  });
});
