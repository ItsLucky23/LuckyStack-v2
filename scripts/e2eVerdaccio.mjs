// scripts/e2eVerdaccio.mjs
//
// Local-registry end-to-end harness: publish real tarballs to a throwaway
// verdaccio, scaffold a project against it, install with a real package
// manager, and verify the result builds.
//
// WHY THIS EXISTS — read before "simplifying" it into a file:/overrides harness:
// a `file:` + `overrides` setup CANNOT test the real install path. The scaffolder
// and `luckystack add` resolve `@luckystack/*` by SEMVER from a registry, and a
// file: spec bypasses that resolution entirely. That difference is not academic:
// it is exactly where Bug H hid — a Windows `npm.cmd` space-in-path bug that
// silently broke `npx create-luckystack-app` for every standard Windows install
// and was missed by 1370 green unit tests. Only a real registry install caught it.
// The recipe used to live as prose in branch-logs/; this script is that recipe,
// made repeatable.
//
// NO VERSION BUMPING. A fresh verdaccio storage has never seen the current
// version, so the packages publish as-is. This deliberately avoids mutating
// every package.json (which would be unsafe when other work is in flight).
//
// Usage:
//   node scripts/e2eVerdaccio.mjs                          # npm + node (baseline)
//   node scripts/e2eVerdaccio.mjs --pm=bun                 # bun install, node runtime
//   node scripts/e2eVerdaccio.mjs --pm=bun --runtime=bun   # the full story
//   node scripts/e2eVerdaccio.mjs --keep                   # leave the project for inspection
//   node scripts/e2eVerdaccio.mjs --scaffold-args="--orm=prisma --db=sqlite --auth=none"
//
// Exit code is the number of failed steps (0 = all green), so CI can gate on it.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4873;
const REGISTRY = `http://localhost:${String(PORT)}/`;

//? Bun is not on PATH after a winget install until the shell restarts, so fall
//? back to the known install location before giving up.
const BUN_FALLBACK = path.join(
  os.homedir(),
  'AppData/Local/Microsoft/WinGet/Packages/Oven-sh.Bun_Microsoft.Winget.Source_8wekyb3d8bbwe/bun-windows-x64/bun.exe',
);

const parseArgs = () => {
  const out = { pm: 'npm', runtime: 'node', keep: false, scaffoldArgs: '--orm=prisma --db=sqlite --auth=none --no-ai-docs' };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--pm=')) out.pm = arg.slice(5);
    else if (arg.startsWith('--runtime=')) out.runtime = arg.slice(10);
    else if (arg === '--keep') out.keep = true;
    else if (arg.startsWith('--scaffold-args=')) out.scaffoldArgs = arg.slice(16);
    else {
      console.error(`[e2e] unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  if (!['npm', 'bun'].includes(out.pm)) {
    console.error(`[e2e] --pm must be npm or bun (got ${out.pm})`);
    process.exit(2);
  }
  if (!['node', 'bun'].includes(out.runtime)) {
    console.error(`[e2e] --runtime must be node or bun (got ${out.runtime})`);
    process.exit(2);
  }
  return out;
};

const resolveBun = () => {
  const onPath = spawnSync('bun', ['--version'], { shell: true, encoding: 'utf8' });
  if (onPath.status === 0) return 'bun';
  if (fs.existsSync(BUN_FALLBACK)) return BUN_FALLBACK;
  return null;
};

const waitForPort = async (port, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise((resolve) => {
      const socket = net.connect(port, '127.0.0.1');
      socket.on('connect', () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
    });
    if (open) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
};

//? Publishable = has a package.json, not private, has a version. Mirrors the
//? predicate in scripts/checkChangelogs.mjs; `env-resolver` (a reserved dir with
//? no package.json) is excluded by construction.
const publishablePackages = () => {
  const dir = path.join(ROOT, 'packages');
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgJson = path.join(dir, entry.name, 'package.json');
    if (!fs.existsSync(pkgJson)) continue;
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
    } catch {
      continue;
    }
    if (meta.private || typeof meta.version !== 'string' || typeof meta.name !== 'string') continue;
    found.push({ name: meta.name, version: meta.version, dir: path.join(dir, entry.name) });
  }
  return found;
};

const results = [];
const step = (label, fn) => {
  process.stdout.write(`\n[e2e] ${label}\n`);
  const ok = fn();
  results.push({ label, ok });
  if (!ok) process.stdout.write(`[e2e] ✗ FAILED: ${label}\n`);
  return ok;
};

const run = (cmd, args, cwd, extraEnv = {}) => {
  const proc = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...extraEnv },
  });
  return proc.status === 0;
};

const main = async () => {
  const args = parseArgs();
  const bunPath = args.pm === 'bun' || args.runtime === 'bun' ? resolveBun() : null;
  if ((args.pm === 'bun' || args.runtime === 'bun') && !bunPath) {
    console.error('[e2e] bun requested but not found (not on PATH, not at the winget location).');
    process.exit(2);
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-e2e-'));
  const storage = path.join(work, 'storage');
  const configPath = path.join(work, 'verdaccio.yaml');
  const projectParent = path.join(work, 'scaffold');
  fs.mkdirSync(projectParent, { recursive: true });

  //? @luckystack/* is served ONLY from local storage (no upstream proxy) so a
  //? published-to-npm version can never shadow the tarball under test. Every
  //? other package proxies to the real registry.
  fs.writeFileSync(
    configPath,
    [
      `storage: ${JSON.stringify(storage)}`,
      'uplinks:',
      '  npmjs:',
      '    url: https://registry.npmjs.org/',
      '    maxage: 60m',
      'packages:',
      "  '@luckystack/*':",
      '    access: $all',
      '    publish: $anonymous',
      '    unpublish: $anonymous',
      "  '**':",
      '    access: $all',
      '    publish: $anonymous',
      '    proxy: npmjs',
      //? `log:` singular — `logs:` is deprecated in verdaccio 6 and warns on every boot.
      'log: { type: stdout, format: pretty, level: warn }',
      'publish:',
      '  allow_offline: true',
      '',
    ].join('\n'),
  );

  //? A dummy token is enough: the config grants $anonymous publish. npm still
  //? insists on SOME token being present for the registry.
  fs.writeFileSync(
    path.join(projectParent, '.npmrc'),
    [`registry=${REGISTRY}`, `//localhost:${String(PORT)}/:_authToken=fake-e2e-token`, ''].join('\n'),
  );

  console.log(`[e2e] pm=${args.pm} runtime=${args.runtime}`);
  console.log(`[e2e] workdir: ${work}`);

  console.log('\n[e2e] starting verdaccio…');
  const verdaccio = spawn('npx', ['--yes', 'verdaccio@6', '--config', configPath, '--listen', String(PORT)], {
    cwd: work,
    stdio: 'ignore',
    shell: true,
    detached: false,
  });

  let exitCode = 1;
  try {
    if (!(await waitForPort(PORT, 120_000))) {
      console.error('[e2e] verdaccio did not come up within 120s.');
      return 1;
    }
    console.log(`[e2e] verdaccio up at ${REGISTRY}`);

    const packages = publishablePackages();
    console.log(`[e2e] publishing ${String(packages.length)} packages…`);

    step('build packages', () => run('npm', ['run', 'build:packages'], ROOT));

    let published = 0;
    for (const pkg of packages) {
      const ok = run('npm', ['publish', '--registry', REGISTRY, '--no-provenance', '--tag', 'latest'], pkg.dir, {
        npm_config_registry: REGISTRY,
        NPM_CONFIG_PROVENANCE: 'false',
        //? Same trick as the .npmrc above — publish needs a token to exist.
        npm_config__auth: 'fake-e2e-token',
      });
      if (ok) published += 1;
      else console.error(`[e2e]   ✗ publish failed: ${pkg.name}@${pkg.version}`);
    }
    results.push({ label: `publish ${String(published)}/${String(packages.length)} packages`, ok: published === packages.length });

    const scaffolderVersion = packages.find((p) => p.name === 'create-luckystack-app')?.version ?? 'latest';
    const projectName = 'e2e-app';
    const projectDir = path.join(projectParent, projectName);

    //? THE POINT OF THIS HARNESS: the scaffolder is fetched from the registry by
    //? SEMVER and installs its @luckystack/* deps the same way — the real path,
    //? not a file: shortcut.
    step('scaffold (real registry, WITH install)', () =>
      run(
        'npx',
        [
          '--yes',
          '--registry',
          REGISTRY,
          `create-luckystack-app@${scaffolderVersion}`,
          projectName,
          `--pm=${args.pm}`,
          ...args.scaffoldArgs.split(' ').filter(Boolean),
          '--no-prompt',
        ],
        projectParent,
        { npm_config_registry: REGISTRY },
      ),
    );

    if (!fs.existsSync(projectDir)) {
      console.error('[e2e] scaffold produced no project directory — aborting the remaining steps.');
    } else {
      //? The scaffolder installs already; this proves a SECOND install (the
      //? upgrade/add path) also resolves cleanly against the same registry.
      step(`${args.pm} install (idempotent re-install)`, () =>
        args.pm === 'bun'
          ? run(bunPath, ['install'], projectDir, { npm_config_registry: REGISTRY })
          : run('npm', ['install'], projectDir, { npm_config_registry: REGISTRY }),
      );

      step('typecheck', () => run('npm', ['run', 'typecheck'], projectDir));
      step('build', () => run('npm', ['run', 'build'], projectDir));

      if (args.runtime === 'bun') {
        //? `bun run <script>` does NOT give a Bun runtime when the script points
        //? at a bin: npm's generated .cmd shim hardcodes a `node` call, so it
        //? runs under Node and looks green. Verified on bun 1.3.14 / Windows.
        //? This probe asserts which runtime actually executes.
        step('runtime is really Bun (not Node in disguise)', () => {
          const probe = path.join(projectDir, 'e2e-runtime-probe.mjs');
          fs.writeFileSync(probe, "console.log(typeof Bun !== 'undefined' ? 'BUN' : 'NODE');\n");
          const out = spawnSync(bunPath, ['run', probe], { cwd: projectDir, encoding: 'utf8', shell: true });
          fs.rmSync(probe, { force: true });
          const runtime = (out.stdout ?? '').trim();
          console.log(`[e2e]   probe reports: ${runtime}`);
          return runtime === 'BUN';
        });
      }
    }

    console.log('\n[e2e] ── summary ────────────────────────────────');
    for (const result of results) console.log(`[e2e] ${result.ok ? '✓' : '✗'} ${result.label}`);
    const failed = results.filter((result) => !result.ok).length;
    console.log(`[e2e] ${failed === 0 ? 'ALL GREEN' : `${String(failed)} step(s) FAILED`}`);
    exitCode = failed;
  } finally {
    verdaccio.kill();
    if (args.keep) {
      console.log(`\n[e2e] --keep: left the workdir at ${work}`);
    } else {
      fs.rmSync(work, { recursive: true, force: true });
      console.log('\n[e2e] cleaned up.');
    }
  }
  return exitCode;
};

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('[e2e] harness crashed:', error);
    process.exit(1);
  });
