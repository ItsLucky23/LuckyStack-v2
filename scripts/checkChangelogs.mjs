// scripts/checkChangelogs.mjs
//
// Report-only CHANGELOG-completeness check (npm run ai:changelog-check).
//
// The upgrade story ("read the CHANGELOG gap between installed and target") is
// only as good as the CHANGELOGs. Historical gaps (packages whose CHANGELOG has
// no entry for a version that actually shipped) prove this can slip. This check
// prevents NEW gaps: for every publishable package that CHANGED since the last
// release tag, it verifies the package's CHANGELOG.md was also touched (i.e. an
// entry was added). A pure lockstep version bump (only package.json changed) is
// NOT flagged — those don't warrant a changelog entry.
//
// Report-only: ALWAYS exits 0 (a nudge before a release, not a hard gate). Run it
// before publishing; wire it into the pre-commit hook as a backstop. Framework
// repo only — a consumer project has no packages/*/CHANGELOG.md, so this does not
// ship to consumers.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES_DIR = path.join(ROOT, 'packages');

const git = (args) => execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf8' }).trim();

let baseTag = '';
try {
  baseTag = git('describe --tags --abbrev=0 --match "v*"');
} catch {
  //? No release tag yet — nothing to diff against.
}

if (!baseTag) {
  console.log('[ai:changelog-check] no v* release tag found — skipping (nothing to diff against).');
  process.exit(0);
}

let changedFiles = [];
try {
  //? Diff the WORKING TREE (not just HEAD) against the tag so uncommitted /
  //? staged changes count — needed for the pre-commit backstop, where the
  //? CHANGELOG edit being committed alongside the code change must satisfy it.
  changedFiles = git(`diff --name-only ${baseTag}`).split('\n').filter(Boolean);
} catch (error) {
  console.log(`[ai:changelog-check] could not diff against ${baseTag} (${error instanceof Error ? error.message : String(error)}) — skipping.`);
  process.exit(0);
}

const isIgnorable = (file) =>
  file.endsWith('/package.json') || file.endsWith('/package-lock.json') || file.endsWith('/CHANGELOG.md');

const problems = [];
for (const entry of fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pkgJsonPath = path.join(PACKAGES_DIR, entry.name, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) continue; // reserved placeholder dirs (e.g. env-resolver)
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  } catch {
    continue;
  }
  if (meta.private || typeof meta.version !== 'string') continue;

  const prefix = `packages/${entry.name}/`;
  const changed = changedFiles.filter((f) => f.startsWith(prefix));
  const codeChanged = changed.some((f) => !isIgnorable(f));
  const changelogTouched = changed.some((f) => f.endsWith('/CHANGELOG.md'));
  if (!codeChanged || changelogTouched) continue;

  const hasChangelog = fs.existsSync(path.join(PACKAGES_DIR, entry.name, 'CHANGELOG.md'));
  problems.push({
    name: meta.name ?? entry.name,
    reason: hasChangelog ? `changed since ${baseTag} but CHANGELOG.md was not updated` : 'changed and has NO CHANGELOG.md',
  });
}

if (problems.length === 0) {
  console.log(`[ai:changelog-check] every package changed since ${baseTag} has a CHANGELOG update.`);
} else {
  console.log(`[ai:changelog-check] ${String(problems.length)} package(s) changed since ${baseTag} without a CHANGELOG entry (report-only):`);
  for (const problem of problems) {
    console.log(`  - ${problem.name}: ${problem.reason}`);
  }
  console.log('  → Add an "### Added/Fixed/Changed" bullet under [Unreleased] so "read the CHANGELOG gap" upgrades stay complete.');
}
process.exit(0);
