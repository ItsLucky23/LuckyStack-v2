#!/usr/bin/env node
//? Builds every framework package via its own tsup config.
//? Order matters: build core first so leaf packages' dts steps can resolve
//? @luckystack/core via the workspace tsconfig paths (paths point at source,
//? not dist, so build order isn't load-order-critical, but a topological
//? order keeps logs predictable and makes future migration to workspaces
//? trivial).
//?
//? Usage:
//?   node scripts/buildPackages.mjs            # build all
//?   node scripts/buildPackages.mjs --pack-dry-run  # build all, then npm pack --dry-run

import { execSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const ORDER = [
  'core',
  'sentry',
  'login',
  'api',
  'sync',
  'presence',
  'server',
  'test-runner',
  'devkit',
  'router',
];

const args = new Set(process.argv.slice(2));
const dryPack = args.has('--pack-dry-run');

let failed = false;

for (const name of ORDER) {
  const cwd = path.join('packages', name);
  process.stdout.write(`\n=== Building @luckystack/${name} ===\n`);
  try {
    execSync('npm run build', { cwd, stdio: 'inherit' });
  } catch {
    failed = true;
    process.stdout.write(`\n[buildPackages] @luckystack/${name} failed.\n`);
    break;
  }

  if (dryPack) {
    process.stdout.write(`\n--- npm pack --dry-run @luckystack/${name} ---\n`);
    try {
      execSync('npm pack --dry-run', { cwd, stdio: 'inherit' });
    } catch {
      failed = true;
      process.stdout.write(`\n[buildPackages] pack dry-run for @luckystack/${name} failed.\n`);
      break;
    }
  }
}

process.exit(failed ? 1 : 0);
