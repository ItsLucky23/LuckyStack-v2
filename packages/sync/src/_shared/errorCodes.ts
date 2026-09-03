//? The canonical, exported list of every `sync.*` error code the framework can
//? emit — from `syncRequest` before the wire, from both transport handlers, from
//? the per-recipient `_client` stage, and from `@luckystack/server`'s HTTP sync
//? route (multi-instance handoff, DEV-376).
//?
//? Why a runtime export and not just a doc table: `translate()` returns the KEY
//? itself when a locale lacks it, so a consumer whose locale files were typed
//? from `docs/error-states.md` shows users a literal `sync.notRoomMember` the
//? day this list grows. The list is framework-owned; the consumer cannot know
//? when it changes. With this export a consumer writes ONE parity test
//? (`for code of SYNC_ERROR_CODES: expect(locale.sync[code.slice(5)]).toBeDefined()`)
//? instead of retyping a table. `errorCodes.test.ts` keeps this list equal to
//? the literals in the source AND keeps the scaffold's four locale files in
//? parity with it, so the export cannot drift from either side.
//?
//? Deliberately NOT in the list: `sync.ignore` — the client-side sentinel a
//? `_client` handler returns to suppress delivery; it is never shown to anyone.

export const SYNC_ERROR_CODES = [
  //? `syncRequest` (client-side, before the message hits the wire)
  'sync.invalidName',
  'sync.invalidVersion',
  'sync.missingReceiver',
  'sync.ioUnavailable',
  'sync.failedRequest',
  'sync.invalidServerResponse',
  'sync.invalidRequestFormat',
  'sync.requestTimeout',
  //? `handleSyncRequest` / `handleHttpSyncRequest` (both transports)
  'sync.invalidRequest',
  'sync.invalidCallback',
  'sync.notFound',
  'sync.rateLimitExceeded',
  'sync.invalidInputType',
  'sync.serverExecutionFailed',
  'sync.receiverNotAllowed',
  'sync.notRoomMember',
  'sync.noReceiversFound',
  //? per-recipient `_client` stage (both transports)
  'sync.clientExecutionFailed',
  'sync.invalidClientResponse',
  'sync.clientRejected',
  //? `@luckystack/server` HTTP sync route (before the handler is reached)
  'sync.disabled',
  'sync.methodNotAllowed',
  'sync.devToolsUnavailable',
] as const;

/** Union of every framework-emitted `sync.*` error code. */
export type SyncErrorCode = (typeof SYNC_ERROR_CODES)[number];
