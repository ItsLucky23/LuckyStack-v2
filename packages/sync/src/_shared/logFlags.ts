//? Logging-flag accessors shared across the SERVER-side sync transports
//? (`handleSyncRequest`, `handleHttpSyncRequest`) + `streamEmitters` (CC-5).
//? Each reads the live `getProjectConfig().logging.*` at call time — never
//? cached — so a config swap (tests, hot-reload) is picked up immediately.
//? Previously `shouldLogDev` / `shouldLogStream` were redefined in both
//? handlers and `streamEmitters.ts`.
//?
//? NOTE: imports from the server `@luckystack/core` barrel, so this module is
//? server-only. The client `syncRequest.ts` keeps its own flag lambdas
//? (it imports from the browser-safe `@luckystack/core/client` subpath and
//? must not pull the server barrel into the Vite client bundle).

import { getProjectConfig } from '@luckystack/core';

export const shouldLogDev = (): boolean => getProjectConfig().logging.devLogs;
export const shouldLogStream = (): boolean => getProjectConfig().logging.stream;
