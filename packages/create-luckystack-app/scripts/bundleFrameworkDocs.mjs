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

//? Framework-internal doc folders that are NOT consumer documentation: retired
//? one-off docs and in-flight planning notes. They would otherwise ride along in
//? every npm tarball and land in every scaffolded project's docs/luckystack/.
//? Matched against the top-level entry name under the repo's `docs/`.
const EXCLUDED_DOC_DIRS = new Set(['_archive', 'plans']);

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
    fs.cpSync(src, dst, {
      recursive: true,
      //? Only top-level entries directly under the copied dir are filtered —
      //? a nested `plans/` inside a package's docs stays untouched.
      filter: (from) => !(path.dirname(from) === src && EXCLUDED_DOC_DIRS.has(path.basename(from))),
    });
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  copied++;
}

//? The framework's OWN generated artifacts + record instances must not ride
//? along in the tarball. They describe the FRAMEWORK repo, so in a consumer
//? project they sit next to the identically-named files that project generates
//? for itself — a second, authoritative-looking answer that is wrong about this
//? codebase (an eval scenario citing "ADR 0007" finds a real-but-unrelated 0007).
//? They are also gitignored here, so on a clean CI checkout they may not exist
//? at all and the bundle must not depend on them. The CONVENTIONS still ship:
//? every protocol, ARCHITECTURE_* deep-dive and findings/README.md is copied.
//? Mirrors FRAMEWORK_OWN_RECORDS in src/index.ts — keep both in step.
const FRAMEWORK_OWN_RECORDS = [
  'AI_QUICK_INDEX.md',
  'AI_CAPABILITIES.md',
  'AI_PROJECT_INDEX.md',
  'AI_DECISIONS_INDEX.md',
  'AI_LESSONS_INDEX.md',
  'AI_PRODUCT_OVERVIEW.md',
  'ai-graph.json',
  'ai-product',
  'decisions',
  'lessons',
];

let stripped = 0;
for (const entry of FRAMEWORK_OWN_RECORDS) {
  const target = path.join(OUT_DIR, 'docs', entry);
  if (!fs.existsSync(target)) continue;
  fs.rmSync(target, { recursive: true, force: true });
  stripped++;
}

console.log(`[bundleFrameworkDocs] bundled ${String(copied)}/${String(ENTRIES.length)} doc source(s) into framework-docs/ (stripped ${String(stripped)} framework-own record artifact(s))`);
