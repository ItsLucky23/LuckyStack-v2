# Supervisor (`supervisor.ts`)

> Dev-only. The supervisor is the parent process that watches files which cannot be hot-reloaded in-process (config, bootstrap, sockets setup, auth wiring) and restarts the LuckyStack server child whenever one of them changes. In production it skips the watcher entirely and just keeps the child crash-restarted.

The supervisor is a single Node script (`packages/devkit/src/supervisor.ts`) compiled into the devkit `dist/` and invoked by consumer projects via their own `npm run dev` script (typically `tsx node_modules/@luckystack/devkit/dist/supervisor.js` or equivalent).

It owns one child process at a time. The child runs `tsx` against `server/server.ts` and inherits stdio so its logs surface in the parent's terminal as-is.

---

## Process model

```typescript
const tsxCliPath = path.resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
const childArgs = [tsxCliPath, 'server/server.ts'];

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
  // ... attach 'exit' handler ...
};
```

Key points:

- `process.execPath` is the running Node binary, so the child uses the same Node version as the supervisor.
- `tsx` is invoked as a Node script (`node node_modules/tsx/dist/cli.mjs`) rather than via a shell — fewer cross-platform surprises (no PATH dependency, no `.cmd` shim on Windows).
- `stdio: 'inherit'` means child logs go directly to the parent's TTY. Backpressure is handled by Node, the supervisor doesn't touch the streams.
- `LUCKYSTACK_CORE_SUPERVISED=true` is set in the child env so framework code can detect that it is running under the supervisor (useful for adjusting log prefixes or skipping its own crash-restart logic).

The supervisor stores the active child handle on a module-level variable:

```typescript
let childProcess: ChildProcess | null = null;
let pendingRestart = false;
let restartTimer: NodeJS.Timeout | null = null;
let crashRestartTimer: NodeJS.Timeout | null = null;
let childBootStartedAt = 0;
let isShuttingDown = false;
```

This is intentionally global to the file — the supervisor is a single-purpose entry script, not a library.

---

## `CORE_WATCH_GLOBS`

```typescript
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
```

These are files that cannot be hot-reloaded inside the same Node process — they own framework-wide singletons (Prisma client, Redis client, Sentry SDK, Socket.io server, OAuth providers). Changing any of them requires a fresh boot.

Everything not in this list — API/sync files, page components, shared helpers, locale `.json`, `_components/*` — is hot-reloaded by `setupWatchers()` running inside the child (see `hot-reload.md`).

Adding new globs here should be deliberate. The rule of thumb: if mutation can be reflected by reassigning a module-level binding inside `@luckystack/core` (the `registerXxx` extension points), it can hot-reload; if it needs to re-run a top-level `new SomeClient(...)`, it needs a supervisor restart.

---

## Restart debouncing

```typescript
const RESTART_DEBOUNCE_MS = 150;
const CRASH_RESTART_DELAY_MS = 300;

const scheduleRestart = ({ event, changedPath }: { event: string; changedPath: string }) => {
  if (restartTimer) clearTimeout(restartTimer);

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
```

Two constants:

- **`RESTART_DEBOUNCE_MS = 150`** — coalesces bursts of save events (e.g. a project-wide rename) into a single restart.
- **`CRASH_RESTART_DELAY_MS = 300`** — delay before re-spawning after a non-zero exit, so a syntax error doesn't restart-loop at full speed.

The flow on a save:

1. Watcher fires `all` -> `scheduleRestart`.
2. Existing timer cleared; new timer queued at 150 ms.
3. Timer expires: `pendingRestart = true`, then either start a fresh child (no current) or `kill('SIGTERM')` the running one.
4. The child's `exit` handler sees `pendingRestart === true` and respawns.

`pendingRestart` is the bridge between the kill and the respawn. It's needed because the child exit handler runs asynchronously; the supervisor must remember that this particular exit was intentional.

---

## State machine

```
                    +----------------+
                    |   no child     |
                    +-------+--------+
                            | startChild()
                            v
                    +----------------+
   file change ---> |    running     |
                    +-------+--------+
                            |
            +---------------+----------------+
            |               |                |
            v               v                v
        SIGTERM          exit 0         exit code != 0
        (intentional)   (graceful,      (crash)
            |            user Ctrl+C    
            v                |              |
       respawn after     stop (or          schedule respawn
       150ms debounce    process.exit      after 300ms
       coalesce          if isShuttingDown)
```

Key transitions in the `exit` handler:

```typescript
childProcess.on('exit', (code, signal) => {
  const uptimeMs = Math.round(performance.now() - childBootStartedAt);
  const shouldRestart = pendingRestart;
  childProcess = null;

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
```

Cases handled:

| Exit signal/code | Behavior |
|---|---|
| `isShuttingDown` | `process.exit(0)` — Ctrl+C raced with a crash, do not respawn |
| `pendingRestart === true` | Respawn immediately, log uptime |
| Signal `SIGTERM` / `SIGINT` (not from us) | Treat as ordered shutdown, do not respawn |
| `code === 0` | Clean exit, do not respawn |
| `code !== 0` | Schedule a `setTimeout(startChild, 300)` respawn |

The `isShuttingDown` guard at the top is critical: without it, a crash that raced with Ctrl+C would re-spawn indefinitely because `pendingRestart` is independent of the shutdown flag.

---

## Shutdown handling

```typescript
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
    childProcess.kill('SIGTERM');
    setTimeout(() => process.exit(0), 1500).unref();
  } else {
    process.exit(0);
  }
};

const handleSignal = (signalName: string) => {
  if (isShuttingDown) {
    process.exit(1);  // second Ctrl+C — hard exit
  }
  isShuttingDown = true;
  console.log(`[Supervisor] Received ${signalName}, shutting down`, 'yellow');
  void watcher.close().then(() => {
    shutdownSupervisor();
  }).catch(() => {
    shutdownSupervisor();
  });
};

process.on('SIGINT', () => handleSignal('SIGINT'));
process.on('SIGTERM', () => handleSignal('SIGTERM'));
```

Notes:

- **`isShuttingDown` is set synchronously** at the top of `handleSignal` so any in-flight child `exit` handler running BEFORE `watcher.close()` resolves can't schedule a new spawn.
- **Second Ctrl+C exits with code 1** immediately, bypassing the graceful watcher close. The user is impatient; this is the right move.
- **`setTimeout(process.exit, 1500).unref()`** is the force-exit grace period. On Windows, child processes sometimes ignore `SIGTERM`; the unrefed timer guarantees the supervisor exits even if the child sits.
- **Watcher close is awaited** so chokidar releases file handles before exit (matters on Windows where unreleased handles block subsequent processes).

---

## Production mode

```typescript
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

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

  startChild();
}
```

In production:

- No file watcher.
- Only `startChild()` is called.
- The crash-restart timer still fires on non-zero exit (the `exit` handler always runs), so the supervisor doubles as a minimal process keeper for prod boots — useful when running directly without a system supervisor (PM2, systemd, etc.).
- Signal handlers are NOT registered in the prod branch above; the child receives signals directly (or via the system supervisor), and crash-restart is the only behavior.

`env.NODE_ENV` is read through `@luckystack/core`'s env helper, not directly from `process.env`, so any project-level env preprocessing (e.g. loading `.env.local` overrides) applies before the branch.

---

## Edge cases

- **Child exits between two debounce ticks.** The first tick set `pendingRestart = true` and killed the child. The child's exit handler respawns. The second tick fires, but `childProcess` is already a fresh process — it kills the new child too. This is correct: both saves are part of the same coalesced restart from the user's perspective.
- **Watcher event arrives during shutdown.** `handleSignal` sets `isShuttingDown = true` synchronously; `scheduleRestart` does not check this flag, but its eventual `startChild()` call DOES (`if (isShuttingDown) return;`). The kill+respawn sequence is short-circuited.
- **SIGTERM ignored by Windows child.** `shutdownSupervisor` schedules a 1500 ms force-exit via `setTimeout(process.exit, 1500).unref()`. The unref means the timer doesn't keep the event loop alive if the child does exit cleanly.
- **Rapid Ctrl+C double-tap.** First Ctrl+C: `handleSignal` flags shutdown, calls `watcher.close()`. Second Ctrl+C: `handleSignal` sees `isShuttingDown === true` and calls `process.exit(1)` immediately — no waiting for watchers or children.
- **Respawn loop after a config syntax error.** Child crashes with non-zero exit -> 300 ms crash-restart timer -> child crashes again. The supervisor will loop until the user fixes the config or kills it. There is no exponential backoff currently.

---

## Operational guidance

- The supervisor is NOT the place to add type-map regeneration — that lives in `setupWatchers` inside the child (`hot-reload.md`). The supervisor only handles restarts.
- Add new globs to `CORE_WATCH_GLOBS` only when a file change cannot be picked up by hot reload. Most additions are unnecessary — hot reload handles `_api/`, `_sync/`, components, helpers, locales, and the import dependency graph for shared modules.
- The supervisor doesn't manage ports. The child binds whatever port the framework / config specifies. If the previous child exits cleanly on SIGTERM, the port is released before the new child starts; if it doesn't, the new child's `EADDRINUSE` is a config bug, not a supervisor bug.
- Logs from the supervisor are prefixed `[Supervisor]` and colored cyan/yellow/red. They appear alongside child logs because of `stdio: 'inherit'`.
