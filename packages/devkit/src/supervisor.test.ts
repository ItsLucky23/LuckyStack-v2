import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

//? Guard for the stale-env bug (2026-06-10): the supervisor process must NEVER
//? import @luckystack/core — core runs `bootstrapEnv()` as an import side-effect,
//? which merges `.env` into the supervisor's process.env. The child inherits
//? that env and its own `.env` load uses `override: false`, so inherited stale
//? values would win over freshly edited file values on every restart. The
//? original ambientEnvSnapshot workaround silently broke when tsup inlined the
//? snapshot module into the entry body (ESM imports are hoisted), so we now
//? assert the invariant at both the source and bundle level.
const here = path.dirname(fileURLToPath(import.meta.url));

describe('supervisor env hygiene', () => {
  it('src/supervisor.ts imports nothing from @luckystack/core', () => {
    const source = readFileSync(path.join(here, 'supervisor.ts'), 'utf8');
    expect(source).not.toMatch(/from '@luckystack\/core'/);
  });

  const distPath = path.join(here, '..', 'dist', 'supervisor.js');
  it.skipIf(!existsSync(distPath))('dist/supervisor.js bundles no @luckystack/core import', () => {
    const bundle = readFileSync(distPath, 'utf8');
    expect(bundle).not.toContain('@luckystack/core');
  });
});
