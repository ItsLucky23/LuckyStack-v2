# Socket Architecture

> Socket.io-based real-time communication layer.

---

## Quick Reference

```typescript
// Client: Access socket instance
import { socket, waitForSocket } from "src/_sockets/socketInitializer";

await waitForSocket(); // Ensure connected
socket.emit("event", data);
```

---

## Core Events

| Event                 | Direction        | Purpose                      |
| --------------------- | ---------------- | ---------------------------- |
| `apiRequest`          | Client → Server  | RPC-style API calls          |
| `apiResponse-{index}` | Server → Client  | API response by index        |
| `sync`                | Client → Server  | Sync event to broadcast      |
| `syncEvent-{name}`    | Server → Clients | Broadcasted sync data        |
| `joinRoom`            | Client → Server  | Join a specific room         |
| `updateLocation`      | Client → Server  | Track user's current page    |
| `logout`              | Server → Client  | Force logout (other session) |

---

## Room System

```typescript
// Server-side: socket joins room
socket.join(roomCode);

// Server-side: broadcast to room
io.to(roomCode).emit("syncEvent-updateCounter", data);

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
