//? Dev-tools (devkit) initialization status.
//?
//? When `initDevTools()` -> `devkit.initializeAll()` throws, the server stays UP
//? on purpose — crashing would send the supervisor into a respawn loop, and a
//? deterministic init error would then crash-loop forever. But the dev route
//? registry (`devApis` / `devSyncs`) is left EMPTY, so without this slot every
//? `/api` and `/sync` request 404s with no hint as to WHY. That exact silence
//? once read as a per-route type-validation bug and cost an afternoon: a stale
//? broken process kept serving while "fresh" restarts hopped to another port.
//?
//? This module records the failure once, at boot, so BOTH the boot log
//? (`createServer.ts`) and the request handlers (`apiRoute.ts`) can state the
//? real cause + the fix (restart after fixing — hot reload never armed because
//? `setupWatchers()` runs only after a successful `initializeAll()`).

let devToolsInitError: Error | null = null;

export const markDevToolsInitFailed = (error: Error): void => {
  devToolsInitError = error;
};

export const getDevToolsInitError = (): Error | null => devToolsInitError;

//? Test-only / future-recovery reset. There is no runtime path that clears the
//? failure today (recovery is a restart), but tests must reset module state and
//? a future "re-init on watcher success" path would call this.
export const clearDevToolsInitError = (): void => {
  devToolsInitError = null;
};
