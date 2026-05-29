import { spawn, type ChildProcess } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { watch } from 'chokidar';
import { env } from '@luckystack/core';

const RESTART_DEBOUNCE_MS = 150;
const CRASH_RESTART_DELAY_MS = 300;

const CORE_WATCH_GLOBS = [
  'config.ts',
  '.env',
  '.env.local',
  'server/server.ts',
  'server/bootstrap/**/*.ts',
  'server/auth/**/*.ts',
  'server/sockets/socket.ts',
  'server/functions/db.ts',
  'server/functions/redis.ts',
  'server/functions/sentry.ts',
];

const tsxCliPath = path.resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
const childArgs = [tsxCliPath, 'server/server.ts'];

let childProcess: ChildProcess | null = null;
let pendingRestart = false;
let restartTimer: NodeJS.Timeout | null = null;
let crashRestartTimer: NodeJS.Timeout | null = null;
let childBootStartedAt = 0;
let isShuttingDown = false;

const startChild = () => {
  if (isShuttingDown) return;
  childBootStartedAt = performance.now();
  childProcess = spawn(process.execPath, childArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      LUCKYSTACK_CORE_SUPERVISED: 'true',
    },
  });

  console.log(`[Supervisor] Started server process (pid: ${String(childProcess.pid)})`, 'cyan');

  childProcess.on('exit', (code, signal) => {
    const uptimeMs = Math.round(performance.now() - childBootStartedAt);
    const shouldRestart = pendingRestart;

    childProcess = null;

    //? Once the user has asked us to stop, never spawn another child — no matter
    //? what the previous one's exit reason was. Without this guard a crash that
    //? races with Ctrl+C re-spawns indefinitely.
    if (isShuttingDown) {
      process.exit(0);
    }

    if (shouldRestart) {
      pendingRestart = false;
      console.log(`[Supervisor] Restarting server after ${String(uptimeMs)}ms uptime`, 'yellow');
      startChild();
      return;
    }

    if (signal === 'SIGTERM' || signal === 'SIGINT') {
      return;
    }

    if (typeof code === 'number' && code !== 0) {
      console.log(`[Supervisor] Server crashed with code ${String(code)}. Restarting in ${String(CRASH_RESTART_DELAY_MS)}ms`, 'red');
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

    console.log(`[Supervisor] Core change detected (${event}): ${changedPath}. Restarting server`, 'yellow');

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
    setTimeout(() => process.exit(0), 1500).unref();
  } else {
    //? No child running (e.g. we were between crashes, sitting in the
    //? crash-restart setTimeout we just cleared above) — exit immediately.
    process.exit(0);
  }
};

if (env.NODE_ENV === 'production') {
  startChild();
} else {
  const watcher = watch(CORE_WATCH_GLOBS, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 120,
      pollInterval: 20,
    },
  });

  watcher.on('all', (event, changedPath) => {
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
    console.log(`[Supervisor] Received ${signalName}, shutting down`, 'yellow');
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
