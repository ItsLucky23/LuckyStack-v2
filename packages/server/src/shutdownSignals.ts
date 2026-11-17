import { dispatchHook, getLogger, markServerShutdownStarted, tryCatch } from '@luckystack/core';
import type { StopLuckyStackServerOptions } from './types';
import { DEFAULT_SHUTDOWN_TIMEOUT_MS } from './stopServer';

export const validateShutdownTimeout = (timeoutMs: number | undefined): void => {
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647)) {
    throw new RangeError('shutdownTimeoutMs must be a positive integer within the Node timer range');
  }
};

/** Keep signal escalation separate from the idempotent programmatic stop API. */
export const installShutdownSignalHandlers = ({
  timeoutMs,
  stop,
}: {
  timeoutMs?: number;
  /** Absent in dev, where only the bounded hook runs before a hard exit. */
  stop?: (options: StopLuckyStackServerOptions) => Promise<void>;
}): void => {
  validateShutdownTimeout(timeoutMs);
  const budget = timeoutMs ?? (stop ? DEFAULT_SHUTDOWN_TIMEOUT_MS : 2000);
  //? The supervisor must outlive every bounded step, not just the hooks.
  //? Production has six sequential steps (drain, stop hook, flush, io/http
  //? close, two Redis quits); dev runs only the drain and stop hooks.
  if (timeoutMs !== undefined && process.connected && typeof process.send === 'function') {
    process.send({ type: 'luckystack:shutdown-grace', graceMs: budget * (stop ? 6 : 2) + 1000 }, undefined, undefined, (error) => {
      if (error) getLogger().warn(`[shutdown] could not notify supervisor: ${error.message}`);
    });
  }

  //? Only a repeat of the FIRST signal escalates. A terminal Ctrl+C sends
  //? SIGINT to the whole process group, and the devkit supervisor then
  //? forwards SIGTERM to this child; treating that SIGTERM as a second
  //? signal would skip the drain on every dev Ctrl+C.
  let firstSignal: 'SIGINT' | 'SIGTERM' | null = null;
  const handleSignal = (reason: 'SIGINT' | 'SIGTERM'): void => {
    if (firstSignal) {
      if (reason !== firstSignal) return;
      // eslint-disable-next-line unicorn/no-process-exit -- explicit repeated-signal escalation
      process.exit(1);
      return;
    }
    firstSignal = reason;
    void (async () => {
      const [error] = await tryCatch(async () => {
        if (stop) {
          await stop({ reason, timeoutMs: budget });
          return;
        }
        //? Dev closes no listeners: the supervisor starts the next child only
        //? after this one exits. Both hooks still run, each within the budget.
        markServerShutdownStarted();
        for (const hookName of ['preServerDrain', 'preServerStop'] as const) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              dispatchHook(hookName, { reason, timeoutMs: budget }),
              new Promise<void>((resolve) => { timer = setTimeout(resolve, budget); }),
            ]);
          } finally {
            clearTimeout(timer);
          }
        }
      });
      if (error) getLogger().warn(`[shutdown] signal drain failed: ${error.message}`);
      // eslint-disable-next-line unicorn/no-process-exit -- top-level signal handler, exits after bounded drain
      process.exit(0);
    })();
  };
  process.on('SIGINT', () => { handleSignal('SIGINT'); });
  process.on('SIGTERM', () => { handleSignal('SIGTERM'); });
};
