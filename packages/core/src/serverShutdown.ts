//? Process-wide "graceful shutdown has begun" flag. The server sets it before
//? the `preServerDrain` hook, so code that schedules NEW work (cron ticks, an
//? app's own admission gate) can refuse it without depending on the order in
//? which hook handlers were registered: handlers run one after another, and a
//? drain handler registered first may wait minutes before a later one runs.
let shutdownStarted = false;

/** Called by `@luckystack/server` when a signal or `stop()` starts the shutdown. */
export const markServerShutdownStarted = (): void => {
  shutdownStarted = true;
};

/** True once this process has started its graceful shutdown. Never resets. */
export const isServerShuttingDown = (): boolean => shutdownStarted;
