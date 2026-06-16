#!/usr/bin/env node
//? Bumps every publishable @luckystack/* package by a semver direction
//? (patch / minor / major), in lockstep. Reads the current shared version,
//? computes the next one, then delegates to setPackageVersions.mjs (which also
//? rewrites every internal `^` dependency range). Decoupled from publishing on
//? purpose: bump, review the diff, then `npm run publish:packages`.
//?
//? Usage:
//?   npm run bump patch              # 0.1.8 -> 0.1.9
//?   npm run bump minor             # 0.1.8 -> 0.2.0
//?   npm run bump major             # 0.1.8 -> 1.0.0
//?   npm run bump patch -- --dry-run # print the change, write nothing
//?
//? Note the `--` before `--dry-run`: npm forwards the bare level word on its
//? own, but flags must come after `--` so npm doesn't swallow them.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SET_VERSIONS = path.join(ROOT, 'scripts', 'setPackageVersions.mjs');
//? Single source of truth for the current version — all 14 packages move in
//? lockstep, so any one of them works; core is always present.
const REFERENCE_PKG = path.join(ROOT, 'packages', 'core', 'package.json');

const LEVELS = new Set(['patch', 'minor', 'major']);

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const level = args.find((a) => !a.startsWith('-'));

if (!level || !LEVELS.has(level)) {
  console.error('Usage: npm run bump <patch|minor|major> [-- --dry-run]');
  console.error(`Got level: ${JSON.stringify(level)} (expected one of: patch, minor, major)`);
  process.exit(1);
}

if (!fs.existsSync(REFERENCE_PKG)) {
  console.error(`Cannot read current version — ${REFERENCE_PKG} not found.`);
  process.exit(1);
}

let current;
try {
  current = JSON.parse(fs.readFileSync(REFERENCE_PKG, 'utf8')).version;
} catch (error) {
  console.error(`Failed to parse ${REFERENCE_PKG}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current ?? '');
if (!match) {
  console.error(`Current version ${JSON.stringify(current)} is not a plain x.y.z semver — bump only handles release versions.`);
  process.exit(1);
}

let [, major, minor, patch] = match.map(Number);
if (level === 'major') { major += 1; minor = 0; patch = 0; }
else if (level === 'minor') { minor += 1; patch = 0; }
else { patch += 1; }

const next = `${major}.${minor}.${patch}`;
console.log(`${dryRun ? '[DRY RUN] ' : ''}bump (${level}): ${current} -> ${next}\n`);

const setArgs = [SET_VERSIONS, next, ...(dryRun ? ['--dry-run'] : [])];
const result = spawnSync(process.execPath, setArgs, { stdio: 'inherit' });
process.exit(result.status ?? 1);
