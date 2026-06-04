#!/usr/bin/env node
//? Publishes every @luckystack/* package to npm in dependency-wave order.
//?
//? PREREQUISITES (do these once, by hand):
//?   1. `npm login` as an account that is a member of the `@luckystack` org.
//?   2. The org must exist: `npm org create luckystack` (one-time).
//?   3. A clean working tree committed + tagged (this script does NOT commit).
//?
//? This script ALWAYS runs a fresh `npm run build:packages` first so no stale
//? dist is shipped, then publishes each package with `--access public`. Across
//? waves it follows the dependency topology so a consumer who installs the
//? moment a package lands can already resolve its @luckystack peers/deps.
//?
//? Usage:
//?   node scripts/publishPackages.mjs --dry-run   # `npm publish --dry-run` per package (no upload)
//?   node scripts/publishPackages.mjs             # real publish

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

//? Publish order = dependency order (core first, the CLI last). `create-luckystack-app`
//? carries no @luckystack runtime deps but is published last so every package its
//? scaffold references is already on the registry.
const WAVES = [
  ['core'],
  ['email', 'login', 'devkit', 'router', 'test-runner', 'docs-ui', 'secret-manager'],
  ['error-tracking'],
  ['api', 'sync', 'presence'],
  ['server'],
  ['create-luckystack-app'],
];

const dryRun = new Set(process.argv.slice(2)).has('--dry-run');

const run = (cmd, args, cwd) =>
  spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' }).status === 0;

console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Step 1/2 — clean build of all packages…\n`);
if (!run('npm', ['run', 'build:packages'], ROOT)) {
  console.error('\nBuild failed — aborting before any publish.');
  process.exit(1);
}

console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Step 2/2 — publishing in dependency-wave order…`);
const done = [];
for (const wave of WAVES) {
  for (const name of wave) {
    const args = ['publish', '--access', 'public', ...(dryRun ? ['--dry-run'] : [])];
    console.log(`\n→ (packages/${name}) npm ${args.join(' ')}`);
    if (!run('npm', args, path.join(ROOT, 'packages', name))) {
      console.error(`\nPublish FAILED for @luckystack/${name}. Already done this run: ${done.join(', ') || '(none)'}.`);
      console.error('Fix the cause, then re-run — npm will refuse to re-publish an already-uploaded version, so finish the remaining packages manually if needed.');
      process.exit(1);
    }
    done.push(name);
  }
}

console.log(`\n✅ ${dryRun ? '[dry-run] validated' : 'published'} ${String(done.length)} packages: ${done.join(', ')}`);
