# Sync Architecture

> Real-time event broadcasting between clients using rooms.

---

## Quick Reference

```typescript
// Client A sends sync event
const response = await syncRequest({
  name: "examples/updateCounter",
  version: "v1",
  data: { amount: 5 },
  receiver: "game-room-123",
  onStream: (stream) => {
    // Requester progress emitted from _server.ts
    console.log(stream);
  },
});

if (response.status === "error") {
  console.error(response.errorCode, response.message);
}

// Client B receives (via callback)
const { upsertSyncEventCallback } = useSyncEvents();
upsertSyncEventCallback({
  name: "examples/updateCounter",
  version: "v1",
  callback: ({ clientOutput, serverOutput }) => {
    console.log("Counter updated:", serverOutput.newValue);
  },
});

// Nested page sync
await syncRequest({
  name: "test/nestedTest/room",
  version: "v1",
  data: { step: 1, active: true },
  receiver: "game-room-123",
});
```

---

## File Structure

```
src/
├── {page}/_sync/
│   ├── {syncName}_server_v1.ts    # Optional: runs once on server
│   ├── {syncName}_client_v1.ts    # Optional: runs once per target client
│   └── ...
Versioned naming is required when a file exists:

- `{syncName}_server_v1.ts`
- `{syncName}_client_v1.ts`

At least one of these files must exist for a sync route.

└── _sockets/
    ├── syncRequest.ts          # Client-side sync caller
    └── apiTypes.generated.ts   # Auto-generated types
```

---

## Creating a Sync Event

### 1. Server handler (optional)

```typescript
// src/examples/_sync/updateCounter_server_v1.ts
import { AuthProps, SessionLayout } from "../../../config";
import {
  Functions,
  SyncServerResponse,
  SyncServerStreamEmitter,
} from "../../../src/_sockets/apiTypes.generated";

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface SyncParams {
  clientInput: {
    // Define the data shape sent from the client e.g.
    amount: number;
  };
  user: SessionLayout; // session data of the user who called the sync event
  functions: Functions; // functions object
  roomCode: string; // room code
  stream: SyncServerStreamEmitter;
}

export const main = async ({
  clientInput,
  user,
  functions,
  roomCode,
}: SyncParams): Promise<SyncServerResponse> => {
  // THIS FILE RUNS JUST ONCE ON THE SERVER

  // Please validate clientInput here and dont just send the data back to the other clients
  // optional: database action or something else

  return {
    status: "success",
    newValue: clientInput.amount + 1,
    // Add any data you want to broadcast to clients
  };
};
```

### 2. Client handler (optional, only when needed)

```typescript
import {
  Functions,
  SyncClientResponse,
  SyncClientInput,
  SyncServerOutput,
  SyncClientStreamEmitter,
} from "../../../src/_sockets/apiTypes.generated";

// Types are imported from the generated file based on the _server.ts definition
type PagePath = "examples";
type SyncName = "updateCounter";
export interface SyncParams {
  clientInput: SyncClientInput<PagePath, SyncName>;

  serverOutput: SyncServerOutput<PagePath, SyncName>;
  // Note: No serverOutput in client-only syncs (no _server.ts file)
  token: string | null; // target client token (fetch session only when needed)
  functions: Functions; // contains functions available from server/functions
  roomCode: string; // room code
  stream: SyncClientStreamEmitter;
}

export const main = async ({
  token,
  clientInput,
  serverOutput,
  functions,
  roomCode,
}: SyncParams): Promise<SyncClientResponse> => {
  // CLIENT FILTER/RULE STAGE: runs on server for each target client in the room
  const targetUser = token ? await functions.session.getSession(token) : null;

  // Example: Only allow users on set page to receive the event
  // if (targetUser?.location?.pathName === '/your-page') {
  //   return { status: 'success' };
  // }

  return {
    status: "success",
    // Add any additional data to pass to the client
  };
};
```

If your `_client.ts` only returns `{ status: 'success' }` and does no filtering or payload changes, remove the file. Keeping a no-op client sync file adds unnecessary per-client execution overhead.

Client sync handlers no longer receive `user` automatically. This avoids a Redis session lookup for every target socket. When you need target session data, call `functions.session.getSession(token)` inside `_client.ts`.

## Client File Decision Rule (AI + Performance)

Default behavior: create only `_server.ts`.

Create `_client.ts` only if you need one of these:

- Per-target-client filtering (for example skip users not on a specific page)
- Per-target-client authorization or rejection
- Per-target-client output transformation (custom `clientOutput`)

Do not create `_client.ts` for pass-through syncs. Without `_client.ts`, the framework still broadcasts successfully with `serverOutput` and an empty `clientOutput`.

## Receiving Sync Events

```typescript
import { useSyncEvents } from "src/_sockets/syncRequest";

const { upsertSyncEventCallback } = useSyncEvents();

useEffect(() => {
  return upsertSyncEventCallback({
    name: "examples/updateCounter",
    version: "v1",
    callback: ({ clientOutput, serverOutput }) => {
      // clientOutput = result from _client.ts
      // serverOutput = result from _server.ts
      updateUI(serverOutput.newValue);
    },
  });
}, [upsertSyncEventCallback]);

// Register callback for a nested page sync
upsertSyncEventCallback({
  name: "test/nestedTest/room",
  version: "v1",
  callback: ({ serverOutput }) => {
    updateUI(serverOutput.step);
  },
});
```

## Sync Error Contract

- When returning an error from `_server.ts` or `_client.ts`, `errorCode` must be a stable i18n key.
- Do not return human text in `errorCode`.
- Use `errorParams` for dynamic context.
- Optional `message` or `errorMessage` values may be useful for debugging, but UI notifications should rely on translated `errorCode` keys.

Good:

```typescript
return {
  status: 'error',
  errorCode: 'sync.invalidRequest',
};
```

Bad:

```typescript
return {
  status: 'error',
  errorCode: 'Missing date value or invalid date',
};
```

Stream events for recipients can be registered with the same hook:

```typescript
const { upsertSyncEventStreamCallback } = useSyncEvents();

useEffect(() => {
  return upsertSyncEventStreamCallback({
    name: "examples/updateCounter",
    version: "v1",
    callback: ({ stream }) => {
      // stream is emitted by _client.ts via stream(...)
      console.log(stream);
    },
  });
}, [upsertSyncEventStreamCallback]);
```

## Streaming

Sync streaming has two channels:

- `_server.ts` stream calls go back to the request initiator via `syncRequest({ onStream })`.
- `_client.ts` stream calls go to each target socket and can be handled with `upsertSyncEventStreamCallback`.

Both channels are strict-typed by generated maps:

- `_server.ts` emitted payloads generate `serverStream` route types.
- `_client.ts` emitted payloads generate `clientStream` route types.
- `syncRequest({ onStream })` and `upsertSyncEventStreamCallback` use those exact generated payload unions.
- Stream callbacks receive the payload you emit in `stream(...)`; stream payloads do not have framework-enforced keys.

If no `stream(...)` call exists yet for a stage, that stage falls back to `never`.

This means:
- `syncRequest({ onStream })` is only available for routes that emit from `_server.ts`.
- `upsertSyncEventStreamCallback` is only available for routes that emit from `_client.ts`.

Example server progress:

```typescript
export const main = async ({ stream }: SyncParams): Promise<SyncServerResponse> => {
  stream({ phase: "validate", progress: 10 });
  // long operation ...
  stream({ phase: "persist", progress: 70 });
  // long operation ...

  return { status: "success", updated: true };
};
```

Example client-stage progress for each receiver:

```typescript
export const main = async ({ stream }: SyncParams): Promise<SyncClientResponse> => {
  stream({ phase: "prepare", progress: 20 });
  // receiver-specific work ...
  stream({ phase: "ready", progress: 100, done: true });

  return { status: "success" };
};
```

Repository note:

- The previous `/streaming` demo page and demo sync handlers were intentionally removed from source.
- Use `docs/STREAMING_RECONSTRUCTION.md` to recreate that exact demo implementation when needed.

## Offline Request Queue

When the socket is disconnected or the browser is offline, `syncRequest` queues requests in memory and flushes on reconnect or when the browser comes back online.

## syncRequest Return Contract

`syncRequest` resolves to a typed response object:

- Success: `{ status: 'success', message: string, result: serverOutput }`
- Error: `{ status: 'error', message: string, errorCode: string, errorParams?, httpStatus? }`

`result` is typed from the generated sync map for the selected route/version.

This allows the caller to handle validation/network/runtime errors consistently with API-style error contracts while keeping sync delivery asynchronous.

---

### Room-specific sync

```typescript
// Only users in 'game-room-123' receive this
await syncRequest({
  name: "chess/moveChessPiece",
  version: "v1",
  data: { from: "e2", to: "e4" },
  receiver: "game-room-123",
});
```

## HTTP Sync Endpoint

Sync can be triggered through HTTP:

- `POST /sync/{page}/{syncName}/{version}`

Body:

```json
{
  "data": { "some": "payload" },
  "receiver": "room-code",
  "ignoreSelf": false
}
```

Note: HTTP is only the trigger. Actual delivery still happens via Socket.io to users in the target room.

HTTP requester streaming is available via SSE:

- Add `Accept: text/event-stream` header, or
- Add `?stream=true` query parameter

SSE events:

- `event: stream` for `_server.ts` progress payloads
- `event: final` for final HTTP sync response

Example:

```typescript
const response = await fetch("/sync/examples/updateCounter/v1?stream=true", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  },
  body: JSON.stringify({
    data: { amount: 1 },
    receiver: "game-room-123",
    ignoreSelf: false,
  }),
});

// Parse SSE chunks from response.body
```

HTTP sync requests are rate-limited using global `config.rateLimiting` settings:

```typescript
rateLimiting: {
  defaultApiLimit: 60, // fallback per-sync-route limit
  defaultIpLimit: 100, // global per-IP cap across all sync routes
  windowMs: 60000,
}
```

When exceeded, handlers return `sync.rateLimitExceeded` with `seconds` in `errorParams`.

---

---

## Type System

| Property       | Source                         | Description              |
| -------------- | ------------------------------ | ------------------------ |
| `clientInput`  | `data` param in syncRequest    | What client sends        |
| `serverOutput` | `_server.ts` return            | Server processing result |
| `clientOutput` | `_client.ts` clientMain return | Client processing result (or `{}` when no `_client.ts`) |

Generated sync output typing preserves direct literal return values in object properties (for example `allowed: true` vs `allowed: false`) so TypeScript can narrow branch-specific shapes safely.

### Error Contract

- Sync errors should return `status: 'error'` with an `errorCode` (and optional `errorParams` / `httpStatus`).
- Server resolves the final `message` through i18n using `errorCode` + `errorParams`.
- Avoid hardcoded human-readable error messages in server sync handlers.

---

## Type Generation Pipeline (Timing-Aware)

In development, sync typing updates follow this sequence:

1. File save
2. Template injection (if applicable, only for new empty files in `_sync/`)
3. Hot reload trigger
4. Type-map regeneration
5. Typed helpers become accurate (`syncRequest`, callback payload inference for `serverOutput`/`clientOutput`)

Regeneration is asynchronous. After a save, there can be a short lag (typically hundreds of milliseconds) before generated helper types fully reflect the latest sync file state.

Generation is strict: unresolved sync type symbols now fail type-map generation instead of falling back to `any` aliases in generated artifacts.

For stable AI and CI inference, keep sync calls on the canonical typed helper signature and avoid local `any` wrappers or alternate loose signatures around `syncRequest` and callback payloads.

Do not add `unsafe*` wrapper aliases around `syncRequest` or `upsertSyncEventCallback`. If runtime-dynamic tooling code needs localized assertions, keep them at the call site and do not hide helper signatures behind wrapper types.

## Timing-Aware AI Workflow

Use a trust-first workflow for sync edits:

1. First pass: implement using the intended typed sync contract and trust server/client payload shapes.
2. Wait/re-check pass: after generation settles, re-open generated types and remove temporary casts/narrowing if no longer needed.

This avoids premature unsafe rewrites while the generator is still catching up.

Temporary exception note:

- If a short generator-lag window forces a cast, keep it local and minimal, then remove it once types refresh.

Good vs bad examples:

```typescript
// Bad: local wrapper erases sync route typing and callback payload inference
const onSyncLoose = (name: string, cb: (payload: any) => void) =>
  upsertSyncEventCallback({ name: name as any, version: "v1" as any, callback: cb as any });

// Good: direct typed callback payload usage
upsertSyncEventCallback({
  name: "examples/updateCounter",
  version: "v1",
  callback: ({ serverOutput, clientOutput }) => {
    console.log(serverOutput, clientOutput);
  },
});
```

AI self-check before finalizing changes:

- Did I rely on generated route/version types?
- Did I avoid adding new unsafe wrappers?
- If I used a temporary cast during generation lag, did I re-check and remove it after types refreshed?

---

## Runtime Function Reference

| File | Function | Purpose |
| ---- | -------- | ------- |
| `server/sockets/handleSyncRequest.ts` | `default export` | Handles socket sync requests (`sync` event), auth checks, executes `_server/_client`, emits responses. |
| `server/sockets/handleHttpSyncRequest.ts` | `default export` | HTTP-triggered sync entrypoint (`POST /sync/...`) that still delivers via Socket.io. |
| `server/utils/runtimeTypeValidation.ts` | `validateInputByType` | Validates sync `clientInput` payloads against extracted runtime types and returns path-first diagnostics. |
| `server/utils/runtimeTypeResolver.ts` | `resolveRuntimeTypeText` | Resolves local/imported/re-exported input type aliases and supported utility wrappers before sync validation. |
| `server/sockets/socket.ts` | `socket.on('sync', ...)` | Wires incoming sync events to the sync handler. |
| `src/_sockets/syncRequest.ts` | `syncRequest` | Typed client sender for sync events. |
| `src/_sockets/syncRequest.ts` | `useSyncEvents().upsertSyncEventCallback` | Typed callback registry for incoming sync events. |
| `src/_sockets/syncRequest.ts` | `useSyncEvents().upsertSyncEventStreamCallback` | Callback registry for route-level stream updates emitted during sync execution. |
