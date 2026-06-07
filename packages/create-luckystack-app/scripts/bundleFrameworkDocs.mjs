#!/usr/bin/env node
//? Bundles the framework's AI dev-context docs INTO this package so they ship in
//? the npm tarball. Runs as part of `npm run build` (see package.json), which the
//? release flow (`scripts/publishPackages.mjs` → `build:packages`) always runs
//? before publishing.
//?
//? WHY: the scaffold's `aiInstructions` option copies CLAUDE.md / docs / skills /
//? .claude/commands / branch-logs/README.md into the new project. At runtime the
//? installed package only has access to its OWN files — the monorepo root is not
//? in the tarball — so without this bundle the copy silently no-ops for real
//? `npx create-luckystack-app` users (it only worked in-repo via scaffold:test).
//?
//? Layout: the two nested/dot sources are flattened to non-dot names so npm
//? reliably includes them in the tarball:
//?   <root>/.claude/commands      -> framework-docs/claude-commands
//?   <root>/branch-logs/README.md -> framework-docs/branch-logs-README.md
//? `src/index.ts` knows this mapping and reverses it on copy-out.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PKG_DIR, '..', '..');
const OUT_DIR = path.join(PKG_DIR, 'framework-docs');

//? [sourceRelativeToRepoRoot, destRelativeToOutDir, isDirectory]
const ENTRIES = [
  ['CLAUDE.md', 'CLAUDE.md', false],
  ['docs', 'docs', true],
  ['skills', 'skills', true],
  [path.join('.claude', 'commands'), 'claude-commands', true],
  [path.join('branch-logs', 'README.md'), 'branch-logs-README.md', false],
];

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

let copied = 0;
for (const [srcRel, dstRel, isDir] of ENTRIES) {
  const src = path.join(REPO_ROOT, srcRel);
  const dst = path.join(OUT_DIR, dstRel);
  if (!fs.existsSync(src)) {
    console.warn(`[bundleFrameworkDocs] missing (skipped): ${srcRel}`);
    continue;
  }
  if (isDir) {
    fs.cpSync(src, dst, { recursive: true });
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  copied++;
}

console.log(`[bundleFrameworkDocs] bundled ${String(copied)}/${String(ENTRIES.length)} doc source(s) into framework-docs/`);
