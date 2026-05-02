//? Client-side (browser-safe) surface of @luckystack/core.
//? Kept separate from `./index.ts` because the server barrel re-exports
//? Node-API modules (paths.ts, db.ts, redis.ts) that must never enter a
//? Vite client bundle.
//?
//? This file aggregates everything `@luckystack/sync/client` and project
//? client code may need so consumers can `import ... from '@luckystack/core/client'`
//? instead of reaching into specific source files via relative paths.

export { apiRequest } from './apiRequest';
export type { ApiStreamEvent } from './apiRequest';

export {
  getProjectConfig,
  registerProjectConfig,
  isProjectConfigRegistered,
} from './projectConfig';
export type {
  ProjectConfig,
  LoggingConfig,
  RateLimitingConfig,
  SessionConfig,
  SentryConfig,
  SentrySampleRates,
} from './projectConfig';

export { notify, registerNotifier, getNotifier } from './notifier';
export type { Notifier, NotifyInput, NotifyParam } from './notifier';

export {
  socket,
  setSocket,
  incrementResponseIndex,
  waitForSocket,
} from './socketState';

export {
  isOnline,
  enqueueApiRequest,
  enqueueSyncRequest,
  removeApiQueueItem,
  removeSyncQueueItem,
  removeApiQueueItemsByKey,
  flushApiQueue,
  flushSyncQueue,
  getApiQueueSize,
  getSyncQueueSize,
} from './offlineQueue';

export { normalizeErrorResponseCore } from './responseNormalizer';

export { parseServiceRouteName } from './serviceRoute';

export {
  buildApiResponseEventName,
  buildApiStreamEventName,
  buildSyncProgressEventName,
  buildSyncResponseEventName,
  socketEventNames,
} from './socketEvents';

export type { statusContent, SOCKETSTATUS } from './socketStatusTypes';

export type { ApiTypeMap, SyncTypeMap, StreamPayload } from './apiTypeStubs';

export type { BaseSessionLayout, SessionLocation, AuthProps } from './sessionTypes';
