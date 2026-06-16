#!/usr/bin/env node
//? Sets every publishable package in packages/* to a target version in lockstep,
//? AND rewrites every internal @luckystack/* dependency range (dependencies,
//? devDependencies, peerDependencies, optionalDependencies) to `^<version>` so a
//? coordinated release stays self-consistent. Replaces the error-prone manual
//? edit of 14 package.json files on every bump.
//?
//? Usage:
//?   node scripts/setPackageVersions.mjs 0.1.5
//?   node scripts/setPackageVersions.mjs 0.1.5 --dry-run   # print changes, write nothing

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES_DIR = path.join(ROOT, 'packages');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const version = args.find((a) => !a.startsWith('-'));

if (!version || !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)) {
  console.error(`Usage: node scripts/setPackageVersions.mjs <version> [--dry-run]`);
  console.error(`Got version: ${JSON.stringify(version)} (must be semver, e.g. 0.1.5)`);
  process.exit(1);
}

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

//? Two-pass: parse + compute EVERY package's edits first, and only start
//? writing once all package.json files parsed cleanly. A malformed package N
//? used to throw an opaque stack AFTER packages 1..N-1 were already rewritten,
//? leaving a half-applied, un-publishable release.
const planned = [];

for (const name of fs.readdirSync(PACKAGES_DIR)) {
  const pkgPath = path.join(PACKAGES_DIR, name, 'package.json');
  if (!fs.existsSync(pkgPath)) continue;
  const raw = fs.readFileSync(pkgPath, 'utf8');
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch (error) {
    console.error(`Failed to parse ${pkgPath}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const before = [];
  if (pkg.version !== version) {
    before.push(`version ${pkg.version} -> ${version}`);
    pkg.version = version;
  }
  for (const field of DEP_FIELDS) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const dep of Object.keys(deps)) {
      if (!dep.startsWith('@luckystack/')) continue;
      const next = `^${version}`;
      if (deps[dep] !== next) {
        before.push(`${field}.${dep} ${deps[dep]} -> ${next}`);
        deps[dep] = next;
      }
    }
  }

  if (before.length > 0) {
    planned.push({ name, pkgPath, pkg, before });
  }
}

const changes = planned.map(({ name, before }) => ({ name, before }));

if (!dryRun) {
  for (const { pkgPath, pkg } of planned) {
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }
}

if (changes.length === 0) {
  console.log(`All packages already at ${version}. Nothing to change.`);
} else {
  console.log(`${dryRun ? '[DRY RUN] ' : ''}Set ${changes.length} package(s) to ${version}:`);
  for (const c of changes) {
    console.log(`\n  packages/${c.name}`);
    for (const line of c.before) console.log(`    - ${line}`);
  }
}
