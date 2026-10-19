//? Restart request from the dev server (child) to the supervisor (parent).
//?
//? Why a restart and not a reload: hot reload re-imports a route with a `?v=`
//? query, but the ESM loader caches the route's own imports by their plain URL.
//? After a helper the route imports changes, the re-imported route still links
//? to the cached OLD helper, so only a fresh process runs the new code. No
//? loader hook can carry the query down the import graph under both tsx and
//? Bun, so the supervisor restarts the child, the same way it does for a
//? `config.ts` edit.
//?
//? This module is bundled into the supervisor entry, so it must import nothing
//? from `@luckystack/core` (see the env invariant in `supervisor.ts`).

export const DEV_RESTART_MESSAGE_TYPE = 'luckystack:dev-restart';

export interface DevRestartMessage {
  type: typeof DEV_RESTART_MESSAGE_TYPE;
  reason: string;
}

export const isDevRestartMessage = (value: unknown): value is DevRestartMessage =>
  typeof value === 'object'
  && value !== null
  && 'type' in value
  && value.type === DEV_RESTART_MESSAGE_TYPE
  && 'reason' in value
  && typeof value.reason === 'string';

/**
 * Ask the supervisor to restart this dev server. Returns false when nothing
 * can restart it (started without the supervisor, or no IPC channel), so the
 * caller can tell the developer to restart by hand.
 */
export const requestDevServerRestart = (reason: string): boolean => {
  if (process.env.LUCKYSTACK_CORE_SUPERVISED !== 'true') return false;
  if (typeof process.send !== 'function' || !process.connected) return false;

  const message: DevRestartMessage = { type: DEV_RESTART_MESSAGE_TYPE, reason };
  //? The callback keeps a failed send from surfacing as an unhandled 'error'.
  return process.send(message, undefined, undefined, (error: Error | null) => {
    if (error) console.log(`[HotReload] Could not ask the supervisor to restart: ${String(error)}`, 'red');
  });
};
