//? Peer-dep presence probe used to gate package-dependent eslint rules.
//? Resolves against `process.cwd()` so the CONSUMER's node_modules drives
//? activation, not this package's own resolution graph.
//?
//? Implementation: tries `require.resolve` first (works for CJS-compatible
//? packages), falls back to an fs-based `node_modules/<name>/package.json`
//? check for pure-ESM packages whose `exports` map omits the `require`
//? condition (which is the case for the @luckystack/* packages themselves).

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const localRequire = createRequire(import.meta.url);

const checkOnDisk = (name: string): boolean => {
  const segments = name.startsWith('@') ? name.split('/').slice(0, 2) : [name.split('/')[0]!];
  return existsSync(join(process.cwd(), 'node_modules', ...segments, 'package.json'));
};

export const hasPackage = (name: string): boolean => {
  try {
    localRequire.resolve(name, { paths: [process.cwd()] });
    return true;
  } catch {
    return checkOnDisk(name);
  }
};
