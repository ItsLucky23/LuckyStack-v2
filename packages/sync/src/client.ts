// Client-side sync transport. Kept separate from `./index.ts` so the server
// tsconfig (no `jsx` setting) does not pull React-coupled code into its
// compilation.
export {
  syncRequest,
  useSyncEvents,
  useSyncEventTrigger,
  initSyncRequest,
  attachSyncReceiver,
} from './syncRequest';
export type { SyncRequestStreamEvent, SyncRouteStreamEvent } from './syncRequest';
//? Framework-owned error-code list, exported on the client too so a locale
//? parity test (or a UI switch over codes) can import it without the server barrel.
export { SYNC_ERROR_CODES } from './_shared/errorCodes';
export type { SyncErrorCode } from './_shared/errorCodes';
