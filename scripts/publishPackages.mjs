#!/usr/bin/env node
//? Publishes every @luckystack/* package to npm in dependency-wave order.
//?
//? PREREQUISITES (do these once, by hand):
//?   1. `npm login` as an account that is a member of the `@luckystack` org.
//?   2. The org must exist: `npm org create luckystack` (one-time).
//?   3. A clean working tree committed + tagged (this script does NOT commit).
//?
//? This script ALWAYS runs a fresh `npm run build:packages` first so no stale
//? dist is shipped, then publishes each package with `--access public` and npm
//? PROVENANCE (`--provenance`). Across waves it follows the dependency topology
//? so a consumer who installs the moment a package lands can already resolve its
//? @luckystack peers/deps.
//?
//? PROVENANCE: every package.json also sets `publishConfig.provenance: true`, so
//? `npm publish` attaches a signed provenance attestation linking the tarball to
//? the building workflow + commit. This REQUIRES a provenance-capable CI with an
//? OIDC id-token (GitHub Actions `permissions: id-token: write` — see the
//? `publish` job in `.github/workflows/ci.yml`). The `--provenance` flag is only
//? passed on a real publish; a local `--dry-run` skips it because there is no
//? OIDC token outside CI and npm would otherwise abort.
//?
//? Usage:
//?   node scripts/publishPackages.mjs --dry-run        # `npm publish --dry-run` per package (no upload, no provenance)
//?   node scripts/publishPackages.mjs                  # real publish (with provenance — CI only)
//?   node scripts/publishPackages.mjs --no-provenance  # real publish from a dev machine (no OIDC available;
//?                                                     # overrides the package.json `publishConfig.provenance: true`)

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

//? Idempotency: npm refuses to re-publish an already-uploaded version, which used
//? to abort the whole run on the first package a prior (partial) run had already
//? shipped — forcing a manual finish. So before each publish we ask the registry
//? whether THIS package@version already exists and skip it if so. A re-run after a
//? mid-way failure then simply completes the remaining packages.
const readPkg = (dir) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', dir, 'package.json'), 'utf8'));

const isAlreadyPublished = (dir) => {
  const pkg = readPkg(dir);
  const res = spawnSync('npm', ['view', `${pkg.name}@${pkg.version}`, 'version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  //? `npm view <name>@<missing>` exits non-zero (E404); an existing version prints
  //? the version on stdout. Only treat an exact match as "already published".
  return res.status === 0 && res.stdout.trim() === pkg.version;
};

//? Publish order = dependency order (core first, the CLI last). `create-luckystack-app`
//? carries no @luckystack runtime deps but is published last so every package its
//? scaffold references is already on the registry.
const WAVES = [
  ['core'],
  ['email', 'login', 'devkit', 'router', 'test-runner', 'secret-manager', 'mcp', 'cron'],
  ['error-tracking'],
  ['api', 'sync', 'presence'],
  ['server'],
  //? docs-ui's ./register imports @luckystack/server; publish it after server.
  ['docs-ui'],
  //? Tools last: @luckystack/cli + the scaffold reference every runtime package.
  ['cli', 'create-luckystack-app'],
];

const flags = new Set(process.argv.slice(2));
const dryRun = flags.has('--dry-run');
//? Local machines have no OIDC token; `publishConfig.provenance: true` in every
//? package.json would make plain `npm publish` abort, so an explicit override
//? flag is needed for a non-CI release (same approach as the v0.5.0 release).
const noProvenance = flags.has('--no-provenance');

const run = (cmd, args, cwd) =>
  spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' }).status === 0;

console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Step 1/2 — clean build of all packages…\n`);
if (!run('npm', ['run', 'build:packages'], ROOT)) {
  console.error('\nBuild failed — aborting before any publish.');
  process.exit(1);
}

console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Step 2/2 — publishing in dependency-wave order…`);
const done = [];
const skipped = [];
for (const wave of WAVES) {
  for (const name of wave) {
    //? Skip versions already on the registry so a re-run after a partial failure
    //? finishes the rest instead of aborting. (A dry-run still exercises every
    //? package — it never uploads, so there's nothing to skip.)
    if (!dryRun && isAlreadyPublished(name)) {
      console.log(`\n• (packages/${name}) already published at this version — skipping.`);
      skipped.push(name);
      continue;
    }
    const provenanceArgs = noProvenance ? ['--provenance=false'] : ['--provenance'];
    const args = ['publish', '--access', 'public', ...(dryRun ? ['--dry-run'] : provenanceArgs)];
    console.log(`\n→ (packages/${name}) npm ${args.join(' ')}`);
    if (!run('npm', args, path.join(ROOT, 'packages', name))) {
      console.error(`\nPublish FAILED for @luckystack/${name}. Done this run: ${done.join(', ') || '(none)'}; skipped (already published): ${skipped.join(', ') || '(none)'}.`);
      console.error('Fix the cause, then re-run — the script now skips already-uploaded versions, so a re-run completes the remaining packages.');
      process.exit(1);
    }
    done.push(name);
  }
}

const skipNote = skipped.length > 0 ? ` (skipped ${String(skipped.length)} already-published: ${skipped.join(', ')})` : '';
console.log(`\n✅ ${dryRun ? '[dry-run] validated' : 'published'} ${String(done.length)} packages: ${done.join(', ') || '(none)'}${skipNote}`);
