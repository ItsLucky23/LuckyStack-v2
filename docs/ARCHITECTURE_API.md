# API Architecture

> Type-safe API request system with WebSocket-first architecture and HTTP fallback.

---

## Quick Reference

```typescript
// Page-relative API call
const result = await apiRequest({
  name: "getUserData",
  data: { userId: "123" },
  abortable: true, // Optional: auto-cancels if called again before response
});

// Root-level API call (works from any page — server resolves automatically)
const session = await apiRequest({ name: "session" });

// HTTP fallback (same API, no WebSocket needed)
// GET /api/examples/getUserData?userId=123
// POST /api  with { name: 'api/examples/getUserData', data: { userId: '123' } }
```

---

## File Structure

```
src/
├── _api/                       # Root-level APIs (callable from any page)
│   ├── session.ts              # → api/session (use '/session' on client)
│   └── logout.ts               # → api/logout  (use '/logout' on client)
├── {page}/_api/
│   ├── {apiName}.ts            # → api/{page}/{apiName}
│   └── {subfolder}/            # Nested: api/{page}/{subfolder}/{apiName}
│       └── {apiName}.ts
└── _sockets/
    ├── apiRequest.ts           # Client-side API caller
    └── apiTypes.generated.ts   # Auto-generated types
```

---

## Creating an API

### 1. Create the file

template is injected

```typescript
// src/examples/_api/getUserData.ts
import { AuthProps, SessionLayout } from "config";
import { Functions, ApiResponse } from "src/_sockets/apiTypes.generated";

// Rate limit: requests per minute (false = use global config)
export const rateLimit: number | false = 60;

// HTTP method (optional - inferred from name if not set)
// export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET';

export const auth: AuthProps = {
  login: true, // Require authentication
  additional: [], // Extra requirements: 'admin', etc.
};

export interface ApiParams {
  data: {
    userId: string; // Input from client
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({
  data,
  user,
  functions,
}: ApiParams): Promise<ApiResponse> => {
  const userData = await functions.prisma.user.findUnique({
    where: { id: data.userId },
  });

  return {
    status: "success",
    result: userData,
  };
};
```

### 2. Use from client

```typescript
// Types are auto-generated - full autocomplete!
const result = await apiRequest({
  name: "getUserData",
  data: { userId: "123" },
});

if (result.status === "success") {
  console.log(result.result); // Typed correctly
}
```

---

## HTTP API Access

APIs are accessible via HTTP for testing, webhooks, or non-socket clients.

### RESTful Routes

Examples:

- `GET /api/examples/getUserData?userId=123`
- `POST /api/examples/createUser`
- `PUT /api/settings/updateProfile`
- `DELETE /api/examples/deleteUser`

### Method Inference

If `httpMethod` is not exported, it's inferred from the API name:

| Name Prefix                  | Inferred Method |
| ---------------------------- | --------------- |
| `get*`, `fetch*`, `list*`    | GET             |
| `delete*`, `remove*`         | DELETE          |
| `update*`, `edit*`, `patch*` | PUT             |
| Everything else              | POST            |

### Authentication

Include token via:

- **Cookie**: `token=your-token` (set automatically on login)
- **Header**: `Authorization: Bearer your-token`

---

## Abort Controller

GET-style APIs automatically use abort controllers to cancel in-flight requests.

```typescript
// These automatically cancel previous calls if called again:
await apiRequest({ name: 'getUserData', data: {...} });

// Explicit control:
await apiRequest({ name: 'createUser', data: {...}, abortable: true });  // Force
await apiRequest({ name: 'getUser', data: {...}, abortable: false });    // Disable
```

## Offline Request Queue

When the socket is disconnected or the browser is offline, `apiRequest` automatically queues requests in memory. The queue flushes on reconnect or when the browser comes back online. Aborted requests are removed from the queue.

## Rate Limiting

Configure globally in `config.ts`:

```typescript
rateLimiting: {
  defaultApiLimit: 60,   // Requests per minute per user
  defaultIpLimit: 100,   // Per-IP limit (unauthenticated)
  windowMs: 60000,       // 1 minute window
}
```

Or per-API:

```typescript
// In any _api/*.ts file
export const rateLimit = 30; // Override global
export const rateLimit = false; // Disable for this API
```
