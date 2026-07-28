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
//   node scripts/e2eVerdaccio.mjs --browser-routed         # real browser → router → split services + Socket.io fanout
//   node scripts/e2eVerdaccio.mjs --mode=upgrade --browser-routed # previous npm release → candidate + update --app
//   node scripts/e2eVerdaccio.mjs --extended-browser --seed=17 # nightly synthetic admin + two-player acceptance
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
    mode: 'fresh',
    browserRouted: false,
    extendedBrowser: false,
    seed: 17,
    scaffoldArgs: '--orm=prisma --db=sqlite --auth=none --no-ai-docs',
  };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--pm=')) out.pm = arg.slice(5);
    else if (arg.startsWith('--runtime=')) {
      out.runtime = arg.slice(10);
      out.runtimeSmoke = true;
    } else if (arg.startsWith('--redis-port=')) out.redisPort = Number(arg.slice(13));
    else if (arg === '--keep') out.keep = true;
    else if (arg === '--browser-routed') out.browserRouted = true;
    else if (arg === '--extended-browser') {
      out.browserRouted = true;
      out.extendedBrowser = true;
    } else if (arg.startsWith('--seed=')) out.seed = Number(arg.slice(7));
    else if (arg.startsWith('--mode=')) out.mode = arg.slice(7);
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
  if (!['fresh', 'upgrade'].includes(out.mode)) {
    console.error(`[e2e] --mode must be fresh or upgrade (got ${out.mode})`);
    process.exit(2);
  }
  if (out.mode === 'upgrade' && out.pm !== 'npm') {
    console.error('[e2e] the blocking upgrade lane currently requires --pm=npm; Bun is covered by the fresh-install profile.');
    process.exit(2);
  }
  if (out.browserRouted && !/(?:^|\s)--router(?:\s|$)/.test(out.scaffoldArgs)) {
    console.error('[e2e] browser acceptance requires --router in --scaffold-args.');
    process.exit(2);
  }
  if (!Number.isInteger(out.seed) || out.seed < 0 || out.seed > 2_147_483_647) {
    console.error(`[e2e] --seed must be an integer from 0 through 2147483647 (got ${String(out.seed)})`);
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

const parseStableVersion = (value) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return match ? match.slice(1).map(Number) : null;
};

const compareStableVersions = (left, right) => {
  const a = parseStableVersion(left);
  const b = parseStableVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

const resolvePreviousPublishedVersion = (candidateVersion, publicEnv) => {
  const view = spawnSync('npm', ['view', 'create-luckystack-app', 'versions', '--json'], {
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, ...publicEnv },
  });
  if (view.status !== 0) return null;
  const versions = JSON.parse(view.stdout || '[]');
  if (!Array.isArray(versions)) return null;
  return versions
    .filter((version) => typeof version === 'string' && parseStableVersion(version) && compareStableVersions(version, candidateVersion) < 0)
    .sort(compareStableVersions)
    .at(-1) ?? null;
};

const upgradeProjectToCandidate = ({ projectDir, candidateVersion, registryEnv }) => {
  const packagePath = path.join(projectDir, 'package.json');
  const apiRequestPath = path.join(projectDir, 'src', '_sockets', 'apiRequest.ts');
  const apiRequestSidecarPath = `${apiRequestPath}.new`;
  const consumerMarker = '// consumer-owned acceptance edit — must never be overwritten';
  fs.appendFileSync(apiRequestPath, `\n${consumerMarker}\n`);

  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  for (const bucket of ['dependencies', 'devDependencies']) {
    const dependencies = pkg[bucket];
    if (!dependencies || typeof dependencies !== 'object') continue;
    for (const name of Object.keys(dependencies)) {
      if (name.startsWith('@luckystack/')) dependencies[name] = `^${candidateVersion}`;
    }
  }
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  if (!run('npm', ['install'], projectDir, registryEnv)) return false;
  if (!run('npx', ['luckystack', 'update'], projectDir, registryEnv)) return false;
  if (!run('npx', ['luckystack', 'update', '--app'], projectDir, registryEnv)) return false;

  const installedCore = JSON.parse(fs.readFileSync(path.join(projectDir, 'node_modules', '@luckystack', 'core', 'package.json'), 'utf8'));
  const preservedApiRequestSource = fs.readFileSync(apiRequestPath, 'utf8');
  const sidecarCreated = fs.existsSync(apiRequestSidecarPath);
  const sidecarSource = sidecarCreated ? fs.readFileSync(apiRequestSidecarPath, 'utf8') : '';
  const consumerEditPreserved = preservedApiRequestSource.includes(consumerMarker);
  const candidateWiringAvailable = sidecarSource.includes('registerApiMethodMap(apiMethodMap)');
  console.log(`[e2e]   upgraded @luckystack/core=${installedCore.version}`);
  console.log(`[e2e]   modified apiRequest preserved=${String(consumerEditPreserved)} candidate sidecar=${String(candidateWiringAvailable)}`);
  if (!consumerEditPreserved || !candidateWiringAvailable) return false;

  //? Simulate the developer accepting the candidate sidecar after the safety
  //? assertion. Leaving the `.new` file in this throwaway fixture is harmless
  //? and avoids deleting files in a release-safety test.
  fs.copyFileSync(apiRequestSidecarPath, apiRequestPath);
  return installedCore.version === candidateVersion;
};

export const writeRoutedAcceptanceFixture = async (projectDir, { extended = false, seed = 17 } = {}) => {
  const systemPort = await getFreePort();
  const acceptancePort = await getFreePort();
  const routerPort = await getFreePort();
  const frontendPort = await getFreePort();

  fs.writeFileSync(path.join(projectDir, 'config.ports.ts'), `export const ports: {\n  frontend: number;\n  backend: number;\n  devBackendUrl?: string;\n} = {\n  frontend: ${String(frontendPort)},\n  backend: ${String(systemPort)},\n};\n`);

  const configPath = path.join(projectDir, 'config.ts');
  let configSource = fs.readFileSync(configPath, 'utf8');
  configSource = configSource.replace('sessionBasedToken: false,', 'sessionBasedToken: true,');
  if (!configSource.includes('  sync: {\n    requireRoomMembership: false,')) {
    configSource = configSource.replace(
      '  //? Dev-only console logging toggles.',
      "  sync: {\n    requireRoomMembership: false,\n  },\n  //? Dev-only console logging toggles.",
    );
  }
  if (!configSource.includes('    sync: currentConfig.sync,')) {
    configSource = configSource.replace(
      '    transport: currentConfig.transport,',
      '    transport: currentConfig.transport,\n    sync: currentConfig.sync,',
    );
  }
  fs.writeFileSync(configPath, configSource);

  fs.writeFileSync(path.join(projectDir, 'services.config.ts'), `import { registerServicesConfig } from '@luckystack/core';

export interface ServiceDefinition { source: 'root' | string; }
export interface PresetDefinition { description?: string; services: string[]; }
export interface ServicesConfig {
  services: Record<string, ServiceDefinition>;
  presets: Record<string, PresetDefinition>;
  customRoutes?: Record<string, string>;
}

const servicesConfig: ServicesConfig = {
  services: {
    system: { source: 'root' },
    acceptance: { source: 'acceptance' },
  },
  customRoutes: {
    '/auth': 'system',
    '/uploads': 'system',
    '/hooks': 'system',
    '/csrf-token': 'system',
    '/_health': 'system',
    '/livez': 'system',
    '/readyz': 'system',
    '/_docs': 'system',
  },
  presets: {
    'system-preset': { services: ['system'] },
    'acceptance-preset': { services: ['acceptance'] },
  },
};

registerServicesConfig(servicesConfig);
export default servicesConfig;
`);

  fs.writeFileSync(path.join(projectDir, 'deploy.config.ts'), `import { registerDeployConfig } from '@luckystack/core';

export type ResourceType = 'redis' | 'mongo';
export interface ResourceDefinition {
  type: ResourceType;
  urlEnvKey: string;
  synchronizedEnvKeys?: string[];
}
export interface EnvironmentDefinition<TEnvKey extends string = string> {
  redis: string;
  mongo: string;
  fallback?: TEnvKey;
  bindings: Record<string, string>;
}
export interface DeployConfig<TEnvKey extends string = string> {
  resources: Record<string, ResourceDefinition>;
  environments: Record<TEnvKey, EnvironmentDefinition<TEnvKey>>;
  routing?: {
    onMissingService?: 'hard-error' | 'proxy-fallback';
    missingServiceErrorCode?: string;
    enableUnhealthyFallback?: boolean;
    strictBootHandshake?: boolean;
    defaultRouterPort?: number;
    trustedProxyCidrs?: string[];
  };
  development?: {
    enableFallbackRouting?: boolean;
    healthPollMs?: number;
    switchNewTrafficToLocalWhenHealthy?: boolean;
  };
}

const deployConfig: DeployConfig = {
  resources: {
    redisShared: { type: 'redis', urlEnvKey: 'REDIS_HOST', synchronizedEnvKeys: ['PROJECT_NAME'] },
    databaseShared: { type: 'mongo', urlEnvKey: 'DATABASE_URL' },
  },
  environments: {
    acceptance: {
      redis: 'redisShared',
      mongo: 'databaseShared',
      bindings: {
        system: 'http://${HOST}:${String(systemPort)}',
        acceptance: 'http://${HOST}:${String(acceptancePort)}',
      },
    },
  },
  routing: {
    defaultRouterPort: ${String(routerPort)},
    trustedProxyCidrs: ['127.0.0.1/32', '::1/128'],
  },
};

registerDeployConfig(deployConfig);
export default deployConfig;
`);

  const apiRoot = path.join(projectDir, 'src', 'acceptance', '_api');
  fs.mkdirSync(apiRoot, { recursive: true });
  const apiCases = [
    ['organization', 'GET'],
    ['getMutation', 'POST'],
    ['removeReplacement', 'PUT'],
    ['updateArchive', 'DELETE'],
  ];
  for (const [name, method] of apiCases) {
    fs.writeFileSync(path.join(apiRoot, `${name}_v1.ts`), `import type { AuthProps } from '../../../config';

export const httpMethod = '${method}' as const;
export const rateLimit = false;
export const auth: AuthProps = { login: false };

export interface ApiResponse {
  status: 'success';
  route: string;
  declaredMethod: string;
}

export const main = (): ApiResponse => ({
  status: 'success',
  route: '${name}',
  declaredMethod: '${method}',
});
`);
  }

  const syncRoot = path.join(projectDir, 'src', 'acceptance', '_sync');
  fs.mkdirSync(syncRoot, { recursive: true });
  fs.writeFileSync(path.join(syncRoot, 'fanout_server_v1.ts'), `import type { AuthProps, SessionLayout } from '../../../config';
import type { Functions, MaybePromise } from '../../_sockets/apiTypes.generated';

export const auth: AuthProps = { login: false };
export const rateLimit = false;

export interface SyncParams {
  clientInput: { marker: string };
  user: SessionLayout | null;
  functions: Functions;
  roomCode: string;
}

export interface SyncServerResponse {
  status: 'success';
  marker: string;
}

export const main = ({ clientInput }: SyncParams): MaybePromise<SyncServerResponse> => ({
  status: 'success',
  marker: clientInput.marker,
});
`);

  const pageRoot = path.join(projectDir, 'src', 'acceptance');
  fs.writeFileSync(path.join(pageRoot, 'page.tsx'), `//? intent: Prove candidate routed HTTP methods and cross-instance Socket.io sync delivery.
import { useEffect } from 'react';

import { apiRequest } from 'src/_sockets/apiRequest';
import { syncRequest, useSyncEvents } from 'src/_sockets/syncRequest';

interface AcceptanceState {
  status: 'pending' | 'success' | 'error';
  apiStatuses?: string[];
  syncStatus?: string;
  syncErrorCode?: string;
  ignoreSelfSuppressed?: boolean;
  callbackReceived?: boolean;
}

declare global {
  interface Window {
    __luckystackAcceptance: AcceptanceState;
  }
}

window.__luckystackAcceptance = { status: 'pending' };

const AcceptancePage = () => {
  const { upsertSyncEventCallback } = useSyncEvents();

  useEffect(() => {
    let active = true;
    let callbackCount = 0;
    let resolveCallback: (received: boolean) => void = () => undefined;
    const callbackPromise = new Promise<boolean>((resolve) => { resolveCallback = resolve; });
    const teardown = upsertSyncEventCallback({
      name: 'acceptance/fanout',
      version: 'v1',
      callback: ({ serverOutput }) => {
        callbackCount += 1;
        resolveCallback(serverOutput.status === 'success');
      },
    });

    void (async () => {
      const apiResponses = await Promise.all([
        apiRequest({ name: 'acceptance/organization', version: 'v1' }),
        apiRequest({ name: 'acceptance/getMutation', version: 'v1' }),
        apiRequest({ name: 'acceptance/removeReplacement', version: 'v1' }),
        apiRequest({ name: 'acceptance/updateArchive', version: 'v1' }),
      ]);
      const ignoredSyncResponse = await syncRequest({
        name: 'acceptance/fanout',
        version: 'v1',
        data: { marker: 'ignore-self' },
        receiver: 'acceptance-browser-token',
        ignoreSelf: true,
      });
      await new Promise<void>((resolve) => { setTimeout(resolve, 1_000); });
      const ignoreSelfSuppressed = callbackCount === 0;
      const syncResponse = await syncRequest({
        name: 'acceptance/fanout',
        version: 'v1',
        data: { marker: 'cross-instance' },
        receiver: 'acceptance-browser-token',
      });
      const callbackReceived = await Promise.race([
        callbackPromise,
        new Promise<boolean>((resolve) => { setTimeout(() => resolve(false), 10_000); }),
      ]);
      if (!active) return;
      const apiStatuses = apiResponses.map((response) => response.status);
      const success = apiStatuses.every((status) => status === 'success')
        && ignoredSyncResponse.status === 'success'
        && ignoreSelfSuppressed
        && syncResponse.status === 'success'
        && callbackReceived;
      window.__luckystackAcceptance = {
        status: success ? 'success' : 'error',
        apiStatuses,
        syncStatus: syncResponse.status,
        syncErrorCode: syncResponse.status === 'error' ? syncResponse.errorCode : undefined,
        ignoreSelfSuppressed,
        callbackReceived,
      };
    })();

    return () => {
      active = false;
      teardown();
    };
  }, [upsertSyncEventCallback]);

  return <div data-testid={'acceptance-status'} />;
};

export const template = 'plain';
export default AcceptancePage;
`);

  if (extended) writeSyntheticAcceptanceFixtures(projectDir, seed);

  return { systemPort, acceptancePort, routerPort, frontendPort };
};

const createSeededRandom = (seed) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const writeSyntheticAcceptanceFixtures = (projectDir, seed) => {
  const random = createSeededRandom(seed);
  const records = Array.from({ length: 4 }, (_, index) => ({
    id: `seed-${String(seed)}-${String(index + 1)}`,
    title: `Record ${String(index + 1)}-${String(Math.floor(random() * 100_000))}`,
    score: Math.floor(random() * 10_001) - 5_000,
  }));
  const updated = {
    ...records[0],
    title: `${records[0].title}-updated`,
    score: records[0].score + 37,
  };
  const deletedId = records.at(-1).id;

  const serverRoot = path.join(projectDir, 'src', 'acceptance', '_server');
  fs.mkdirSync(serverRoot, { recursive: true });
  fs.writeFileSync(path.join(serverRoot, 'adminStore.ts'), `export interface AdminRecord {
  id: string;
  title: string;
  score: number;
}

const records = new Map<string, AdminRecord>();

export const createRecord = (record: AdminRecord): void => { records.set(record.id, record); };
export const updateRecord = (record: AdminRecord): boolean => {
  if (!records.has(record.id)) return false;
  records.set(record.id, record);
  return true;
};
export const deleteRecord = (id: string): boolean => records.delete(id);
export const listRecords = (): AdminRecord[] => [...records.values()].sort((left, right) => left.id.localeCompare(right.id));
`);

  const apiRoot = path.join(projectDir, 'src', 'acceptance', '_api');
  fs.writeFileSync(path.join(apiRoot, 'createRecord_v1.ts'), `import type { AuthProps } from '../../../config';
import { createRecord, type AdminRecord } from '../_server/adminStore';

export const httpMethod = 'POST' as const;
export const rateLimit = false;
export const auth: AuthProps = { login: false };
export interface ApiParams { data: AdminRecord; }
export interface ApiResponse { status: 'success'; }
export const main = ({ data }: ApiParams): ApiResponse => {
  createRecord(data);
  return { status: 'success' };
};
`);
  fs.writeFileSync(path.join(apiRoot, 'listRecords_v1.ts'), `import type { AuthProps } from '../../../config';
import { listRecords } from '../_server/adminStore';

export const httpMethod = 'GET' as const;
export const rateLimit = false;
export const auth: AuthProps = { login: false };
export interface ApiResponse { status: 'success'; count: number; }
export const main = (): ApiResponse => ({ status: 'success', count: listRecords().length });
`);
  fs.writeFileSync(path.join(apiRoot, 'editRecord_v1.ts'), `import type { AuthProps } from '../../../config';
import { updateRecord, type AdminRecord } from '../_server/adminStore';

export const httpMethod = 'PUT' as const;
export const rateLimit = false;
export const auth: AuthProps = { login: false };
export interface ApiParams { data: AdminRecord; }
export type ApiResponse = { status: 'success' } | { status: 'error'; errorCode: 'admin.recordMissing' };
export const main = ({ data }: ApiParams): ApiResponse => updateRecord(data)
  ? { status: 'success' }
  : { status: 'error', errorCode: 'admin.recordMissing' };
`);
  fs.writeFileSync(path.join(apiRoot, 'deleteRecord_v1.ts'), `import type { AuthProps } from '../../../config';
import { deleteRecord } from '../_server/adminStore';

export const httpMethod = 'DELETE' as const;
export const rateLimit = false;
export const auth: AuthProps = { login: false };
export interface ApiParams { data: { id: string }; }
export type ApiResponse = { status: 'success' } | { status: 'error'; errorCode: 'admin.recordMissing' };
export const main = ({ data }: ApiParams): ApiResponse => deleteRecord(data.id)
  ? { status: 'success' }
  : { status: 'error', errorCode: 'admin.recordMissing' };
`);
  fs.writeFileSync(path.join(apiRoot, 'verifyAdmin_v1.ts'), `import type { AuthProps } from '../../../config';
import { listRecords, type AdminRecord } from '../_server/adminStore';

export const httpMethod = 'POST' as const;
export const rateLimit = false;
export const auth: AuthProps = { login: false };
export interface ApiParams {
  data: { expectedIds: string[]; updated: AdminRecord; deletedId: string };
}
export type ApiResponse = { status: 'success' } | { status: 'error'; errorCode: 'admin.criteriaFailed' };
export const main = ({ data }: ApiParams): ApiResponse => {
  const records = listRecords();
  const updated = records.find((record) => record.id === data.updated.id);
  const passed = records.map((record) => record.id).join(',') === [...data.expectedIds].sort().join(',')
    && updated?.title === data.updated.title
    && updated.score === data.updated.score
    && !records.some((record) => record.id === data.deletedId);
  return passed ? { status: 'success' } : { status: 'error', errorCode: 'admin.criteriaFailed' };
};
`);

  const adminPageRoot = path.join(projectDir, 'src', 'admin-acceptance');
  fs.mkdirSync(adminPageRoot, { recursive: true });
  fs.writeFileSync(path.join(adminPageRoot, 'page.tsx'), `//? intent: Exercise a synthetic admin CRUD workflow against deterministic seeded data.
import { useEffect } from 'react';
import { apiRequest } from 'src/_sockets/apiRequest';

interface AdminAcceptanceState { status: 'pending' | 'success' | 'error'; steps: string[]; }
declare global { interface Window { __luckystackAdminAcceptance: AdminAcceptanceState; } }
window.__luckystackAdminAcceptance = { status: 'pending', steps: [] };

const records = ${JSON.stringify(records)};
const updated = ${JSON.stringify(updated)};
const deletedId = ${JSON.stringify(deletedId)};
const expectedIds = ${JSON.stringify(records.slice(0, -1).map((record) => record.id))};

const AdminAcceptancePage = () => {
  useEffect(() => {
    void (async () => {
      const steps: string[] = [];
      for (const record of records) {
        const response = await apiRequest({ name: 'acceptance/createRecord', version: 'v1', data: record });
        steps.push('create:' + response.status);
      }
      const listed = await apiRequest({ name: 'acceptance/listRecords', version: 'v1' });
      steps.push('list:' + listed.status);
      const edited = await apiRequest({ name: 'acceptance/editRecord', version: 'v1', data: updated });
      steps.push('edit:' + edited.status);
      const deleted = await apiRequest({ name: 'acceptance/deleteRecord', version: 'v1', data: { id: deletedId } });
      steps.push('delete:' + deleted.status);
      const verified = await apiRequest({
        name: 'acceptance/verifyAdmin',
        version: 'v1',
        data: { expectedIds, updated, deletedId },
      });
      steps.push('verify:' + verified.status);
      window.__luckystackAdminAcceptance = {
        status: steps.every((step) => step.endsWith(':success')) ? 'success' : 'error',
        steps,
      };
    })();
  }, []);
  return <div data-testid={'admin-acceptance-status'} />;
};
export const template = 'plain';
export default AdminAcceptancePage;
`);

  const gamePageRoot = path.join(projectDir, 'src', 'game-acceptance');
  fs.mkdirSync(gamePageRoot, { recursive: true });
  fs.writeFileSync(path.join(gamePageRoot, 'page.tsx'), `//? intent: Exercise a deterministic two-browser multiplayer exchange over routed sync and Redis fanout.
import { useEffect } from 'react';
import { syncRequest, useSyncEvents } from 'src/_sockets/syncRequest';

interface GameAcceptanceState {
  status: 'booting' | 'ready' | 'error';
  received: number;
  send: (marker: string) => Promise<string>;
}
declare global { interface Window { __luckystackGameAcceptance: GameAcceptanceState; } }
window.__luckystackGameAcceptance = {
  status: 'booting',
  received: 0,
  send: async () => 'error',
};

const GameAcceptancePage = () => {
  const { upsertSyncEventCallback } = useSyncEvents();
  useEffect(() => {
    const peer = new URL(globalThis.location.href).searchParams.get('peer') ?? '';
    let received = 0;
    const teardown = upsertSyncEventCallback({
      name: 'acceptance/fanout',
      version: 'v1',
      callback: ({ serverOutput }) => {
        if (serverOutput.status !== 'success') return;
        received += 1;
        window.__luckystackGameAcceptance.received = received;
      },
    });
    window.__luckystackGameAcceptance = {
      status: peer ? 'ready' : 'error',
      received,
      send: async (marker: string) => {
        const response = await syncRequest({
          name: 'acceptance/fanout',
          version: 'v1',
          data: { marker },
          receiver: peer,
          ignoreSelf: true,
        });
        return response.status;
      },
    };
    return teardown;
  }, [upsertSyncEventCallback]);
  return <div data-testid={'game-acceptance-status'} />;
};
export const template = 'plain';
export default GameAcceptancePage;
`);
};

const startLoggedProcess = ({ label, command, args, cwd, env }) => {
  const logPath = path.join(cwd, `e2e-${label}.log`);
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', logFd, logFd],
    shell: true,
    detached: false,
  });
  let exited = false;
  child.on('exit', () => { exited = true; });
  return { label, child, logFd, logPath, isDead: () => exited };
};

const stopLoggedProcess = (running) => {
  stopProcessTree(running.child);
  fs.closeSync(running.logFd);
};

const printProcessLog = (running) => {
  console.error(`[e2e] ${running.label} log:`);
  console.error(fs.readFileSync(running.logPath, 'utf8').split('\n').slice(-60).join('\n'));
};

const runExtendedBrowserAcceptance = async ({ browser, frontendPort, seed }) => {
  const contexts = [];
  try {
    const adminContext = await browser.newContext();
    contexts.push(adminContext);
    const adminPage = await adminContext.newPage();
    const adminMethods = new Map();
    const errors = [];
    const adminSockets = [];
    adminPage.on('request', (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith('/api/acceptance/')) adminMethods.set(pathname, request.method());
    });
    adminPage.on('websocket', (socket) => { adminSockets.push(socket.url()); });
    adminPage.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    adminPage.on('pageerror', (error) => { errors.push(error.message); });
    await adminPage.addInitScript((token) => { sessionStorage.setItem('token', token); }, `admin-seed-${String(seed)}`);
    await adminPage.goto(`http://localhost:${String(frontendPort)}/admin-acceptance`, { waitUntil: 'domcontentloaded' });
    await adminPage.waitForFunction(() => window.__luckystackAdminAcceptance?.status !== 'pending', undefined, { timeout: 120_000 });
    const adminResult = await adminPage.evaluate(() => window.__luckystackAdminAcceptance);
    const expectedAdminMethods = new Map([
      ['/api/acceptance/createRecord/v1', 'POST'],
      ['/api/acceptance/listRecords/v1', 'GET'],
      ['/api/acceptance/editRecord/v1', 'PUT'],
      ['/api/acceptance/deleteRecord/v1', 'DELETE'],
      ['/api/acceptance/verifyAdmin/v1', 'POST'],
    ]);
    const adminMethodsMatch = [...expectedAdminMethods].every(([pathname, method]) => adminMethods.get(pathname) === method);

    const gameAContext = await browser.newContext();
    const gameBContext = await browser.newContext();
    contexts.push(gameAContext, gameBContext);
    const gameAPage = await gameAContext.newPage();
    const gameBPage = await gameBContext.newPage();
    const tokenA = `game-a-${String(seed)}`;
    const tokenB = `game-b-${String(seed)}`;
    const gameASockets = [];
    const gameBSockets = [];
    for (const [page, sockets] of [[gameAPage, gameASockets], [gameBPage, gameBSockets]]) {
      page.on('websocket', (socket) => { sockets.push(socket.url()); });
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('pageerror', (error) => { errors.push(error.message); });
    }
    await gameAPage.addInitScript((token) => { sessionStorage.setItem('token', token); }, tokenA);
    await gameBPage.addInitScript((token) => { sessionStorage.setItem('token', token); }, tokenB);
    await Promise.all([
      gameAPage.goto(`http://localhost:${String(frontendPort)}/game-acceptance?peer=${tokenB}`, { waitUntil: 'domcontentloaded' }),
      gameBPage.goto(`http://localhost:${String(frontendPort)}/game-acceptance?peer=${tokenA}`, { waitUntil: 'domcontentloaded' }),
    ]);
    await Promise.all([
      gameAPage.waitForFunction(() => window.__luckystackGameAcceptance?.status === 'ready', undefined, { timeout: 120_000 }),
      gameBPage.waitForFunction(() => window.__luckystackGameAcceptance?.status === 'ready', undefined, { timeout: 120_000 }),
    ]);
    const sendA = await gameAPage.evaluate(() => window.__luckystackGameAcceptance.send('move-a'));
    await gameBPage.waitForFunction(() => window.__luckystackGameAcceptance.received === 1, undefined, { timeout: 30_000 });
    const aAfterOwnMove = await gameAPage.evaluate(() => window.__luckystackGameAcceptance.received);
    const sendB = await gameBPage.evaluate(() => window.__luckystackGameAcceptance.send('move-b'));
    await gameAPage.waitForFunction(() => window.__luckystackGameAcceptance.received === 1, undefined, { timeout: 30_000 });
    const [gameAResult, gameBResult] = await Promise.all([
      gameAPage.evaluate(() => window.__luckystackGameAcceptance),
      gameBPage.evaluate(() => window.__luckystackGameAcceptance),
    ]);
    const countSockets = (urls) => urls.filter((url) => url.includes('/socket.io/')).length;
    const gamePassed = sendA === 'success'
      && sendB === 'success'
      && aAfterOwnMove === 0
      && gameAResult.received === 1
      && gameBResult.received === 1
      && countSockets(gameASockets) === 1
      && countSockets(gameBSockets) === 1;
    const adminPassed = adminResult.status === 'success'
      && adminMethodsMatch
      && countSockets(adminSockets) === 1;
    console.log(`[e2e]   seeded admin result=${JSON.stringify(adminResult)}`);
    console.log(`[e2e]   seeded multiplayer A=${JSON.stringify(gameAResult)} B=${JSON.stringify(gameBResult)}`);
    if (errors.length > 0) console.error(`[e2e]   extended browser errors=${JSON.stringify(errors)}`);
    return adminPassed && gamePassed && errors.length === 0;
  } catch (error) {
    console.error('[e2e] extended browser acceptance failed:', error);
    return false;
  } finally {
    for (const context of contexts.toReversed()) await context.close();
  }
};

export const runRoutedBrowserAcceptance = async ({ projectDir, ports, redisPort, extended = false, seed = 17 }) => {
  if (!(await isPortOpen(redisPort))) {
    console.error(`[e2e] routed browser acceptance requires Redis on ${HOST}:${String(redisPort)}.`);
    return false;
  }

  const sharedEnv = {
    NODE_ENV: 'production',
    LUCKYSTACK_ENV: 'acceptance',
    LUCKYSTACK_ENV_FILES: '/dev/null',
    PROJECT_NAME: 'luckystack-consumer-acceptance',
    SERVER_IP: HOST,
    REDIS_HOST: HOST,
    REDIS_PORT: String(redisPort),
    REDIS_USER: '',
    REDIS_PASSWORD: '',
    DATABASE_URL: 'file:./acceptance.sqlite',
    PUBLIC_URL: `http://localhost:${String(ports.frontendPort)}`,
    SECURE: 'false',
  };

  const processes = [
    startLoggedProcess({
      label: 'system', command: 'node', args: ['dist/server.js', 'system-preset', String(ports.systemPort)],
      cwd: projectDir, env: sharedEnv,
    }),
    startLoggedProcess({
      label: 'acceptance', command: 'node', args: ['dist/server.js', 'acceptance-preset', String(ports.acceptancePort)],
      cwd: projectDir, env: sharedEnv,
    }),
  ];

  let browser;
  try {
    for (const running of processes) {
      const port = running.label === 'system' ? ports.systemPort : ports.acceptancePort;
      if (!(await waitForHttp200(`http://${HOST}:${String(port)}/livez`, 90_000, running.isDead))) {
        printProcessLog(running);
        return false;
      }
    }

    const router = startLoggedProcess({
      label: 'router',
      command: 'node',
      args: [
        'node_modules/@luckystack/router/dist/cli.js',
        '--deploy', 'dist/router/deploy.config.js',
        '--services', 'dist/router/services.config.js',
        '--env', 'acceptance',
        '--port', String(ports.routerPort),
      ],
      cwd: projectDir,
      env: { ...sharedEnv, ROUTER_PORT: String(ports.routerPort) },
    });
    processes.push(router);
    if (!(await waitForPort(ports.routerPort, 60_000, router.isDead))) {
      printProcessLog(router);
      return false;
    }

    const frontend = startLoggedProcess({
      label: 'frontend',
      command: 'npm',
      args: ['run', 'client', '--', '--port', String(ports.frontendPort), '--strictPort'],
      cwd: projectDir,
      env: { ...sharedEnv, NODE_ENV: 'development', ROUTER_PORT: String(ports.routerPort) },
    });
    processes.push(frontend);
    if (!(await waitForHttp200(`http://localhost:${String(ports.frontendPort)}/`, 90_000, frontend.isDead))) {
      printProcessLog(frontend);
      return false;
    }

    const { chromium } = await import('@playwright/test');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const methods = new Map();
    const websocketUrls = [];
    const browserErrors = [];
    const httpFailures = [];
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith('/api/acceptance/')) methods.set(pathname, request.method());
    });
    page.on('response', (response) => {
      if (response.status() >= 400) httpFailures.push(`${String(response.status())} ${response.url()}`);
    });
    page.on('websocket', (socket) => { websocketUrls.push(socket.url()); });
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('pageerror', (error) => { browserErrors.push(error.message); });
    await page.addInitScript(() => {
      sessionStorage.setItem('token', 'acceptance-browser-token');
    });
    await page.goto(`http://localhost:${String(ports.frontendPort)}/acceptance`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__luckystackAcceptance?.status !== 'pending', undefined, { timeout: 120_000 });
    await page.waitForTimeout(1_000);
    const result = await page.evaluate(() => window.__luckystackAcceptance);
    const expectedMethods = new Map([
      ['/api/acceptance/organization/v1', 'GET'],
      ['/api/acceptance/getMutation/v1', 'POST'],
      ['/api/acceptance/removeReplacement/v1', 'PUT'],
      ['/api/acceptance/updateArchive/v1', 'DELETE'],
    ]);
    const methodsMatch = [...expectedMethods].every(([pathname, method]) => methods.get(pathname) === method);
    const socketCount = websocketUrls.filter((url) => url.includes('/socket.io/')).length;
    console.log(`[e2e]   browser result=${JSON.stringify(result)}`);
    console.log(`[e2e]   methods=${JSON.stringify(Object.fromEntries(methods))}`);
    console.log(`[e2e]   Socket.io websocket count=${String(socketCount)}`);
    if (browserErrors.length > 0) console.error(`[e2e]   browser errors=${JSON.stringify(browserErrors)}`);
    if (httpFailures.length > 0) console.error(`[e2e]   HTTP failures=${JSON.stringify(httpFailures)}`);
    const basePassed = result.status === 'success'
      && methodsMatch
      && socketCount === 1
      && browserErrors.length === 0;
    const extendedPassed = !extended || await runExtendedBrowserAcceptance({
      browser,
      frontendPort: ports.frontendPort,
      seed,
    });
    return basePassed && extendedPassed;
  } catch (error) {
    console.error('[e2e] routed browser acceptance failed:', error);
    for (const running of processes) printProcessLog(running);
    return false;
  } finally {
    if (browser) await browser.close();
    for (const running of processes.toReversed()) stopLoggedProcess(running);
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

  //? Use the canonical Windows path, not its 8.3 alias. Mixing `MATHIJ~1`
  //? with the long path returned by Vite makes tsconfig-path aliases appear
  //? outside Vite's serving allow-list and degrades generator source matching.
  const tempRoot = process.platform === 'win32' ? fs.realpathSync.native(os.tmpdir()) : os.tmpdir();
  const work = fs.mkdtempSync(path.join(tempRoot, 'ls-e2e-'));
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

  const publicNpmrcPath = path.join(work, 'public.npmrc');
  fs.writeFileSync(publicNpmrcPath, 'registry=https://registry.npmjs.org/\n');
  const publicRegistryEnv = {
    npm_config_userconfig: publicNpmrcPath,
    npm_config_registry: 'https://registry.npmjs.org/',
    npm_config_cache: path.join(work, 'public-npm-cache'),
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

  console.log(`[e2e] mode=${args.mode} pm=${args.pm} runtime=${args.runtime}${args.runtimeSmoke ? ' (real server smoke)' : ' (build only)'}${args.browserRouted ? ` + routed browser${args.extendedBrowser ? ` extended(seed=${String(args.seed)})` : ''}` : ''}`);
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

    //? THE POINT OF THIS HARNESS: fresh mode fetches the candidate scaffolder
    //? from Verdaccio. Upgrade mode first creates an immutable N-1 npm consumer,
    //? then installs candidate package ranges and executes BOTH update scopes.
    if (args.mode === 'fresh') {
      step('scaffold candidate (real registry, WITH install)', () =>
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
    } else {
      const previousVersion = resolvePreviousPublishedVersion(scaffolderVersion, publicRegistryEnv);
      step('resolve an immutable previous npm release', () => {
        console.log(`[e2e]   candidate=${scaffolderVersion} previous=${previousVersion ?? '(none)'}`);
        return previousVersion !== null;
      });
      if (previousVersion) {
        step(`scaffold previous npm release ${previousVersion}`, () =>
          run(
            'npx',
            [
              '--yes',
              '--registry',
              'https://registry.npmjs.org/',
              `create-luckystack-app@${previousVersion}`,
              projectName,
              '--pm=npm',
              ...args.scaffoldArgs.split(' ').filter(Boolean),
              '--no-prompt',
            ],
            projectParent,
            publicRegistryEnv,
          ),
        );
        if (fs.existsSync(projectDir)) {
          step(`upgrade ${previousVersion} → candidate ${scaffolderVersion} including update --app`, () =>
            upgradeProjectToCandidate({ projectDir, candidateVersion: scaffolderVersion, registryEnv }));
        }
      }
    }

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

      if (/(?:^|\s)--router(?:\s|$)/.test(args.scaffoldArgs)) {
        step('consumer registers the generated API method map', () => {
          const source = fs.readFileSync(path.join(projectDir, 'src', '_sockets', 'apiRequest.ts'), 'utf8');
          return source.includes('registerApiMethodMap(apiMethodMap)');
        });
      }

      let routedAcceptancePorts = null;
      if (args.browserRouted) {
        await stepAsync('write split-service routed browser fixture', async () => {
          routedAcceptancePorts = await writeRoutedAcceptanceFixture(projectDir, {
            extended: args.extendedBrowser,
            seed: args.seed,
          });
          return routedAcceptancePorts !== null;
        });
      }

      //? No explicit generateArtifacts step: the template now chains it into
      //? BOTH typecheck and build (E1), mirroring what it already did for test.
      //? Leaving the step here would MASK a regression of that chaining.
      step('typecheck', () => run('npm', ['run', 'typecheck'], projectDir));
      step('build', () => run('npm', ['run', 'build'], projectDir));

      if (args.browserRouted && routedAcceptancePorts) {
        const browserLabel = args.extendedBrowser
          ? `browser passes routed, seeded admin and two-player acceptance (seed ${String(args.seed)})`
          : 'browser uses declared methods and receives cross-instance sync over one Socket.io connection';
        await stepAsync(browserLabel, () => runRoutedBrowserAcceptance({
          projectDir,
          ports: routedAcceptancePorts,
          redisPort: args.redisPort,
          extended: args.extendedBrowser,
          seed: args.seed,
        }));
      }

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

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  void main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error('[e2e] harness crashed:', error);
      process.exit(1);
    });
}
