// Server-side sync handlers only. Client-side transport lives in
// `./client.ts` — the server tsconfig does not set `jsx` so we keep
// React-coupled code out of this barrel to avoid pulling it into server
// compilation via transitive imports.
export { default as handleSyncRequest } from './handleSyncRequest';
export { default as handleHttpSyncRequest } from './handleHttpSyncRequest';
export type { HttpSyncStreamEvent } from './handleHttpSyncRequest';

// Streaming utilities — usable from any sync `_server` handler regardless
// of whether you reach for `stream`, `broadcastStream`, or `streamTo`.
export { createStreamThrottle } from './streamThrottle';
export type {
  StreamThrottle,
  CreateStreamThrottleOptions,
} from './streamThrottle';
