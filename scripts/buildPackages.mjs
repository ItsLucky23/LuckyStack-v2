#!/usr/bin/env node
//? Builds every framework package: JavaScript through each package's own tsup
//? config, declarations through ONE TypeScript 7 solution build
//? (`tsc -b tsconfig.packages.json`).
//?
//? Why no waves: tsup only bundles JavaScript and keeps @luckystack/* external,
//? so no package needs another package's dist to build. The only cross-package
//? dependency is in the declarations, and `tsc -b` orders those itself from each
//? package tsconfig's `references`, building independent packages in parallel.
//? So every tsup build and the declaration build start at once, sharing one
//? thread budget (scripts/threadBudget.mjs, LUCKYSTACK_MAX_THREADS).
//?
//? The declaration outputs are cleaned first (`tsc -b --clean`) so a published
//? dist never carries a stale .d.ts for a deleted source file; tsup's own clean
//? removes only JavaScript, so the two writers never delete each other's files.
//? After emit, relative declaration imports get explicit `.js` paths so
//? NodeNext consumers resolve them (scripts/fixDeclarationSpecifiers.mjs).
//?
//? Each build's stdout/stderr is captured and replayed on completion so
//? interleaved parallel logs stay readable. A summary table prints at the end.
//?
//? Usage:
//?   node scripts/buildPackages.mjs                  # build all
//?   node scripts/buildPackages.mjs --pack-dry-run   # build all, then npm pack --dry-run per package
//?   node scripts/buildPackages.mjs --serial         # one build at a time, single-threaded (debug)

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

import { fixDeclarationSpecifiers } from './fixDeclarationSpecifiers.mjs';
import { getThreadBudget, threadEnv } from './threadBudget.mjs';

const ALL_PACKAGES = [
  'core',
  'email',
  'login',
  'devkit',
  'router',
  'create-luckystack-app',
  'secret-manager',
  'mcp',
  'cron',
  'error-tracking',
  'test-runner',
  'api',
  'sync',
  'presence',
  'server',
  'docs-ui',
  'cli',
];

const DECLARATIONS = 'declarations';

const args = new Set(process.argv.slice(2));
const dryPack = args.has('--pack-dry-run');
const serial = args.has('--serial');

const budget = serial ? 1 : getThreadBudget();
//? tsc 7 gets a quarter of the budget: the declaration build is one process over
//? small projects, while the 17 tsup builds are each a short, mostly
//? single-threaded esbuild run that parallelises better across processes.
const declarationThreads = Math.max(1, Math.floor(budget / 4));
const bundleSlots = serial ? 1 : Math.max(1, budget - declarationThreads);

const COLORS = process.stdout.isTTY
  ? {
      reset: '\x1b[0m',
      bold: '\x1b[1m',
      dim: '\x1b[2m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      cyan: '\x1b[36m',
    }
  : { reset: '', bold: '', dim: '', red: '', green: '', yellow: '', cyan: '' };

const formatDuration = (ms) => {
  if (ms < 1000) return `${String(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

const run = ({ name, cwd, command, commandArgs, threads }) =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, commandArgs, {
      cwd,
      shell: true,
      env: { ...threadEnv(threads), FORCE_COLOR: '1' },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      resolve({
        name,
        ok: code === 0,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      });
    });
    child.on('error', (err) => {
      resolve({
        name,
        ok: false,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr: stderr + `\nspawn error: ${String(err)}\n`,
      });
    });
  });

const runInPackage = (name, commandArgs) =>
  run({ name, cwd: path.join('packages', name), command: 'npm', commandArgs, threads: 1 });

//? Runs `task` for every item with at most `slots` in flight, keeping input order.
const pool = async (items, slots, task) => {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(slots, items.length) }, worker));
  return results;
};

const tscArgs = (extra) => [
  'tsc',
  '-b',
  'tsconfig.packages.json',
  ...(serial
    ? ['--singleThreaded']
    : ['--builders', String(declarationThreads), '--checkers', String(Math.min(2, declarationThreads))]),
  ...extra,
];

const printResult = (result) => {
  const status = result.ok
    ? `${COLORS.green}OK${COLORS.reset}`
    : `${COLORS.red}FAILED${COLORS.reset}`;
  const label = result.name === DECLARATIONS ? 'declarations (tsc -b)' : `@luckystack/${result.name}`;
  const header = `${COLORS.bold}=== ${label} — ${status} (${formatDuration(result.durationMs)}) ===${COLORS.reset}`;
  process.stdout.write(`\n${header}\n`);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
};

const printSummary = (results, totalMs) => {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const longestName = Math.max(...results.map((r) => r.name.length), 4);

  process.stdout.write(`\n${COLORS.bold}── build:packages summary ──${COLORS.reset}\n`);
  for (const r of results) {
    const padded = r.name.padEnd(longestName, ' ');
    const status = r.ok ? `${COLORS.green}OK    ${COLORS.reset}` : `${COLORS.red}FAILED${COLORS.reset}`;
    process.stdout.write(`  ${status}  ${padded}  ${COLORS.dim}${formatDuration(r.durationMs)}${COLORS.reset}\n`);
  }

  const headline = failed.length === 0
    ? `${COLORS.green}${COLORS.bold}${String(ok.length)}/${String(results.length)} succeeded${COLORS.reset}`
    : `${COLORS.red}${COLORS.bold}${String(failed.length)} failed${COLORS.reset}, ${String(ok.length)} succeeded`;
  process.stdout.write(`\n  ${headline} ${COLORS.dim}in ${formatDuration(totalMs)}${COLORS.reset}\n`);
  if (failed.length > 0) {
    process.stdout.write(`  ${COLORS.red}↑ packages above this line failed; scroll up for their captured logs.${COLORS.reset}\n`);
  }
};

const main = async () => {
  const startedAt = Date.now();

  const cleaned = await run({
    name: DECLARATIONS,
    cwd: '.',
    command: 'npx',
    commandArgs: tscArgs(['--clean']),
    threads: 1,
  });
  if (!cleaned.ok) {
    printResult(cleaned);
    process.exit(1);
  }

  process.stdout.write(
    `\n${COLORS.cyan}${COLORS.bold}── building ${String(ALL_PACKAGES.length)} packages + declarations (${String(budget)} threads: ${String(declarationThreads)} tsc, ${String(bundleSlots)} tsup)${COLORS.reset}\n`,
  );

  const [declarations, bundles] = await Promise.all([
    run({ name: DECLARATIONS, cwd: '.', command: 'npx', commandArgs: tscArgs([]), threads: declarationThreads }),
    pool(ALL_PACKAGES, bundleSlots, async (name) => {
      const result = await runInPackage(name, ['run', 'build']);
      printResult(result);
      return result;
    }),
  ]);
  if (declarations.ok) {
    const unresolved = ALL_PACKAGES.flatMap((name) => fixDeclarationSpecifiers(path.join('packages', name, 'dist')));
    if (unresolved.length > 0) {
      declarations.ok = false;
      declarations.stderr += `\nUnresolvable relative imports in emitted declarations:\n  ${unresolved.join('\n  ')}\n`;
    }
  }
  printResult(declarations);
  const allResults = [declarations, ...bundles];

  if (dryPack && allResults.every((r) => r.ok)) {
    process.stdout.write(`\n${COLORS.cyan}${COLORS.bold}── pack --dry-run${COLORS.reset}\n`);
    const packResults = await pool(ALL_PACKAGES, budget, async (name) => {
      const result = await runInPackage(name, ['pack', '--dry-run']);
      printResult(result);
      return result;
    });

    const failed = packResults.filter((r) => !r.ok);
    if (failed.length > 0) {
      process.stdout.write(`\n${COLORS.red}${COLORS.bold}pack --dry-run failed for ${String(failed.length)} package(s)${COLORS.reset}\n`);
      process.exit(1);
    }
  }

  printSummary(allResults, Date.now() - startedAt);
  process.exit(allResults.some((r) => !r.ok) ? 1 : 0);
};

main().catch((err) => {
  process.stderr.write(`\n[buildPackages] uncaught: ${String(err)}\n`);
  process.exit(1);
});
