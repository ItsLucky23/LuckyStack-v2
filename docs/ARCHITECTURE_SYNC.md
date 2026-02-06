# Sync Architecture

> Real-time event broadcasting between clients using rooms.

---

## Quick Reference

```typescript
// Client A sends sync event
await syncRequest({
  name: "updateCounter",
  data: { amount: 5 },
  roomCode: "game-room-123",
});

// Client B receives (via callback)
upsertSyncEventCallback("updateCounter", ({ clientOutput, serverOutput }) => {
  console.log("Counter updated:", serverOutput.newValue);
});
```

---

## File Structure

```
src/
├── {page}/_sync/
│   ├── {syncName}_server.ts    # Runs on the server just once
│   ├── {syncName}_client.ts    # Runs on the server for each client
│   └── ...
└── _sockets/
    ├── syncRequest.ts          # Client-side sync caller
    └── apiTypes.generated.ts   # Auto-generated types
```

---

## Creating a Sync Event

### 1. Server handler (optional)

```typescript
// src/examples/_sync/updateCounter_server.ts
import { AuthProps, SessionLayout } from "../../../config";
import {
  Functions,
  SyncServerResponse,
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

### 2. Client handler (optional)

```typescript
import { SessionLayout } from "../../../config";
import {
  Functions,
  SyncClientResponse,
  SyncClientInput,
  SyncServerOutput,
} from "../../../src/_sockets/apiTypes.generated";

// Types are imported from the generated file based on the _server.ts definition
type PagePath = "examples";
type SyncName = "test1";
export interface SyncParams {
  clientInput: SyncClientInput<PagePath, SyncName>;

  serverOutput: SyncServerOutput<PagePath, SyncName>;
  // Note: No serverOutput in client-only syncs (no _server.ts file)
  user: SessionLayout; // session data from any user that is in the room
  functions: Functions; // contains all functions that are available on the server in the functions folder
  roomCode: string; // room code
}

export const main = async ({
  user,
  clientInput,
  serverOutput,
  functions,
  roomCode,
}: SyncParams): Promise<SyncClientResponse> => {
  // CLIENT-ONLY SYNC: No server processing, runs for each client in the room

  // Example: Only allow users on set page to receive the event
  // if (user?.location?.pathName === '/your-page') {
  //   return { status: 'success' };
  // }

  return {
    status: "success",
    // Add any additional data to pass to the client
  };
};
```

## Receiving Sync Events

```typescript
import { upsertSyncEventCallback } from "src/_sockets/syncRequest";

// Register a callback (upsert = updates if exists)
upsertSyncEventCallback("updateCounter", ({ clientOutput, serverOutput }) => {
  // clientOutput = result from _client.ts
  // serverOutput = result from _server.ts
  updateUI(serverOutput.newValue);
});
```

---

### Room-specific sync

```typescript
// Only users in 'game-room-123' receive this
await syncRequest({
  name: "moveChessPiece",
  data: { from: "e2", to: "e4" },
  roomCode: "game-room-123",
});
```

---

---

## Type System

| Property       | Source                         | Description              |
| -------------- | ------------------------------ | ------------------------ |
| `clientInput`  | `data` param in syncRequest    | What client sends        |
| `serverOutput` | `_server.ts` return            | Server processing result |
| `clientOutput` | `_client.ts` clientMain return | Client processing result |
