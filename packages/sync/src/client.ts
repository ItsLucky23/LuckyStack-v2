// Client-side sync transport. Kept separate from `./index.ts` so the server
// tsconfig (no `jsx` setting) does not pull React-coupled code into its
// compilation.
export {
  syncRequest,
  useSyncEvents,
  useSyncEventTrigger,
  initSyncRequest,
} from './syncRequest';
export type { SyncRequestStreamEvent, SyncRouteStreamEvent } from './syncRequest';
