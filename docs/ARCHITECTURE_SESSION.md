# Session Architecture

> Session management using Redis with OAuth provider support.

---

## Quick Reference

```typescript
// Client: Get current session
const session = await apiRequest({ name: "session" });
// Returns: { id, email, name, provider, ... } or null

// Client: Logout
await apiRequest({ name: "logout" });
```

---

## Session Storage

Sessions are stored in **Redis** with configurable expiry.

```
Redis Key: {PROJECT_NAME}:session:{token}
Value: JSON-encoded SessionLayout
Expiry: config.sessionExpiryDays (default: 7 days)
```

---

## SessionLayout

Define your session structure in `config.ts`:

```typescript
export interface SessionLayout {
  id: string;
  name: string;
  email: string;
  provider: string;
  admin: boolean;
  avatar: string;
  avatarFallback: string;
  language: string;
  theme: "light" | "dark";
  createdAt: Date;
  updatedAt: Date;
  token: string;
  location?: {
    pathName: string;
    searchParams: { [key: string]: string };
  };
}
```

---

## Configuration

```typescript
// config.ts
const config = {
  // Session behavior
  allowMultipleSessions: false, // false = new login kicks other sessions
  sessionExpiryDays: 7,

  // Redirects
  loginPageUrl: "/login",
  loginRedirectUrl: "/examples",
};
```

---

## Session Flow

```
1. User logs in (OAuth or credentials)
   ↓
2. Server generates random token (UUID)
   ↓
3. Session stored in Redis: {token} → {user data}
   ↓
4. Token sent to client:
   - Cookie-based: Set-Cookie: token={token}; HttpOnly
   - Session-based: Returned in response body
   ↓
5. Subsequent requests include token:
   - WebSocket: socket.handshake.auth.token
   - HTTP: Cookie header or Authorization: Bearer {token}
```

---

## Token Modes

Controlled by `VITE_SESSION_BASED_TOKEN` env variable:

| Mode              | Storage         | Best For                   |
| ----------------- | --------------- | -------------------------- |
| `false` (default) | HttpOnly cookie | Web apps, security-focused |
| `true`            | sessionStorage  | Developing                 |

---

## Session Functions

### Server-side

```typescript
import {
  getSession,
  createSession,
  deleteSession,
} from "server/functions/session";

// Get session from token
const user = await getSession(token);

// Create new session
const token = await createSession(userId, sessionData);

// Delete session (logout)
await deleteSession(token);
```

### Client-side

```typescript
import { useSession } from 'src/_providers/sessionProvider';

function UserProfile() {
  const session = useSession();

  if (!session) return <LoginButton />;
  return <div>Welcome, {session.name}</div>;
}
```

---

## Multi-Session Behavior

```typescript
// config.ts
allowMultipleSessions: false; // Default

// When false:
// - User logs in on device A → Session A created
// - User logs in on device B → Session A deleted, Session B created
// - Device A's socket receives 'logout' event

// When true:
// - Both sessions remain active
// - Useful for: multiple browser tabs, phone + desktop
```

---

## Security Notes

1. **Tokens are random UUIDs** - Not predictable
2. **HttpOnly cookies** - Not accessible via JavaScript
3. **Session validation** - Every API/sync request validates token
4. **Automatic cleanup** - Redis TTL handles expiry
