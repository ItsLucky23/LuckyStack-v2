#!/usr/bin/env node
//? Runs one command inside the thread budget (scripts/threadBudget.mjs):
//?   node scripts/withThreads.mjs [--mb-per-thread N] [--max-threads N] eslint . --concurrency {threads}
//? `{threads}` in an argument becomes the budget, and the child gets the
//? GOMAXPROCS / RAYON_NUM_THREADS caps. Standalone the budget is the whole
//? machine (or LUCKYSTACK_MAX_THREADS); under scripts/runParallel.mjs it is
//? this command's share, because the runner sets LUCKYSTACK_MAX_THREADS.
//?
//? `--mb-per-thread` also caps the count by memory, for tools whose threads
//? each hold a full copy of their state: a type-aware ESLint worker builds its
//? own TypeScript program (~2 GB in this repo), so a thread per core would
//? exhaust RAM long before the CPU is busy. The cap keeps the threads within
//? a quarter of total memory.
//?
//? `--max-threads` caps the count outright, for tools that stop scaling early.
//? Every type-aware ESLint worker builds the whole program again, so past ~3
//? workers the duplicated work outweighs the parallelism: measured cold here,
//? 3 workers took 29 s and 124 CPU-s, 6 workers 35 s and 239 CPU-s (ESLint
//? itself warns `ESLintPoorConcurrencyWarning`).
import { spawn } from 'node:child_process';
import os from 'node:os';
import process from 'node:process';

import { getThreadBudget, threadEnv } from './threadBudget.mjs';

const argv = process.argv.slice(2);
let mbPerThread = 0;
let maxThreads = Number.POSITIVE_INFINITY;
while (argv[0] === '--mb-per-thread' || argv[0] === '--max-threads') {
  const value = Number.parseInt(argv[1] ?? '', 10);
  if (argv[0] === '--mb-per-thread') mbPerThread = value;
  else maxThreads = value > 0 ? value : Number.NaN;
  argv.splice(0, 2);
}
const [command, ...commandArgs] = argv;
if (!command || Number.isNaN(mbPerThread) || Number.isNaN(maxThreads)) {
  process.stderr.write('usage: node scripts/withThreads.mjs [--mb-per-thread N] [--max-threads N] <command> [args...]  ({threads} = thread budget)\n');
  process.exit(2);
}

const memoryCap = mbPerThread > 0
  ? Math.max(1, Math.floor((os.totalmem() / 1024 / 1024) * 0.25 / mbPerThread))
  : Number.POSITIVE_INFINITY;
const threads = Math.min(getThreadBudget(), memoryCap, maxThreads);

const child = spawn(command, commandArgs.map((arg) => arg.replaceAll('{threads}', String(threads))), {
  stdio: 'inherit',
  env: threadEnv(threads),
  //? npm puts node_modules/.bin on PATH; Windows needs the shell to run its .cmd shims.
  shell: process.platform === 'win32',
});
child.on('error', (err) => {
  process.stderr.write(`[withThreads] ${command}: ${String(err)}\n`);
  process.exit(1);
});
child.on('close', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1));
});
