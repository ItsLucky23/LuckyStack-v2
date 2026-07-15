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
//? 127.0.0.1 everywhere — never `localhost`. Given only a port, verdaccio binds
//? the IPv6 loopback (`[::1]`) on Windows, while a probe or client aimed at the
//? IPv4 loopback then finds nothing; `localhost` resolves to whichever the OS
//? prefers, so mixing the two produces a harness that hangs for the full timeout
//? and blames a healthy server. Pinning the bind AND the URL to one stack removes
//? the ambiguity.
const HOST = '127.0.0.1';
const REGISTRY = `http://${HOST}:${String(PORT)}/`;

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

const isPortOpen = async (port) =>
  new Promise((resolve) => {
    const socket = net.connect(port, HOST);
    socket.on('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });

const waitForPort = async (port, timeoutMs, isDead) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) return true;
    //? Fail fast when the child is already gone: otherwise a verdaccio that
    //? died on startup (bad config, port taken) costs the FULL timeout and
    //? reports "did not come up", which reads like slowness rather than a crash.
    if (isDead()) return false;
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
      //? Both rules are LOCAL-ONLY (no `proxy:`) so a version already on npmjs
      //? can never shadow the tarball under test. `create-luckystack-app` needs
      //? its own rule because it is UNSCOPED — it does not match
      //? `@luckystack/*`, so it fell through to the `**` proxy and the harness
      //? silently scaffolded with the PUBLISHED scaffolder instead of this
      //? working tree's. A green run would have proven nothing.
      "  '@luckystack/*':",
      '    access: $all',
      '    publish: $anonymous',
      '    unpublish: $anonymous',
      "  'create-luckystack-app':",
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

  //? ONE npmrc, handed to every npm invocation via `npm_config_userconfig`.
  //? A per-directory `.npmrc` does NOT work here: publish runs from
  //? `packages/<name>/`, which never sees an npmrc written into the scaffold
  //? directory — that mismatch is what produced `ENEEDAUTH` on all 17 packages.
  //? The token itself is a dummy; the config grants `$anonymous` publish, but
  //? npm still refuses to publish unless SOME token exists for the registry.
  const npmrcPath = path.join(work, 'e2e.npmrc');
  fs.writeFileSync(
    npmrcPath,
    [`registry=${REGISTRY}`, `//${HOST}:${String(PORT)}/:_authToken=fake-e2e-token`, ''].join('\n'),
  );
  //? An ISOLATED npm cache is not optional here. npx stores each package it runs
  //? under `<cache>/_npx/<hash>`, and that hash is derived from the package SPEC
  //? — not from the registry it came from. So `create-luckystack-app@0.6.7`
  //? resolves to whatever npx already has, and the harness silently ran the
  //? version published on npmjs instead of the tarball it had just published
  //? locally: the scaffolder rejected `--pm` because the PUBLIC 0.6.7 predates
  //? that flag. Same failure class as proxying an unscoped package — a green run
  //? that proves nothing. A per-run cache costs re-downloads; correctness wins.
  const cacheDir = path.join(work, 'npm-cache');
  const registryEnv = {
    npm_config_userconfig: npmrcPath,
    npm_config_registry: REGISTRY,
    npm_config_cache: cacheDir,
  };

  //? The scaffolder resolves a package manager by scanning PATH only (never cwd
  //? — a BatBadBut hazard mitigation), so testing `--pm=bun` requires bun to BE
  //? on PATH. A winget install does not take effect until the shell restarts, so
  //? without this the scaffolder correctly skips the install with a hint, my
  //? own re-install step then populates node_modules anyway, and the run looks
  //? like it exercised the bun install path when it never did. Prepend rather
  //? than replace so the real PATH still resolves node/npm/git.
  if (bunPath !== null && bunPath !== 'bun') {
    registryEnv.PATH = `${path.dirname(bunPath)}${path.delimiter}${process.env.PATH ?? ''}`;
  }

  console.log(`[e2e] pm=${args.pm} runtime=${args.runtime}`);
  console.log(`[e2e] workdir: ${work}`);

  //? Pre-flight: a squatter on the port (a stray verdaccio from an interrupted
  //? run is the usual suspect) would otherwise let us publish into, and test
  //? against, SOMEONE ELSE'S registry — a far worse outcome than failing here.
  if (await isPortOpen(PORT)) {
    console.error(
      `[e2e] port ${String(PORT)} is already in use. Something is listening there — probably a stray\n` +
        '      verdaccio from an interrupted run. Refusing to continue: publishing into an unknown\n' +
        `      registry would silently invalidate this test. Find it with \`netstat -ano | findstr ${String(PORT)}\`.`,
    );
    return 1;
  }

  console.log('\n[e2e] starting verdaccio…');
  //? Capture the log instead of discarding it: a startup failure prints its
  //? reason here, and throwing that away is what turned a clear "address in use"
  //? into a mute 120-second timeout.
  const verdaccioLog = path.join(work, 'verdaccio.log');
  const logFd = fs.openSync(verdaccioLog, 'a');
  const verdaccio = spawn(
    'npx',
    ['--yes', 'verdaccio@6', '--config', configPath, '--listen', `${HOST}:${String(PORT)}`],
    { cwd: work, stdio: ['ignore', logFd, logFd], shell: true, detached: false },
  );
  let verdaccioExited = false;
  verdaccio.on('exit', () => {
    verdaccioExited = true;
  });

  let exitCode = 1;
  try {
    if (!(await waitForPort(PORT, 120_000, () => verdaccioExited))) {
      console.error(`[e2e] verdaccio never listened on ${HOST}:${String(PORT)}. Its log:`);
      console.error(fs.readFileSync(verdaccioLog, 'utf8').split('\n').slice(-25).join('\n'));
      return 1;
    }
    console.log(`[e2e] verdaccio up at ${REGISTRY}`);

    const packages = publishablePackages();
    console.log(`[e2e] publishing ${String(packages.length)} packages…`);

    step('build packages', () => run('npm', ['run', 'build:packages'], ROOT));

    //? Reuse the REAL publish script rather than reimplementing `npm publish`.
    //? A second implementation drifts from the one that actually ships, and this
    //? harness exists to catch drift, not to add some: a hand-rolled loop here
    //? already diverged twice — it missed that `publishConfig.provenance: true`
    //? in every package.json needs the `--provenance=false` FORM to override
    //? (plain `--no-provenance` / the env var do not), and it skipped the
    //? script's registry-side idempotency check. Invoked via `node` directly, not
    //? `npm run`: npm@11 eats the flag when routed through a script (lesson 0005).
    step(`publish ${String(packages.length)} packages to the local registry`, () =>
      run('node', ['scripts/publishPackages.mjs', '--no-provenance'], ROOT, {
        ...registryEnv,
        NPM_CONFIG_PROVENANCE: 'false',
      }),
    );

    const scaffolderVersion = packages.find((p) => p.name === 'create-luckystack-app')?.version ?? 'latest';
    const projectName = 'e2e-app';
    const projectDir = path.join(projectParent, projectName);

    //? Assert we are about to test OUR tarball, not the one on npmjs. Twice now a
    //? bug made this harness silently exercise the published package (an unscoped
    //? name falling through to the proxy; then npx's spec-keyed cache) — both
    //? would have produced a GREEN run that proved nothing, which is strictly
    //? worse than a red one. So make the origin an explicit, failing assertion.
    step('the registry serves OUR tarball (not npmjs)', () => {
      const view = spawnSync('npm', ['view', `create-luckystack-app@${scaffolderVersion}`, 'dist.tarball'], {
        cwd: work,
        encoding: 'utf8',
        shell: true,
        env: { ...process.env, ...registryEnv },
      });
      const tarball = (view.stdout ?? '').trim();
      console.log(`[e2e]   resolves to: ${tarball || '(nothing)'}`);
      return tarball.includes(HOST);
    });

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
        registryEnv,
      ),
    );

    if (!fs.existsSync(projectDir)) {
      console.error('[e2e] scaffold produced no project directory — aborting the remaining steps.');
    } else {
      //? Prove the CHOSEN package manager actually ran. The scaffolder skips the
      //? install with a hint (and no crash) when it cannot find the binary on
      //? PATH — correct behaviour, but it means a `--pm=bun` run can complete
      //? having never once invoked bun, while a later step populates
      //? node_modules and paints everything green. The lockfile is the artifact
      //? only the real installer leaves behind.
      step(`${args.pm} actually performed the install (lockfile present)`, () => {
        const expected = args.pm === 'bun' ? ['bun.lock', 'bun.lockb'] : ['package-lock.json'];
        const found = expected.filter((name) => fs.existsSync(path.join(projectDir, name)));
        console.log(`[e2e]   looked for ${expected.join(' | ')} → found: ${found.join(', ') || '(none)'}`);
        return found.length > 0;
      });

      //? The scaffolder installs already; this proves a SECOND install (the
      //? upgrade/add path) also resolves cleanly against the same registry.
      step(`${args.pm} install (idempotent re-install)`, () =>
        args.pm === 'bun'
          ? //? bun ignores npm_config_userconfig; it reads .npmrc from the
            //? project dir, which the scaffolder does not write. Point it at the
            //? local registry explicitly so it cannot resolve from npmjs.
            run(bunPath, ['install'], projectDir, { ...registryEnv, BUN_CONFIG_REGISTRY: REGISTRY })
          : run('npm', ['install'], projectDir, registryEnv),
      );

      //? `generateArtifacts` FIRST — a fresh scaffold ships without the generated
      //? route/type maps. The template has no `postinstall` (the repo root does),
      //? and neither `typecheck` nor `build` chains generation, so both fail on a
      //? never-yet-run project with a confusing "Cannot find module
      //? '../_sockets/apiTypes.generated'". The intended first command is
      //? `npm run server`, which generates them via the dev supervisor. This
      //? mirrors the established recipe: install -> prisma -> gen -> tsc -> build.
      step('generateArtifacts', () => run('npm', ['run', 'generateArtifacts'], projectDir));
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
    //? Kill the TREE, not just the direct child. `npx` is a wrapper: killing it
    //? orphans the actual verdaccio node process, which keeps holding the port
    //? and silently poisons the NEXT run (it answers as a registry that has none
    //? of this run's tarballs). Learned the hard way — a stray from a manual run
    //? is exactly what made the first execution of this harness fail.
    if (verdaccio.pid !== undefined && !verdaccioExited) {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(verdaccio.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        verdaccio.kill();
      }
    }
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
