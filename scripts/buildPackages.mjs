#!/usr/bin/env node
//? Builds every framework package via its own tsup config.
//?
//? Topology:
//?   wave 1 → core                                         (no @luckystack deps)
//?   wave 2 → error-tracking, email, login, devkit, router,
//?            test-runner, create-luckystack-app, docs-ui  (depend on core only — or nothing)
//?   wave 3 → api, sync, presence                          (depend on login + core)
//?   wave 4 → server                                       (depends on api, sync, presence, login, core)
//?
//? Within a wave packages build in parallel. Across waves we wait so the next
//? wave can resolve dts paths against freshly-emitted dist files.
//?
//? Each package's stdout/stderr is captured and replayed on completion so
//? interleaved parallel logs don't become unreadable. A summary table prints
//? at the end with per-package status + timing.
//?
//? Usage:
//?   node scripts/buildPackages.mjs                  # build all
//?   node scripts/buildPackages.mjs --pack-dry-run   # build all, then npm pack --dry-run per package
//?   node scripts/buildPackages.mjs --serial         # disable parallelism (slow; debug)

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const WAVES = [
  ['core'],
  ['email', 'login', 'devkit', 'router', 'test-runner', 'create-luckystack-app', 'docs-ui', 'env-resolver'],
  // error-tracking depends on @luckystack/login for the postLogout hook
  // payload augmentation (auto-instrumentation type-checks 'postLogout' as
  // a keyof HookPayloads, which is only populated when login is in scope).
  // Place it AFTER login is built so its dist/index.d.ts is resolvable.
  ['error-tracking'],
  ['api', 'sync', 'presence'],
  ['server'],
];

const ALL_PACKAGES = WAVES.flat();

const args = new Set(process.argv.slice(2));
const dryPack = args.has('--pack-dry-run');
const serial = args.has('--serial');

const COLORS = process.stdout.isTTY
  ? {
      reset: '[0m',
      bold: '[1m',
      dim: '[2m',
      red: '[31m',
      green: '[32m',
      yellow: '[33m',
      cyan: '[36m',
    }
  : { reset: '', bold: '', dim: '', red: '', green: '', yellow: '', cyan: '' };

const formatDuration = (ms) => {
  if (ms < 1000) return `${String(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

const runOne = (name, command, commandArgs) =>
  new Promise((resolve) => {
    const cwd = path.join('packages', name);
    const startedAt = Date.now();
    const child = spawn(command, commandArgs, {
      cwd,
      shell: true,
      env: { ...process.env, FORCE_COLOR: '1' },
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

const printResult = (result) => {
  const status = result.ok
    ? `${COLORS.green}OK${COLORS.reset}`
    : `${COLORS.red}FAILED${COLORS.reset}`;
  const header = `${COLORS.bold}=== @luckystack/${result.name} — ${status} (${formatDuration(result.durationMs)}) ===${COLORS.reset}`;
  process.stdout.write(`\n${header}\n`);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
};

const runWave = async (wave) => {
  if (serial) {
    const results = [];
    for (const name of wave) {
      const result = await runOne(name, 'npm', ['run', 'build']);
      printResult(result);
      results.push(result);
    }
    return results;
  }
  const inFlight = wave.map((name) => runOne(name, 'npm', ['run', 'build']));
  const results = await Promise.all(inFlight);
  for (const result of results) printResult(result);
  return results;
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
  const allResults = [];

  for (const [waveIndex, wave] of WAVES.entries()) {
    process.stdout.write(
      `\n${COLORS.cyan}${COLORS.bold}── wave ${String(waveIndex + 1)}/${String(WAVES.length)}: ${wave.join(', ')}${COLORS.reset}\n`,
    );

    const results = await runWave(wave);
    allResults.push(...results);

    if (results.some((r) => !r.ok)) {
      //? Stop the build sequence on the first wave that has any failures —
      //? later waves' packages depend on the failed ones' freshly-built dts,
      //? so continuing would just produce noise on top of the real error.
      const remaining = WAVES.slice(waveIndex + 1).flat();
      for (const skipped of remaining) {
        allResults.push({
          name: skipped,
          ok: false,
          durationMs: 0,
          stdout: '',
          stderr: `(skipped — earlier wave failed)\n`,
        });
      }
      break;
    }
  }

  if (dryPack && allResults.every((r) => r.ok)) {
    process.stdout.write(`\n${COLORS.cyan}${COLORS.bold}── pack --dry-run (parallel)${COLORS.reset}\n`);
    const packResults = serial
      ? await (async () => {
          const out = [];
          for (const name of ALL_PACKAGES) {
            const result = await runOne(name, 'npm', ['pack', '--dry-run']);
            printResult(result);
            out.push(result);
          }
          return out;
        })()
      : await (async () => {
          const inFlight = ALL_PACKAGES.map((name) => runOne(name, 'npm', ['pack', '--dry-run']));
          const out = await Promise.all(inFlight);
          for (const r of out) printResult(r);
          return out;
        })();

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
