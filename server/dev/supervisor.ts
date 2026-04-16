import { spawn, type ChildProcess } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { watch } from 'chokidar';
import { env } from '../bootstrap/env';

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
let childBootStartedAt = 0;

const startChild = () => {
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
      setTimeout(() => {
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
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  pendingRestart = false;

  if (childProcess) {
    childProcess.kill('SIGTERM');
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

  process.on('SIGINT', () => {
    void watcher.close().then(() => {
      shutdownSupervisor();
    });
  });

  process.on('SIGTERM', () => {
    void watcher.close().then(() => {
      shutdownSupervisor();
    });
  });

  startChild();
}
