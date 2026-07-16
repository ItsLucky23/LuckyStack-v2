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
//   node scripts/e2eVerdaccio.mjs --pm=bun --runtime=bun   # build + real Bun server boot
//   node scripts/e2eVerdaccio.mjs --runtime=node            # build + real Node server boot
//   node scripts/e2eVerdaccio.mjs --runtime=both            # boot the same build on Node and Bun
//   node scripts/e2eVerdaccio.mjs --runtime=bun --redis-port=6380
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
  const out = {
    pm: 'npm',
    runtime: 'node',
    runtimeSmoke: false,
    redisPort: Number(process.env.REDIS_PORT ?? 6379),
    keep: false,
    scaffoldArgs: '--orm=prisma --db=sqlite --auth=none --no-ai-docs',
  };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--pm=')) out.pm = arg.slice(5);
    else if (arg.startsWith('--runtime=')) {
      out.runtime = arg.slice(10);
      out.runtimeSmoke = true;
    } else if (arg.startsWith('--redis-port=')) out.redisPort = Number(arg.slice(13));
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
  if (!['node', 'bun', 'both'].includes(out.runtime)) {
    console.error(`[e2e] --runtime must be node, bun, or both (got ${out.runtime})`);
    process.exit(2);
  }
  if (!Number.isInteger(out.redisPort) || out.redisPort < 1 || out.redisPort > 65_535) {
    console.error(`[e2e] --redis-port must be an integer from 1 through 65535 (got ${String(out.redisPort)})`);
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

const waitForHttp200 = async (url, timeoutMs, isDead) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
      .then((value) => value, () => null);
    if (response?.status === 200) return response;
    if (isDead()) return null;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
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

const stepAsync = async (label, fn) => {
  process.stdout.write(`\n[e2e] ${label}\n`);
  const ok = await fn();
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

const stopProcessTree = (child) => {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill();
  }
};

const getFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, HOST, () => {
    const address = server.address();
    if (address === null || typeof address === 'string') {
      server.close();
      reject(new Error('could not reserve a TCP port'));
      return;
    }
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});

const writeOrmRuntimeProbe = (projectDir, orm) => {
  const probe = path.join(projectDir, 'e2e-orm-runtime.mjs');
  const setup = orm === 'prisma'
    ? `const { PrismaClient } = await import('@prisma/client');
const client = new PrismaClient();
const marker = 'e2e-' + actual + '-' + Date.now();
const created = await client.user.create({ data: { email: marker + '@example.test', name: marker, provider: 'credentials' } });
const found = await client.user.findUniqueOrThrow({ where: { id: created.id } });
await client.user.delete({ where: { id: created.id } });
await client.$disconnect();`
    : orm === 'drizzle'
      ? `const { db, schema } = await import('./functions/db.ts');
const marker = 'e2e-' + actual + '-' + Date.now();
await db.insert(schema.items).values({ name: marker });
const found = db.select().from(schema.items).all().find((row) => row.name === marker);
if (!found) throw new Error('Drizzle row not found after insert');
await db.delete(schema.items);
db.$client.close();`
      : `const { getOrm } = await import('./functions/db.ts');
const orm = await getOrm();
const em = orm.em.fork();
const marker = 'e2e-' + actual + '-' + Date.now();
const created = em.create('Item', { name: marker });
await em.persistAndFlush(created);
const found = await em.findOneOrFail('Item', { name: marker });
await em.removeAndFlush(found);
await orm.close(true);`;

  fs.writeFileSync(
    probe,
    `const actual = 'Bun' in globalThis ? 'bun' : 'node';
${setup}
if (!(found.createdAt instanceof Date)) {
  throw new Error(${JSON.stringify(orm)} + ' returned a non-Date createdAt on ' + actual);
}
const nested = { company: { departments: [{ employees: [found] }] } };
const wireDate = JSON.parse(JSON.stringify(nested)).company.departments[0].employees[0].createdAt;
if (typeof wireDate !== 'string' || !wireDate.includes('T')) {
  throw new Error(${JSON.stringify(orm)} + ' Date did not serialize to an ISO string on ' + actual);
}
console.log('[e2e-orm] ${orm} ' + actual + ' CRUD + nested Date passed');
`,
  );
  return probe;
};

const smokeBuiltServer = async ({ projectDir, runtime, bunPath, redisPort, databaseUrl }) => {
  const port = await getFreePort();
  const launcher = path.join(projectDir, 'e2e-runtime-launch.mjs');
  const logPath = path.join(projectDir, `e2e-${runtime}-server.log`);
  fs.writeFileSync(
    launcher,
    [
      `const actual = 'Bun' in globalThis ? 'bun' : 'node';`,
      `console.log('[e2e-runtime] ' + actual);`,
      `if (actual !== ${JSON.stringify(runtime)}) {`,
      `  console.error('[e2e-runtime] expected ${runtime}, got ' + actual);`,
      `  process.exit(91);`,
      `}`,
      `await import('./dist/server.js');`,
      '',
    ].join('\n'),
  );

  const logFd = fs.openSync(logPath, 'a');
  const command = runtime === 'bun' ? bunPath : 'node';
  const commandArgs = runtime === 'bun'
    ? ['--bun', launcher, 'default', String(port)]
    : [launcher, 'default', String(port)];
  const child = spawn(command, commandArgs, {
    cwd: projectDir,
    stdio: ['ignore', logFd, logFd],
    shell: true,
    detached: false,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PROJECT_NAME: `luckystack-e2e-${runtime}`,
      REDIS_HOST: HOST,
      REDIS_PORT: String(redisPort),
      REDIS_USER: '',
      REDIS_PASSWORD: '',
      DATABASE_URL: databaseUrl,
      SERVER_PORT_AUTO_INCREMENT: '0',
    },
  });
  let exited = false;
  child.on('exit', () => { exited = true; });

  // eslint-disable-next-line luckystack/no-raw-try-catch -- process-tree cleanup must run after every async probe path
  try {
    if (!(await waitForPort(port, 120_000, () => exited))) {
      console.error(`[e2e] ${runtime} server did not listen on ${HOST}:${String(port)}. Log:`);
      console.error(fs.readFileSync(logPath, 'utf8').split('\n').slice(-40).join('\n'));
      return false;
    }

    //? A TCP listen can become visible a few milliseconds before the request
    //? pipeline is ready (and a short-lived child can disappear between both).
    //? Retry real HTTP instead of turning that race into a runtime verdict.
    const baseUrl = `http://${HOST}:${String(port)}`;
    const live = await waitForHttp200(`${baseUrl}/livez`, 30_000, () => exited);
    const health = await waitForHttp200(`${baseUrl}/_health`, 30_000, () => exited);
    const log = fs.readFileSync(logPath, 'utf8');
    console.log(`[e2e]   ${runtime} /livez=${String(live?.status ?? 'down')} /_health=${String(health?.status ?? 'down')}`);
    if (!live || !health) console.error(log.split('\n').slice(-40).join('\n'));
    return live !== null
      && health !== null
      && log.includes(`[e2e-runtime] ${runtime}`);
  } catch (error) {
    console.error(`[e2e] ${runtime} server smoke failed:`, error);
    console.error(fs.readFileSync(logPath, 'utf8').split('\n').slice(-40).join('\n'));
    return false;
  } finally {
    stopProcessTree(child);
    fs.closeSync(logFd);
    fs.rmSync(launcher, { force: true });
  }
};

const main = async () => {
  const args = parseArgs();
  const needsBun = args.pm === 'bun' || args.runtime === 'bun' || args.runtime === 'both';
  const bunPath = needsBun ? resolveBun() : null;
  if (needsBun && !bunPath) {
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
    //? Bun keeps its OWN cache (~/.bun/install/cache) keyed by name@version and
    //? ignores npm_config_cache entirely. Without this it happily installs a
    //? `@luckystack/core@0.6.7` from a PREVIOUS run — same version number, older
    //? contents — so the harness tests code from days ago and reports green.
    //? Third cache to bite this script (npx's _npx dir, npm's _cacache, now
    //? bun's): a version number is not an identity when you republish it.
    BUN_INSTALL_CACHE_DIR: path.join(work, 'bun-cache'),
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

  console.log(`[e2e] pm=${args.pm} runtime=${args.runtime}${args.runtimeSmoke ? ' (real server smoke)' : ' (build only)'}`);
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

      //? No explicit generateArtifacts step: the template now chains it into
      //? BOTH typecheck and build (E1), mirroring what it already did for test.
      //? Leaving the step here would MASK a regression of that chaining.
      step('typecheck', () => run('npm', ['run', 'typecheck'], projectDir));
      step('build', () => run('npm', ['run', 'build'], projectDir));

      if (args.runtimeSmoke) {
        const orm = /(?:^|\s)--orm=([^\s]+)/.exec(args.scaffoldArgs)?.[1] ?? 'prisma';
        const databaseUrl = 'file:./e2e.sqlite';
        const databaseEnv = { DATABASE_URL: databaseUrl };
        const databaseCommand = orm === 'prisma'
          ? ['prisma:db:push', '--', '--accept-data-loss']
          : orm === 'drizzle'
            ? ['db:push']
            : orm === 'mikro-orm'
              ? ['db:schema:update']
              : null;

        if (databaseCommand) {
          step(`${orm} schema command against SQLite`, () =>
            run('npm', ['run', ...databaseCommand], projectDir, databaseEnv));
        }

        //? This is the runtime proof the old harness lacked. A launcher asserts
        //? `globalThis.Bun` BEFORE importing the built server, then real HTTP
        //? probes prove the process reached a working LuckyStack listener.
        const runtimeTargets = args.runtime === 'both' ? ['node', 'bun'] : [args.runtime];
        if (orm !== 'none') {
          const ormProbe = writeOrmRuntimeProbe(projectDir, orm);
          for (const runtime of runtimeTargets) {
            const command = runtime === 'bun' ? bunPath : 'node';
            const commandArgs = runtime === 'bun'
              ? ['--bun', ormProbe]
              : ['--import', 'tsx', ormProbe];
            step(`${orm} CRUD + nested Date serialization on ${runtime}`, () =>
              run(command, commandArgs, projectDir, databaseEnv));
          }
        }

        for (const runtime of runtimeTargets) {
          await stepAsync(`built server boots on ${runtime} and serves health endpoints`, () =>
            smokeBuiltServer({
              projectDir,
              runtime,
              bunPath,
              redisPort: args.redisPort,
              databaseUrl,
            }));
        }
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
