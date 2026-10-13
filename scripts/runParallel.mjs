#!/usr/bin/env node
//? Runs independent commands at the same time inside one thread budget:
//?   node scripts/runParallel.mjs "4:npm run lint" "tsc -b" "vite build"
//? The budget (scripts/threadBudget.mjs) is split by weight (the optional
//? `<n>:` prefix, default 1): give the long CPU-bound jobs more, so the short
//? ones do not hold threads that sit idle after they finish. Each command gets
//? its share through LUCKYSTACK_MAX_THREADS plus the GOMAXPROCS /
//? RAYON_NUM_THREADS caps, so the tools together never ask for more threads
//? than the budget.
//? Output is buffered per command and printed when it finishes, so parallel
//? logs stay readable. Exits non-zero when any command fails; the others still
//? finish, so one run reports every failure.
import { spawn } from 'node:child_process';
import process from 'node:process';

import { getThreadBudget, splitThreads, threadEnv } from './threadBudget.mjs';

const tasks = process.argv.slice(2).map((arg) => {
  const match = /^(\d+):(.*)$/s.exec(arg);
  return match ? { weight: Math.max(1, Number(match[1])), command: match[2] } : { weight: 1, command: arg };
});
if (tasks.length === 0) {
  process.stderr.write('usage: node scripts/runParallel.mjs "[<weight>:]<command>" ...\n');
  process.exit(2);
}
const commands = tasks.map((task) => task.command);

const color = process.stdout.isTTY;
const paint = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
const formatSeconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

const budget = getThreadBudget();
const shares = splitThreads(budget, tasks.map((task) => task.weight));
process.stdout.write(
  paint('36', `── running ${String(commands.length)} commands in parallel (${String(budget)} threads: ${shares.join(' + ')})\n`),
);

const run = (command, threads) =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    const chunks = [];
    const child = spawn(command, {
      shell: true,
      env: { ...threadEnv(threads), FORCE_COLOR: color ? '1' : '0' },
    });
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => chunks.push(chunk));
    const finish = (ok) => {
      const result = { command, ok, durationMs: Date.now() - startedAt };
      const status = ok ? paint('32', 'OK') : paint('31', 'FAILED');
      process.stdout.write(`\n${paint('1', `=== ${command} — ${status} (${formatSeconds(result.durationMs)}, ${String(threads)} threads) ===`)}\n`);
      process.stdout.write(Buffer.concat(chunks));
      resolve(result);
    };
    child.on('error', (err) => {
      chunks.push(Buffer.from(`spawn error: ${String(err)}\n`));
      finish(false);
    });
    child.on('close', (code) => finish(code === 0));
  });

const results = await Promise.all(commands.map((command, index) => run(command, shares[index])));
const failed = results.filter((result) => !result.ok);
process.stdout.write(
  `\n${failed.length === 0
    ? paint('32', `${String(results.length)}/${String(results.length)} succeeded`)
    : paint('31', `${String(failed.length)} failed: ${failed.map((result) => result.command).join(', ')}`)}\n`,
);
process.exit(failed.length === 0 ? 0 : 1);
