#!/usr/bin/env node
//? Production audit gate with one narrow, reachability-reviewed exception.
//? New advisories, changed ranges, or additional packages still fail closed.

import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error('[audit:production] npm_execpath is unavailable; run through `npm run audit:production`.');
  process.exit(1);
}

const audit = spawnSync(process.execPath, [npmCli, 'audit', '--omit=dev', '--json'], {
  cwd: root,
  encoding: 'utf8',
  shell: false,
});

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  console.error('[audit:production] npm audit did not return valid JSON.');
  if (audit.stderr) console.error(audit.stderr.trim());
  process.exit(1);
}

const vulnerabilities = report?.vulnerabilities;
if (!vulnerabilities || typeof vulnerabilities !== 'object') {
  console.error('[audit:production] npm audit JSON has no vulnerabilities map.');
  process.exit(1);
}

const acceptedReactRouterAdvisory = 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2';
const reactRouter = vulnerabilities['react-router'];
const reactRouterVia = Array.isArray(reactRouter?.via) ? reactRouter.via : [];
const reactRouterExceptionMatches = reactRouterVia.length > 0 && reactRouterVia.every((entry) =>
  typeof entry === 'object'
  && entry !== null
  && entry.url === acceptedReactRouterAdvisory
  && entry.severity === 'high');

const isAcceptedHigh = (name, vulnerability) => {
  if (name === 'react-router') return reactRouterExceptionMatches;
  if (name === 'react-router-dom') {
    return reactRouterExceptionMatches
      && Array.isArray(vulnerability.via)
      && vulnerability.via.length > 0
      && vulnerability.via.every((entry) => entry === 'react-router');
  }
  return false;
};

const blocking = [];
for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
  if (!vulnerability || typeof vulnerability !== 'object') continue;
  if (vulnerability.severity !== 'high' && vulnerability.severity !== 'critical') continue;
  if (!isAcceptedHigh(name, vulnerability)) blocking.push(`${name} (${vulnerability.severity})`);
}

if (blocking.length > 0) {
  console.error(`[audit:production] blocking vulnerabilities: ${blocking.join(', ')}`);
  process.exit(1);
}

if (reactRouterExceptionMatches) {
  console.warn('[audit:production] accepted GHSA-qwww-vcr4-c8h2 for React Router: LuckyStack does not use RSC/action transport; exact-advisory allowlist matched.');
}
const counts = report.metadata?.vulnerabilities ?? {};
console.log(`[audit:production] pass — critical=${counts.critical ?? 0}, high=${counts.high ?? 0}, moderate=${counts.moderate ?? 0}; no unreviewed high/critical advisories.`);
