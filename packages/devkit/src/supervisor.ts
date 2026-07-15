#!/usr/bin/env node
//? CRITICAL INVARIANT: this process must NEVER merge `.env` files into its own
//? `process.env`. The child is spawned with `{ ...process.env }`, and the
//? child's own `loadEnvFiles()` loads `.env` with `override: false` — any
//? `.env`-derived value that leaks into the supervisor's env would therefore
//? WIN over freshly edited file values on every restart (stale-env bug).
//? That is why this file imports NOTHING from `@luckystack/core` (core runs
//? `bootstrapEnv()` as an import side-effect) and reads env files via
//? `dotenv.parse` (pure — no `process.env` mutation). The previous design
//? (an `ambientEnvSnapshot` module imported first) broke as soon as tsup
//? inlined the snapshot into the entry body: ESM imports are hoisted, so
//? core's side-effect ran BEFORE the snapshot line.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { watch } from 'chokidar';
import { parse as parseDotenv } from 'dotenv';

const RESTART_DEBOUNCE_MS = 150;
const CRASH_RESTART_DELAY_MS = 300;
//? Rapid-crash-loop breaker. A child that exits non-zero within
//? FAST_CRASH_THRESHOLD_MS of booting counts as a "fast crash" (it died during
//? startup rather than after serving). MAX_CONSECUTIVE_FAST_CRASHES of those in
//? a row means the startup error is not transient (a port already in use, a
//? syntax error, a missing env) — restarting forever just spams the console, so
//? we give up and print an actionable message. A child that survives longer than
//? the threshold resets the counter, so a normal restart loop is unaffected.
const FAST_CRASH_THRESHOLD_MS = 3000;
const MAX_CONSECUTIVE_FAST_CRASHES = 4;
//? Force-exit grace: how long we wait for the child to honour SIGTERM before
//? the supervisor hard-exits. Windows does not deliver SIGKILL so the only
//? lever is this timer. 1 500 ms is intentionally short (dev restarts should
//? be fast); increase via LUCKYSTACK_SUPERVISOR_GRACE_MS for slow servers.
const SHUTDOWN_GRACE_MS = Number(process.env.LUCKYSTACK_SUPERVISOR_GRACE_MS) || 1500;

//? Mirrors `getEnvFiles()` from @luckystack/core — duplicated on purpose so the
//? supervisor never imports core (see the invariant above). Keep in sync.
const DEFAULT_ENV_FILES = ['.env', '.env.local'];
const getEnvFiles = (): string[] => {
  const override = process.env.LUCKYSTACK_ENV_FILES;
  if (override) {
    const list = override.split(',').map((entry) => entry.trim()).filter(Boolean);
    if (list.length > 0) return list;
  }
  return DEFAULT_ENV_FILES;
};

//? Resolve NODE_ENV without mutating `process.env`: a real ambient env var
//? wins; otherwise read the env files via the pure `dotenv.parse` ("later
//? overrides earlier", matching loadEnvFiles' file order).
const resolveNodeEnv = (): string => {
  if (process.env.NODE_ENV) return process.env.NODE_ENV;
  let fromFiles: string | undefined;
  for (const file of getEnvFiles()) {
    const filePath = path.resolve(process.cwd(), file);
    if (!existsSync(filePath)) continue;
    const parsed = parseDotenv(readFileSync(filePath, 'utf8'));
    if (typeof parsed.NODE_ENV === 'string' && parsed.NODE_ENV.length > 0) fromFiles = parsed.NODE_ENV;
  }
  return fromFiles ?? 'development';
};

//? chokidar v5 removed glob support — a `server/bootstrap/**/*.ts` pattern is no
//? longer expanded; it is watched as a LITERAL path that never exists, so changes
//? under `server/bootstrap` / `server/auth` silently never triggered a restart.
//? Watch the concrete files directly, and the bootstrap/auth DIRECTORIES
//? recursively (chokidar's default for a directory), then filter events down to
//? the file types the old globs targeted in the `all` handler below.
const CORE_WATCH_FILES = [
  'config.ts',
  ...getEnvFiles(),
  'server/server.ts',
  'server/functions/db.ts',
  'server/functions/redis.ts',
  'server/functions/sentry.ts',
];
//? Only watch dirs that exist — chokidar watching a recursive non-existent
//? directory is wasteful/odd; a dir created later is picked up on next boot.
const CORE_WATCH_DIRS = ['server/bootstrap', 'server/auth'].filter((dir) =>
  existsSync(path.resolve(process.cwd(), dir)),
);
const CORE_WATCH_TARGETS = [...CORE_WATCH_FILES, ...CORE_WATCH_DIRS];

const tsxCliPath = path.resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
//? Scaffolded projects carry a dedicated server tsconfig — pass it when present
//? so the child matches a manual `tsx --tsconfig tsconfig.server.json` run.
const tsconfigServerArgs = existsSync(path.resolve(process.cwd(), 'tsconfig.server.json'))
  ? ['--tsconfig', 'tsconfig.server.json']
  : [];

//? ---------------------------------------------------------------------------
//? Runtime honouring — `bun run server` must ACTUALLY run Bun
//? ---------------------------------------------------------------------------
//? A LuckyStack project must work on Node AND Bun. On Windows that is not
//? automatic and the failure is SILENT: npm generates a `.cmd` shim per bin
//? (`node_modules/.bin/luckystack-dev.cmd`) which hardcodes a `node` call, so
//? `bun run server` dutifully launches NODE while every log line still looks
//? green. Windows has no shebang to intercept, so the shim always wins.
//? Verified empirically on bun 1.3.14 / Windows:
//?   `bun run server`       -> child ran C:\Program Files\nodejs\node.exe
//?   `bun --bun run server` -> child ran Bun (via a node-shim Bun injects at
//?                             %TEMP%\bun-node-<hash>\node.exe)
//? Bun does leave fingerprints even when it hands off to Node:
//?   npm_config_user_agent = "bun/1.3.14 npm/? node/v24.3.0 win32 x64"
//?   npm_execpath          = "<abs>/bun.exe"
//? That lets us tell "the developer typed `bun run`" from "the developer typed
//? `npm run`", and `npm_execpath` hands us the real bun binary to correct
//? course with. The CHILD is what actually serves the app, so the child is
//? where the intended runtime gets honoured. This keeps the promise honest
//? with NO new runtime choice: no extra script name, no wizard question, no
//? manifest dimension — `npm run server` stays Node, `bun run server` is Bun.
const BUN_BINARY_PATTERN = /(?:^|[\\/])bun(?:\.exe)?$/i;

export type SupervisorRuntime = 'node' | 'bun';

export interface ChildSpawnSpec {
  command: string;
  args: string[];
  runtime: SupervisorRuntime;
}

export interface ResolveChildSpawnInput {
  //? `'Bun' in globalThis` at the call site — passed in so the branch is testable.
  isBun: boolean;
  execPath: string;
  npmUserAgent: string | undefined;
  npmExecPath: string | undefined;
  tsxCliPath: string;
  tsconfigServerArgs: string[];
  //? MUST be absolute — see the fork-bomb note in the bun re-exec branch.
  entry: string;
  fileExists: (candidate: string) => boolean;
}

//? Result shape rather than a throw: this module may not import
//? `@luckystack/core` (see the invariant at the top of this file), so the
//? framework's `tryCatch` is unavailable here and a bare throw at module scope
//? would surface as an ugly unhandled stack instead of an actionable message.
export type ResolveChildSpawnResult =
  | { ok: true; spec: ChildSpawnSpec }
  | { ok: false; message: string };

export const resolveChildSpawn = ({
  isBun,
  execPath,
  npmUserAgent,
  npmExecPath,
  tsxCliPath: tsxCli,
  tsconfigServerArgs: tsconfigArgs,
  entry,
  fileExists,
}: ResolveChildSpawnInput): ResolveChildSpawnResult => {
  //? Already executing under Bun (`bun --bun run server`, or `bun server/server.ts`).
  //? `process.execPath` is then either bun itself or the node-shim Bun injects for
  //? bin scripts — BOTH re-enter Bun (verified on 1.3.14/Windows), so spawning
  //? execPath keeps the child on Bun. tsx is dropped deliberately: Bun compiles
  //? TypeScript natively, so tsx would only add a redundant transpile hop, and
  //? `--tsconfig` is not a Bun flag at all (Bun reads `tsconfig.json` itself).
  if (isBun) return { ok: true, spec: { command: execPath, args: [entry], runtime: 'bun' } };

  const launchedByBun =
    (npmUserAgent ?? '').startsWith('bun/') || BUN_BINARY_PATTERN.test(npmExecPath ?? '');

  //? Plain `npm run server` — the canonical Node path, unchanged. Node cannot
  //? run the whole TypeScript server tree on its own, so tsx stays.
  if (!launchedByBun) {
    return {
      ok: true,
      spec: { command: execPath, args: [tsxCli, ...tsconfigArgs, entry], runtime: 'node' },
    };
  }

  //? `bun run server` on Windows: WE are Node (the .cmd shim won), but the
  //? developer asked for Bun. Re-exec the child through the real bun binary.
  const bunBinary = npmExecPath ?? '';
  if (!BUN_BINARY_PATTERN.test(bunBinary) || !fileExists(bunBinary)) {
    //? Fail LOUD rather than quietly serving from Node. Silently continuing is
    //? the exact trap this branch exists to remove: it would look green while
    //? proving nothing about Bun compatibility.
    return {
      ok: false,
      message:
        'Detected a `bun run` launch, but could not locate the bun binary to run the server with ' +
        `(npm_execpath=${npmExecPath ?? '<unset>'}). Refusing to silently fall back to Node — ` +
        'that would look like a working Bun boot while actually running Node. ' +
        'Run `npm run server` for the Node path, or reinstall/repair Bun so it is on PATH.',
    };
  }

  //? `entry` MUST be absolute: `bun run <name>` resolves a package.json SCRIPT
  //? before a file, so a relative `server/server.ts` could re-enter the `server`
  //? script and fork-bomb. An absolute path can never be read as a script name.
  return { ok: true, spec: { command: bunBinary, args: ['--bun', 'run', entry], runtime: 'bun' } };
};

const resolvedChildSpawn = resolveChildSpawn({
  isBun: 'Bun' in globalThis,
  execPath: process.execPath,
  npmUserAgent: process.env.npm_config_user_agent,
  npmExecPath: process.env.npm_execpath,
  tsxCliPath,
  tsconfigServerArgs,
  entry: path.resolve(process.cwd(), 'server', 'server.ts'),
  fileExists: existsSync,
});


let childProcess: ChildProcess | null = null;
let pendingRestart = false;
let restartTimer: NodeJS.Timeout | null = null;
let crashRestartTimer: NodeJS.Timeout | null = null;
let childBootStartedAt = 0;
let consecutiveFastCrashes = 0;
let isShuttingDown = false;

const startChild = () => {
  if (isShuttingDown) return;
  //? Defensive: `bootSupervisor()` already aborts on an unresolved spawn, so this
  //? is unreachable in practice — it exists to narrow the result type here.
  if (!resolvedChildSpawn.ok) return;
  const { command: childCommand, args: childArgs, runtime: childRuntime } = resolvedChildSpawn.spec;
  childBootStartedAt = performance.now();
  const spawned = spawn(childCommand, childArgs, {
    stdio: 'inherit',
    //? `process.env` is guaranteed `.env`-free here (see the invariant at the
    //? top of this file), so the child loads `.env` fresh on every restart and
    //? picks up edited values — mirroring a cold `npm run server` boot.
    env: {
      ...process.env,
      LUCKYSTACK_CORE_SUPERVISED: 'true',
    },
  });
  childProcess = spawned;

  //? Name the runtime explicitly. `bun run server` silently serving from Node is
  //? the bug this file guards against, so the runtime must be observable rather
  //? than assumed — a green boot log is exactly what made the old trap invisible.
  console.log(
    `[Supervisor] Started server process (pid: ${String(spawned.pid)}, runtime: ${childRuntime})`,
  );

  //? `'error'` and `'exit'` can BOTH fire for a single spawn (a failed spawn
  //? emits `'error'`, and some platforms then emit `'exit'` too). This flag
  //? resolves THIS child's lifecycle exactly once regardless of event order, so
  //? we never double-schedule a restart.
  let handled = false;

  //? A failed `spawn` (ENOENT/EACCES — e.g. a missing `tsx`) emits `'error'`,
  //? NOT `'exit'`. Without this listener Node re-throws it as an uncaught
  //? exception that kills the SUPERVISOR instead of retrying — the dev wrapper
  //? would just disappear. Route it through the same crash-restart delay.
  spawned.on('error', (err) => {
    console.log(`[Supervisor] Failed to spawn server process: ${String(err)}`, 'red');
    if (handled) return;
    handled = true;
    childProcess = null;

    if (isShuttingDown) {
      process.exit(1);
    }

    console.log(`[Supervisor] Retrying server spawn in ${String(CRASH_RESTART_DELAY_MS)}ms`);
    crashRestartTimer = setTimeout(() => {
      crashRestartTimer = null;
      startChild();
    }, CRASH_RESTART_DELAY_MS);
  });

  spawned.on('exit', (code, signal) => {
    const uptimeMs = Math.round(performance.now() - childBootStartedAt);
    const shouldRestart = pendingRestart;

    if (handled) return;
    handled = true;
    childProcess = null;

    //? Once the user has asked us to stop, never spawn another child — no matter
    //? what the previous one's exit reason was. Without this guard a crash that
    //? races with Ctrl+C re-spawns indefinitely.
    if (isShuttingDown) {
      process.exit(0);
    }

    if (shouldRestart) {
      pendingRestart = false;
      //? A watcher-driven restart is an explicit edit to a watched file — give
      //? the new code a clean slate instead of inheriting a previous crash burst.
      consecutiveFastCrashes = 0;
      console.log(`[Supervisor] Restarting server after ${String(uptimeMs)}ms uptime`);
      startChild();
      return;
    }

    if (signal === 'SIGTERM' || signal === 'SIGINT') {
      return;
    }

    if (typeof code === 'number' && code !== 0) {
      //? Rapid-crash-loop breaker: a child that died within the boot window
      //? counts toward the consecutive-fast-crash tally; one that lived longer
      //? proves the startup error cleared, so reset the tally.
      if (uptimeMs < FAST_CRASH_THRESHOLD_MS) {
        consecutiveFastCrashes += 1;
      } else {
        consecutiveFastCrashes = 0;
      }

      if (consecutiveFastCrashes >= MAX_CONSECUTIVE_FAST_CRASHES) {
        console.log(
          `[Supervisor] Server crashed ${String(consecutiveFastCrashes)} times within ` +
            `${String(FAST_CRASH_THRESHOLD_MS / 1000)}s of starting — giving up. Fix the startup ` +
            `error above (e.g. a port already in use), then re-run \`npm run server\`.`,
        );
        process.exit(1);
      }

      console.log(`[Supervisor] Server crashed with code ${String(code)}. Restarting in ${String(CRASH_RESTART_DELAY_MS)}ms`);
      crashRestartTimer = setTimeout(() => {
        crashRestartTimer = null;
        startChild();
      }, CRASH_RESTART_DELAY_MS);
    }
  });
};

const scheduleRestart = ({
  event,
  changedPath,
}: {
  event: string;
  changedPath: string;
}) => {
  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartTimer = setTimeout(() => {
    restartTimer = null;
    pendingRestart = true;

    console.log(`[Supervisor] Core change detected (${event}): ${changedPath}. Restarting server`);

    if (!childProcess) {
      pendingRestart = false;
      startChild();
      return;
    }

    childProcess.kill('SIGTERM');
  }, RESTART_DEBOUNCE_MS);
};

const shutdownSupervisor = () => {
  isShuttingDown = true;

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (crashRestartTimer) {
    clearTimeout(crashRestartTimer);
    crashRestartTimer = null;
  }

  pendingRestart = false;

  if (childProcess) {
    //? Child is still alive — its 'exit' handler will see isShuttingDown
    //? and call process.exit(0) once the child is gone. Force-exit after a
    //? short grace period in case the child ignores SIGTERM (Windows).
    childProcess.kill('SIGTERM');
    setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
  } else {
    //? No child running (e.g. we were between crashes, sitting in the
    //? crash-restart setTimeout we just cleared above) — exit immediately.
    process.exit(0);
  }
};

const bootSupervisor = () => {
  //? Fail loud before anything is watched or spawned: we were asked for Bun but
  //? cannot deliver it, and Node-in-disguise is not an acceptable substitute.
  if (!resolvedChildSpawn.ok) {
    console.error(`[Supervisor] ${resolvedChildSpawn.message}`);
    process.exit(1);
  }

  if (resolveNodeEnv() === 'production') {
    //? In production the supervisor has no file watcher, but it still needs to
    //? forward shutdown signals so the child gets a chance to drain (e.g. flush
    //? error trackers, close DB connections). Without these handlers a SIGTERM
    //? from a process manager (systemd, Docker) kills the supervisor instantly
    //? and the child may never exit cleanly.
    process.on('SIGINT', () => {
      isShuttingDown = true;
      shutdownSupervisor();
    });
    process.on('SIGTERM', () => {
      isShuttingDown = true;
      shutdownSupervisor();
    });
    startChild();
  } else {
    const watcher = watch(CORE_WATCH_TARGETS, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 120,
        pollInterval: 20,
      },
    });

    watcher.on('all', (event, changedPath) => {
      //? Ignore pure directory churn from the recursively-watched bootstrap/auth dirs.
      if (event === 'addDir' || event === 'unlinkDir') return;
      //? Restore the old `**/*.ts` glob intent: within the watched directories only
      //? TS sources matter. A `.ts` suffix covers every concrete watched TS file too
      //? (config.ts, server.ts, functions/*.ts); the non-TS watched files are the
      //? `.env*` set, matched explicitly. A stray non-TS file under a watched dir is
      //? correctly ignored.
      const normalized = changedPath.replaceAll('\\', '/');
      const relevant = normalized.endsWith('.ts') || CORE_WATCH_FILES.some((file) => normalized.endsWith(file));
      if (!relevant) return;
      scheduleRestart({ event, changedPath });
    });

    const handleSignal = (signalName: string) => {
      //? Set the flag synchronously so any in-flight child 'exit' handler
      //? running BEFORE watcher.close() resolves won't schedule a new spawn.
      if (isShuttingDown) {
        //? Second Ctrl+C — user is impatient. Hard-exit immediately.
        process.exit(1);
      }
      isShuttingDown = true;
      console.log(`[Supervisor] Received ${signalName}, shutting down`);
      void watcher.close().then(() => {
        shutdownSupervisor();
      }).catch(() => {
        shutdownSupervisor();
      });
    };

    process.on('SIGINT', () => { handleSignal('SIGINT'); });
    process.on('SIGTERM', () => { handleSignal('SIGTERM'); });

    startChild();
  }
};

//? Importing this module must not boot a server: the unit tests import
//? `resolveChildSpawn` to exercise every runtime branch, and this file is an
//? ENTRY (the `luckystack-dev` bin + the repo's `server/dev/supervisor.ts`
//? shim both rely on the import side-effect, so a `main`-module check would
//? break the shim). Default is unchanged — boot unless explicitly told not to.
if (!process.env.LUCKYSTACK_SUPERVISOR_IMPORT_ONLY) bootSupervisor();
