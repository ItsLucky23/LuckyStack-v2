# Sync Architecture

> Real-time event broadcasting between clients using rooms.

---

## Quick Reference

```typescript
// Client A sends sync event
await syncRequest({ 
  name: 'updateCounter', 
  data: { amount: 5 } 
});

// Client B receives (via callback)
upsertSyncEventCallback('updateCounter', ({ clientOutput, serverOutput }) => {
  console.log('Counter updated:', serverOutput.newValue);
});
```

---

## File Structure

```
src/
├── {page}/_sync/
│   ├── {syncName}_client.ts    # Client-side handler (runs on sender)
│   ├── {syncName}_server.ts    # Server-side handler (runs on server)
│   └── ...
└── _sockets/
    ├── syncRequest.ts          # Client-side sync caller
    └── apiTypes.generated.ts   # Auto-generated types
```

---

## Creating a Sync Event

### 1. Server handler (required)

```typescript
// src/examples/_sync/updateCounter_server.ts
import { AuthProps, SessionLayout } from 'config';
import { Functions } from 'src/_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: true,
  additional: []
};

export const main = async ({ 
  data, 
  user 
}: { 
  data: { amount: number }; 
  user: SessionLayout;
}) => {
  // Process and return data to broadcast
  return {
    newValue: data.amount,
    updatedBy: user.id
  };
};
```

### 2. Client handler (optional)

```typescript
// src/examples/_sync/updateCounter_client.ts
import { ServerSyncProps, ClientSyncProps } from 'config';

// Server-side processing (runs before broadcast)
export const main = ({ input, user }: ServerSyncProps) => {
  return {
    processedAmount: input.amount * 2
  };
};

// Client-side processing (runs on receiving clients)
export const clientMain = ({ clientOutput, serverOutput, user }: ClientSyncProps) => {
  console.log('Received:', serverOutput);
  return serverOutput;  // Final data passed to callback
};
```

---

## Sending Sync Events

```typescript
import { syncRequest } from 'src/_sockets/syncRequest';

// Send to everyone in the same room
await syncRequest({
  name: 'updateCounter',
  data: { amount: 5 }
});

// Send to specific room
await syncRequest({
  name: 'updateCounter',
  data: { amount: 5 },
  roomCode: 'game-room-123'
});
```

---

## Receiving Sync Events

```typescript
import { upsertSyncEventCallback } from 'src/_sockets/syncRequest';

// Register a callback (upsert = updates if exists)
upsertSyncEventCallback('updateCounter', ({ clientOutput, serverOutput }) => {
  // clientOutput = result from _client.ts clientMain
  // serverOutput = result from _server.ts main
  updateUI(serverOutput.newValue);
});

// Remove callback when done
removeSyncEventCallback('updateCounter');
```

---

## Room System

Users are automatically assigned to rooms based on the page URL.

```typescript
// Automatically: /games/chess/room-123 → room code = "room-123"

// Manual join:
socket.emit('joinRoom', { roomCode: 'custom-room' });
```

### Room-specific sync

```typescript
// Only users in 'game-room-123' receive this
await syncRequest({
  name: 'moveChessPiece',
  data: { from: 'e2', to: 'e4' },
  roomCode: 'game-room-123'
});
```

---

## Data Flow

```
Client A                Server                  Client B
   │                       │                       │
   │──syncRequest()───────→│                       │
   │                       │──run _server.ts──────→│
   │                       │                       │
   │                       │←─serverOutput─────────│
   │                       │                       │
   │←──broadcast to room───│───broadcast to room──→│
   │                       │                       │
   │──run _client.ts──────→│                       │
   │                       │                       │
   │──callback fired──────→│                       │
```

---

## Type System

| Property | Source | Description |
|----------|--------|-------------|
| `input` | `data` param in syncRequest | What client sends |
| `serverOutput` | `_server.ts` return | Server processing result |
| `clientOutput` | `_client.ts` clientMain return | Client processing result |
