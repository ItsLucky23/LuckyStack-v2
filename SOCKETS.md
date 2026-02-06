# LuckyStack Socket System

This guide provides an in-depth look at LuckyStack's real-time communication system, including room management, sync events, and multiplayer awareness features.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core Concepts](#core-concepts)
3. [API Requests](#api-requests)
4. [Sync Events](#sync-events)
5. [Room System](#room-system)
6. [Activity Broadcaster (Multiplayer Awareness)](#activity-broadcaster)
7. [Socket Status Provider](#socket-status-provider)
8. [Best Practices](#best-practices)
9. [Examples](#examples)

---

## Architecture Overview

LuckyStack uses Socket.io for all client-server communication, including traditional API calls. This provides:

- **Unified transport** - All communication goes through WebSockets
- **Real-time sync** - Broadcast changes to other clients instantly
- **Session management** - Automatic session tracking per socket
- **Activity awareness** - Track user presence, AFK status, and reconnections

```
┌─────────────────┐         ┌─────────────────┐
│     Client      │◄───────►│     Server      │
│                 │   WS    │                 │
│  ┌───────────┐  │         │  ┌───────────┐  │
│  │apiRequest │──┼────────►│──│handleApi  │  │
│  └───────────┘  │         │  └───────────┘  │
│                 │         │                 │
│  ┌───────────┐  │         │  ┌───────────┐  │
│  │syncRequest│──┼────────►│──│handleSync │──┼──► Other Clients
│  └───────────┘  │         │  └───────────┘  │
│                 │         │                 │
│  ┌───────────┐  │         │  ┌───────────┐  │
│  │ joinRoom  │──┼────────►│──│  Rooms    │  │
│  └───────────┘  │         │  └───────────┘  │
└─────────────────┘         └─────────────────┘
```

---

## Core Concepts

### Socket Events

| Event | Direction | Purpose |
|-------|-----------|---------|
| `apiRequest` | Client → Server | RPC-style API calls |
| `apiResponse-{id}` | Server → Client | API call response |
| `sync` | Client ↔ Server | Real-time sync events |
| `joinRoom` | Client → Server | Join a room for sync |
| `updateLocation` | Client → Server | Track user's current page |
| `userAfk` | Server → Client | Notify when user goes AFK |
| `userBack` | Server → Client | Notify when user returns |
| `logout` | Server → Client | Force client logout |

### Response Index System

Every request includes a `responseIndex` to match responses:

```typescript
// Client sends
socket.emit('apiRequest', { 
  name: 'api/test/getData', 
  data: {}, 
  responseIndex: 42 
});

// Server responds
socket.emit('apiResponse-42', { 
  status: 'success', 
  result: { ... } 
});
```

---

## API Requests

API requests are for **server-only operations** like database queries, file uploads, or external API calls.

### Client Usage

```typescript
import { apiRequest } from 'src/_sockets/apiRequest';

// Make an API call
const result = await apiRequest({ 
  name: 'getUserData',  // Mapped to api/{currentPath}/getUserData
  data: { userId: '123' }
});

if (result.status === 'error') {
  console.error(result.message);
} else {
  console.log(result); // Your data
}
```

### Creating an API Endpoint

Create a file in `src/{page}/_api/{name}.ts`:

```typescript
// src/settings/_api/updateProfile.ts
import type { AuthProps, SessionLayout } from 'config';

// Optional: Require authentication
export const auth: AuthProps = {
  login: true,  // User must be logged in
  additional: [
    // { key: 'admin', value: true }  // Optional: require admin
  ]
};

// Main handler
export const main = async ({ 
  data, 
  user, 
  functions 
}: {
  data: { name: string; email: string };
  user: SessionLayout;
  functions: any;
}) => {
  const { prisma, saveSession } = functions;
  
  // Update database
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { name: data.name, email: data.email }
  });
  
  // Update session
  await saveSession(user.token, { ...user, name: data.name });
  
  return { 
    message: 'Profile updated',
    user: updated 
  };
};
```

### Built-in API Names

These names are reserved and handled specially:

| Name | Purpose |
|------|---------|
| `session` | Returns the current user's session data |
| `logout` | Logs out the current user |

---

## Sync Events

Sync events are for **real-time communication between clients**. They can optionally run server-side validation before broadcasting.

### Flow

```
Client A                    Server                     Client B
    │                          │                          │
    │ syncRequest({            │                          │
    │   name: 'updateCanvas',  │                          │
    │   receiver: 'room123'    │                          │
    │ })                       │                          │
    │─────────────────────────►│                          │
    │                          │ Run _server.ts (if exists)
    │                          │─────────────────────────►│
    │                          │ Run _client.ts           │
    │                          │          sync event ─────►
    │◄─────────────────────────│                          │
    │       confirmation       │                          │
```

### Client Usage

```typescript
import { syncRequest, useSyncEvents } from 'src/_sockets/syncRequest';

// Register a sync event handler (call once on mount)
const { upsertSyncEventCallback } = useSyncEvents();

useEffect(() => {
  upsertSyncEventCallback('cursorMove', ({ clientData, serverOutput }) => {
    // Handle incoming sync from other clients
    console.log('User moved cursor:', clientData);
  });
}, []);

// Send a sync event to other clients in the room
await syncRequest({
  name: 'cursorMove',
  data: { x: 100, y: 200 },
  receiver: 'room123',  // Room code
  ignoreSelf: true      // Don't receive your own event
});
```

### Creating Sync Handlers

Sync events use up to 2 files:

#### Server-side Validation (Optional)
`src/{page}/_sync/{name}_server.ts`:

```typescript
// src/sandbox/_sync/updateDrawing_server.ts
import type { AuthProps, ServerSyncProps } from 'config';

export const auth: AuthProps = {
  login: true
};

export const main = async ({ 
  clientData, 
  user, 
  functions,
  roomCode 
}: ServerSyncProps & { roomCode: string }) => {
  // Validate the data
  if (!clientData.strokes || clientData.strokes.length > 1000) {
    return { status: 'error', message: 'Invalid stroke data' };
  }
  
  // Optionally save to database
  // await functions.prisma.drawing.update(...)
  
  // Return server data (will be sent to all clients)
  return { 
    status: 'success',
    timestamp: Date.now(),
    authorId: user.id
  };
};
```

#### Client-side Handler (Required)
`src/{page}/_sync/{name}_client.ts`:

```typescript
// src/sandbox/_sync/updateDrawing_client.ts
import type { ClientSyncProps } from 'config';

export const main = async ({ 
  clientData, 
  serverOutput, 
  user 
}: ClientSyncProps) => {
  // Filter who should receive this event
  // Return error to skip this client
  if (clientData.authorId === user.id) {
    return { status: 'error' }; // Skip sender
  }
  
  return { 
    status: 'success',
    // This data is passed to the callback
    strokes: clientData.strokes,
    author: serverOutput.authorId
  };
};
```

---

## Room System

Rooms group sockets together for targeted sync events. Users in the same room can sync with each other.

### Joining a Room

```typescript
import { joinRoom } from 'src/_sockets/socketInitializer';

// Join a room (typically on page load)
await joinRoom('game-abc123');

// Now sync events with receiver: 'game-abc123' will reach you
```

### Room Codes

Room codes can be anything - typically:
- Game/session IDs: `game-abc123`
- Document IDs: `doc-xyz789`
- User-generated codes: `my-room`

### Special Receiver Values

| Receiver | Effect |
|----------|--------|
| `'all'` | Broadcast to ALL connected sockets (use sparingly!) |
| `roomCode` | Broadcast to sockets in that room |

---

## Activity Broadcaster

The Activity Broadcaster provides **multiplayer awareness** - knowing when users are AFK, disconnected, or have returned.

> **Enable in config.ts:**
> ```typescript
> const config = {
>   socketActivityBroadcaster: true,  // Enable this feature
>   // ...
> };
> ```

### How It Works

1. **Tab Switch Detection** - When a user switches tabs, an `intentionalDisconnect` event fires
2. **AFK Broadcasting** - Other users in the same room receive `userAfk` with a countdown
3. **Return Detection** - When user returns, `userBack` is broadcast to room peers
4. **Disconnect Handling** - Graceful handling with configurable timeouts

### Disconnect Timeouts

```typescript
// In activityBroadcaster.ts
const getDisconnectTime = ({ token, reason }) => {
  // User switched tabs intentionally
  if (clientSwitchedTab.has(token)) return 20000;  // 20 seconds
  
  // Connection issues (network problems)
  if (['transport close', 'transport error'].includes(reason)) {
    return 60000;  // 60 seconds to reconnect
  }
  
  // Other disconnects
  return 2000;  // 2 seconds
};
```

### Client-side Status Tracking

```typescript
import { useSocketStatus } from 'src/_providers/socketStatusProvider';

function MultiplayerLobby() {
  const { socketStatus } = useSocketStatus();
  
  return (
    <div>
      {/* Your own status */}
      <p>My status: {socketStatus.self.status}</p>
      
      {/* Other users */}
      {Object.entries(socketStatus).map(([userId, status]) => {
        if (userId === 'self') return null;
        
        return (
          <div key={userId}>
            User {userId}: {status.status}
            {status.status === 'DISCONNECTED' && status.endTime && (
              <span>Returns in: {Math.round((status.endTime - Date.now()) / 1000)}s</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

### Status Values

```typescript
type statusContent = {
  status: 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING';
  reconnectAttempt?: number;
  endTime?: number;  // Timestamp when user might return
};
```

---

## Socket Status Provider

The `SocketStatusProvider` wraps your app and provides connection state.

### Context Structure

```typescript
const { socketStatus, setSocketStatus } = useSocketStatus();

// socketStatus structure:
{
  self: {
    status: 'CONNECTED',
    reconnectAttempt: undefined,
    endTime: undefined
  },
  'user-id-123': {
    status: 'DISCONNECTED',
    endTime: 1705695600000
  }
}
```

### Usage in Components

```typescript
import { useSocketStatus } from 'src/_providers/socketStatusProvider';

function ConnectionIndicator() {
  const { socketStatus } = useSocketStatus();
  
  const isConnected = socketStatus.self.status === 'CONNECTED';
  
  return (
    <div className={isConnected ? 'bg-green-500' : 'bg-red-500'}>
      {isConnected ? '🟢 Online' : '🔴 Offline'}
      {socketStatus.self.status === 'RECONNECTING' && (
        <span>Attempt #{socketStatus.self.reconnectAttempt}</span>
      )}
    </div>
  );
}
```

---

## Best Practices

### 1. Always Validate on Server

```typescript
// _server.ts
export const main = async ({ clientData, user }) => {
  // Validate data shape
  if (!clientData.action || typeof clientData.action !== 'string') {
    return { status: 'error', message: 'Invalid action' };
  }
  
  // Validate permissions
  if (clientData.action === 'delete' && !user.admin) {
    return { status: 'error', message: 'Not authorized' };
  }
  
  return { status: 'success' };
};
```

### 2. Use ignoreSelf for Updates

```typescript
// Don't send your own updates back to yourself
await syncRequest({
  name: 'updatePosition',
  data: { x, y },
  receiver: roomCode,
  ignoreSelf: true  // Important!
});
```

### 3. Handle Disconnections Gracefully

```typescript
// Show AFK users differently
function UserAvatar({ userId }) {
  const { socketStatus } = useSocketStatus();
  const isAfk = socketStatus[userId]?.status === 'DISCONNECTED';
  
  return (
    <div className={isAfk ? 'opacity-50' : 'opacity-100'}>
      <Avatar userId={userId} />
      {isAfk && <span>AFK</span>}
    </div>
  );
}
```

### 4. Clean Up Sync Listeners

```typescript
// Sync callbacks are registered per-path, so they persist
// Be mindful of memory if dynamically registering callbacks
const { upsertSyncEventCallback } = useSyncEvents();

useEffect(() => {
  upsertSyncEventCallback('myEvent', handler);
  // No cleanup needed - callbacks are path-scoped
}, []);
```

---

## Examples

### Example 1: Real-time Cursor Tracking

**Client component:**
```typescript
function CollaborativeCanvas() {
  const [cursors, setCursors] = useState<Record<string, {x: number, y: number}>>({});
  const { upsertSyncEventCallback } = useSyncEvents();
  
  useEffect(() => {
    // Listen for other cursors
    upsertSyncEventCallback('cursorMove', ({ clientData }) => {
      setCursors(prev => ({
        ...prev,
        [clientData.userId]: { x: clientData.x, y: clientData.y }
      }));
    });
  }, []);
  
  const handleMouseMove = throttle((e: MouseEvent) => {
    syncRequest({
      name: 'cursorMove',
      data: { x: e.clientX, y: e.clientY, userId: session.id },
      receiver: roomCode,
      ignoreSelf: true
    });
  }, 50);  // Throttle to 20 updates/sec
  
  return (
    <div onMouseMove={handleMouseMove}>
      {Object.entries(cursors).map(([userId, pos]) => (
        <Cursor key={userId} x={pos.x} y={pos.y} userId={userId} />
      ))}
    </div>
  );
}
```

**Sync client handler:**
```typescript
// src/canvas/_sync/cursorMove_client.ts
export const main = async ({ clientData }) => {
  return { 
    status: 'success',
    ...clientData
  };
};
```

### Example 2: Game State Sync with Validation

**Send game action:**
```typescript
await syncRequest({
  name: 'playCard',
  data: { cardId: 'ace-spades', position: 3 },
  receiver: gameRoomCode,
  ignoreSelf: true
});
```

**Server validation:**
```typescript
// src/games/poker/_sync/playCard_server.ts
export const auth = { login: true };

export const main = async ({ clientData, user, functions, roomCode }) => {
  const { prisma } = functions;
  
  // Load game state
  const game = await prisma.game.findUnique({ where: { code: roomCode } });
  
  // Validate it's user's turn
  if (game.currentPlayerId !== user.id) {
    return { status: 'error', message: 'Not your turn' };
  }
  
  // Validate card is in hand
  const hand = game.hands[user.id];
  if (!hand.includes(clientData.cardId)) {
    return { status: 'error', message: 'Card not in hand' };
  }
  
  // Update game state
  await prisma.game.update({
    where: { code: roomCode },
    data: { 
      /* update game state */ 
    }
  });
  
  return { 
    status: 'success',
    nextPlayer: game.nextPlayerId,
    gameState: { /* updated state */ }
  };
};
```

### Example 3: AFK Detection in Multiplayer

```typescript
function GameRoom() {
  const { socketStatus } = useSocketStatus();
  const [isPaused, setIsPaused] = useState(false);
  
  // Pause game if any player is AFK
  useEffect(() => {
    const hasAfkPlayer = Object.entries(socketStatus)
      .filter(([id]) => id !== 'self')
      .some(([_, status]) => status.status === 'DISCONNECTED');
    
    setIsPaused(hasAfkPlayer);
  }, [socketStatus]);
  
  return (
    <div>
      {isPaused && (
        <div className="overlay">
          <h2>Game Paused</h2>
          <p>Waiting for all players to reconnect...</p>
          {Object.entries(socketStatus)
            .filter(([id, s]) => id !== 'self' && s.status === 'DISCONNECTED')
            .map(([userId, status]) => (
              <p key={userId}>
                Player {userId} - {status.endTime 
                  ? `returning in ${Math.round((status.endTime - Date.now()) / 1000)}s`
                  : 'disconnected'}
              </p>
            ))}
        </div>
      )}
      <GameCanvas disabled={isPaused} />
    </div>
  );
}
```

---

## Session Management

### Session Storage

Sessions are stored in **Redis** with the following structure:

- Key: `{PROJECT_NAME}-session:{token}`
- Value: JSON-encoded `SessionLayout` object
- TTL: Configurable via `config.sessionExpiryDays` (default: 7 days)

### Single Session Per User (Session Kicking)

By default, LuckyStack enforces **one session per user**. When a user logs in on a new device:

1. All previous sessions for that user are identified
2. Connected sockets receive a `forceLogout` event
3. Previous session data is deleted from Redis
4. The new session becomes the only active session

**Configure in config.ts:**

```typescript
const config = {
  // false = new login kicks other sessions (default)
  // true = allow multiple simultaneous sessions
  allowMultipleSessions: false,
  
  // Session expiry in days
  sessionExpiryDays: 7,
};
```

**Client handling forced logout:**

```typescript
// In your SessionProvider or socket initialization
socket.on('forceLogout', () => {
  // Clear local session data
  sessionStorage.removeItem('token');
  // Redirect to login
  window.location.href = '/login?reason=session-expired';
});
```

### Session Updates

When session data changes, connected clients are notified:

```typescript
// Server: After updating session
await saveSession(token, updatedSessionData);
// Automatically emits 'updateSession' to connected clients

// Client: Listen for updates
socket.on('updateSession', (data) => {
  const session = JSON.parse(data);
  setSession(session);
});
```

---

## Path-Based Routing

### How API Paths Work

API names are automatically mapped to file paths based on the current page:

```
Current Page:     /settings
API Call:         apiRequest({ name: 'updateProfile', data: {...} })
Server File:      src/settings/_api/updateProfile.ts
```

**The mapping formula:**
```
src/{currentPath}/_api/{apiName}.ts
```

### How Sync Paths Work

Sync events follow a similar pattern but have two files:

```
Current Page:     /sandbox
Sync Call:        syncRequest({ name: 'updateDrawing', ... })
Server File:      src/sandbox/_sync/updateDrawing_server.ts
Client File:      src/sandbox/_sync/updateDrawing_client.ts
```

**The mapping formula:**
```
Server: src/{currentPath}/_sync/{syncName}_server.ts
Client: src/{currentPath}/_sync/{syncName}_client.ts
```

### Directory Structure Example

```
src/
├── settings/
│   ├── page.tsx              # /settings page
│   └── _api/
│       ├── updateProfile.ts  # apiRequest({ name: 'updateProfile' })
│       ├── deleteAccount.ts  # apiRequest({ name: 'deleteAccount' })
│       └── getPreferences.ts # apiRequest({ name: 'getPreferences' })
│
├── sandbox/
│   ├── page.tsx              # /sandbox page
│   ├── _api/
│   │   └── saveCanvas.ts     # apiRequest({ name: 'saveCanvas' })
│   └── _sync/
│       ├── updateDrawing_server.ts  # syncRequest({ name: 'updateDrawing' })
│       ├── updateDrawing_client.ts
│       ├── cursorMove_client.ts     # Server file optional!
│       └── ...
│
└── admin/
    ├── page.tsx              # /admin page
    └── _api/
        ├── getUsers.ts       # admin-only API
        └── deleteUser.ts     # admin-only API
```

### Cross-Page API Calls

To call an API that's not in the current page's folder, use the full path:

```typescript
// From any page, call an API in /settings
await apiRequest({ 
  name: '/settings/updateProfile',  // Note the leading slash
  data: { ... }
});
```

---

## Complete Auth Patterns

### Auth Object Structure

Every API and Sync handler should export an `auth` object:

```typescript
import type { AuthProps } from 'config';

export const auth: AuthProps = {
  login: boolean,      // Require authenticated user?
  additional?: [...]   // Extra validation rules
};
```

### Pattern 1: Public API (No Auth)

```typescript
// Anyone can call this, even without logging in
export const auth: AuthProps = {
  login: false
};

export const main = async ({ data }) => {
  // No user object available!
  return { status: 'success' };
};
```

### Pattern 2: Logged-In Users Only

```typescript
// Most common pattern
export const auth: AuthProps = {
  login: true
};

export const main = async ({ data, user }) => {
  // user is guaranteed to have an id
  console.log('User:', user.id, user.email);
  return { status: 'success' };
};
```

### Pattern 3: Admin Only

```typescript
// Only users with admin: true can access
export const auth: AuthProps = {
  login: true,
  additional: [
    { key: 'admin', value: true }
  ]
};

export const main = async ({ data, user }) => {
  // user.admin is guaranteed to be true
  return { status: 'success' };
};
```

### Pattern 4: Verified Email Required

```typescript
// User must have a non-null email
export const auth: AuthProps = {
  login: true,
  additional: [
    { key: 'email', nullish: false }  // Must NOT be null/undefined
  ]
};
```

### Pattern 5: Specific Value Check

```typescript
// User must be from a specific provider
export const auth: AuthProps = {
  login: true,
  additional: [
    { key: 'provider', value: 'google' }  // Strict equality
  ]
};
```

### Pattern 6: Type Check

```typescript
// Field must be a specific type
export const auth: AuthProps = {
  login: true,
  additional: [
    { key: 'name', type: 'string' }  // Must be a string
  ]
};
```

### Pattern 7: Truthy/Falsy Check

```typescript
// User must have a profile picture set
export const auth: AuthProps = {
  login: true,
  additional: [
    { key: 'avatar', mustBeFalsy: false }  // Must be truthy (not '', 0, null, etc.)
  ]
};
```

### Pattern 8: Multiple Conditions

```typescript
// Combine multiple checks (all must pass)
export const auth: AuthProps = {
  login: true,
  additional: [
    { key: 'admin', value: true },
    { key: 'email', nullish: false },
    { key: 'name', type: 'string' }
  ]
};
```

### Adding Zod Validation

For runtime data validation, export a `schema`:

```typescript
import { z } from 'zod';
import type { AuthProps } from 'config';

// Zod schema for type-safe validation
export const schema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  age: z.number().int().positive().optional()
});

export const auth: AuthProps = {
  login: true
};

export const main = async ({ data, user }) => {
  // data is validated and typed by Zod!
  const { email, name, age } = data;
  return { status: 'success' };
};
```

---

## Quick Reference

### Client Functions

| Function | Import | Purpose |
|----------|--------|---------|
| `apiRequest` | `src/_sockets/apiRequest` | Make server API calls |
| `syncRequest` | `src/_sockets/syncRequest` | Send real-time events |
| `useSyncEvents` | `src/_sockets/syncRequest` | Register sync listeners |
| `joinRoom` | `src/_sockets/socketInitializer` | Join a sync room |
| `useSocketStatus` | `src/_providers/socketStatusProvider` | Get connection status |

### Server Exports

| Export | Required | Purpose |
|--------|----------|---------|
| `auth` | Yes | Authentication requirements |
| `main` | Yes | Handler function |
| `schema` | No | Zod validation schema |

### Config Options

| Option | Default | Purpose |
|--------|---------|---------|
| `socketActivityBroadcaster` | `false` | Enable multiplayer awareness |
| `allowMultipleSessions` | `false` | Allow simultaneous sessions |
| `sessionExpiryDays` | `7` | Session TTL in Redis |
| `enableZodValidation` | `true` | Validate API data with Zod |

