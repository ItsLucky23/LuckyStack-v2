# Socket Architecture

> Socket.io-based real-time communication layer.

---

## Quick Reference

```typescript
// Client: Access socket instance
import { socket, waitForSocket } from "src/_sockets/socketInitializer";
import { socketEventNames } from "shared/socketEvents";

await waitForSocket(); // Ensure connected
socket.emit(socketEventNames.sync, data);
```

Socket event names and dynamic response event builders are centralized in `shared/socketEvents.ts` and reused by both server and client runtime modules.

---

## Core Events

| Event                 | Direction        | Purpose                      |
| --------------------- | ---------------- | ---------------------------- |
| `apiRequest`          | Client → Server  | RPC-style API calls          |
| `apiResponse-{index}` | Server → Client  | API response by index        |
| `sync`                | Client → Server  | Sync event to broadcast      |
| `sync`                | Server → Clients | Broadcasted sync payloads    |
| `joinRoom`            | Client → Server  | Join a specific room         |
| `leaveRoom`           | Client → Server  | Leave a specific room        |
| `getJoinedRooms`      | Client → Server  | Get current room membership  |
| `updateLocation`      | Client → Server  | Track user's current page    |

---

## Room System

```typescript
// Server-side: socket joins room
socket.join(roomCode);

// Server-side: broadcast to room
io.to(roomCode).emit("sync", data);

// Client triggers room join
socket.emit("joinRoom", { roomCode: "game-123" });
```

Room codes are automatically extracted from URL paths:

- `/games/chess/room-abc` → room code = `room-abc`

---

## Connection State

```typescript
import { useSocketStatus } from 'src/_providers/socketStatusProvider';

function ConnectionIndicator() {
  const { connected, reconnecting } = useSocketStatus();

  if (!connected && reconnecting) return <Spinner />;
  if (!connected) return <Offline />;
  return <Online />;
}
```

---

## Activity Broadcasting

When `config.socketActivityBroadcaster = true`:

```typescript
// Other users in same room can see status
const { socketStatus } = useSocketStatus();
// socketStatus['user-id'] = { status: 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING' }
```

---

## Configuration

```typescript
// config.ts
const config = {
  backendUrl: 'http://localhost:80',
  socketActivityBroadcaster: false,  // Enable presence tracking
  locationProviderEnabled: true,     // Enable route-to-session location syncing
};

// .env
SERVER_IP=127.0.0.1
SERVER_PORT=80
```

---

## Error Handling

```typescript
socket.on("connect_error", (error) => {
  console.error("Connection failed:", error);
});

socket.on("disconnect", (reason) => {
  if (reason === "io server disconnect") {
    // Server forced disconnect - try reconnect
    socket.connect();
  }
});
```

---

## Multi-Instance / Cross-Server Broadcasting

When you run more than one backend instance behind a load balancer (including the built-in `@luckystack/router`), a room broadcast fired from instance A must still reach clients connected to instance B. Socket.io solves this with an adapter.

LuckyStack attaches `@socket.io/redis-adapter` automatically on every backend via `attachSocketRedisAdapter(io)` in `server/sockets/socket.ts`. The adapter:

- Reuses the `redis` handle from `@luckystack/core` (no extra config).
- Creates two `redis.duplicate()` connections — one for publish, one for subscribe. A subscribe-mode Redis connection cannot issue other commands, so duplicating is required.
- Works identically in single-instance deploys (the pub/sub channel has no peers) and in multi-instance deploys (all backends sharing the same Redis exchange room events).

Without this adapter, `io.to(roomCode).emit('sync', ...)` only reaches sockets connected to the same process — a silent failure mode when scaling horizontally. It's on by default; do not remove it.

The router's WebSocket proxy routes socket.io upgrades to the `system` service by convention. Because the adapter fans broadcasts out across instances, a client doesn't need to be on the "right" service's socket.io — any instance sharing the Redis will receive and re-emit room events.

---

## Runtime Function Reference

| File | Function | Purpose |
| ---- | -------- | ------- |
| `shared/socketEvents.ts` | `socketEventNames` + builders | Canonical socket event names and indexed response/progress event helpers shared across client/server. |
| `server/sockets/socket.ts` | `loadSocket` | Initializes Socket.io server, registers all socket event handlers. |
| `packages/core/src/socketRedisAdapter.ts` | `attachSocketRedisAdapter` | Wires `@socket.io/redis-adapter` onto the Socket.io server so room fanout works across instances. |
| `src/_sockets/socketInitializer.ts` | `useSocket` | Initializes client socket, listeners, queue flushing, visibility reconnection behavior. |
| `src/_sockets/socketInitializer.ts` | `joinRoom` / `leaveRoom` / `getJoinedRooms` | Client room management helpers. |
| `server/sockets/handleApiRequest.ts` | `default export` | Handles incoming `apiRequest` socket messages. |
| `server/sockets/handleSyncRequest.ts` | `default export` | Handles incoming `sync` socket messages and room fanout. |
| `packages/router/src/wsProxy.ts` | `createWsProxy` | Router-side WebSocket upgrade forwarder. Routes `/socket.io/` upgrades to the `system` service's backend. |
