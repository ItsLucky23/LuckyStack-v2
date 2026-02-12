# Routing Architecture

> File-based routing for pages, APIs, and real-time sync events.

---

## Overview

LuckyStack uses file-based routing inspired by Next.js. There are three types of routes:

1. **Page routes** - React components that render at URL paths
2. **API routes** - Server-side functions callable via WebSocket or HTTP
3. **Sync routes** - Real-time event handlers for room-based broadcasting

All three follow the same convention: place files in the correct folder structure and they are automatically registered.

---

## Page Routing

### How It Works

`src/main.tsx` uses Vite's `import.meta.glob` to scan all `.tsx` files at build time. It finds files named `page.tsx` in non-underscore folders and registers them as routes with React Router.

### File Convention

```
src/{page}/page.tsx  -->  renders at /{page}
src/page.tsx         -->  renders at /
```

### Rules

- Only files named `page.tsx` become routes
- Folders starting with `_` are skipped (private folders for components, utilities, etc.)
- Each page can export a `template` constant to control its layout wrapper
- If no template is exported, defaults to `'plain'`

### Templates

```typescript
// src/settings/page.tsx
export const template = 'home';

export default function SettingsPage() {
  return <div>...</div>;
}
```

Available templates:

| Template    | Description                                                         |
| ----------- | ------------------------------------------------------------------- |
| `plain`     | Minimal wrapper, no UI chrome. Sets theme to `config.defaultTheme`. |
| `home`      | Top bar with user avatar, settings/home toggle, and logout button.  |
| `dashboard` | Side navigation bar with main content area.                         |

Both `home` and `dashboard` templates include `Middleware` for route authentication guards.

### Route Resolution Logic

From `main.tsx`:

1. Scan all `.tsx` files via `import.meta.glob('./**/*.tsx', { eager: true })`
2. For each file, split the path into segments
3. Skip if any segment starts with `_`
4. Check if the file ends with `page.tsx`
5. Extract the route path by removing `page` suffix
6. Register as a child route of the root `'/'` path

---

## API Routing

### File Convention

```
src/{page}/_api/{name}.ts  -->  accessible as api/{page}/{name}
```

### How It Works

**Development:** The server's `dev/loader.ts` scans `src/` recursively for folders ending in `api` (case-insensitive). For each `.ts` file found, it dynamically imports the module and registers it with the key `api/{page}/{name}`.

**Production:** The `scripts/generateServerRequests.ts` build script statically generates a route map that's bundled into `server/prod/generatedApis.ts`.

### Name Resolution

The API name sent from the client is automatically constructed from the current page path:

```
Client at /examples calls apiRequest({ name: 'publicApi' })
  --> fullname = "api/examples/publicApi"
  --> matches src/examples/_api/publicApi.ts
```

For nested pages:

```
Client at /games/chess calls apiRequest({ name: 'getGameState' })
  --> fullname = "api/games/chess/getGameState"
  --> matches src/games/chess/_api/getGameState.ts
```

### Required Exports

Each API file must export:

```typescript
// Required
export const main = async ({
  data,
  user,
  functions,
}: ApiParams): Promise<ApiResponse> => {
  return {
    status: "success",
    result: {
      /* ... */
    },
  };
};

// Required
export const auth: AuthProps = {
  login: true, // Require authentication
  additional: [], // Extra checks (e.g., admin role)
};

// Required for type generation
export interface ApiParams {
  data: {
    /* typed input from client */
  };
  user: SessionLayout;
  functions: Functions;
}

// Optional
export const rateLimit: number | false = 60; // Requests per minute (false = use global config)
export const httpMethod: "GET" | "POST" | "PUT" | "DELETE" = "POST"; // Override HTTP method inference
```

### WebSocket Access

The primary way to call APIs. The client sends a socket event and gets a response:

```typescript
// Client
const result = await apiRequest({
  name: "getUserData",
  data: { userId: "123" },
});
```

Flow:

1. Client emits `apiRequest` event with `{ name, data, responseIndex }`
2. Server looks up handler in `devApis` (dev) or `apis` (prod)
3. Validates auth requirements
4. Checks rate limits
5. Executes `main()` function
6. Emits response on `apiResponse-{responseIndex}`

### HTTP Access

All APIs are also accessible via HTTP for testing, webhooks, or non-socket clients:

```
GET    /api/{page}/{name}?key=value
POST   /api/{page}/{name}  with JSON body
PUT    /api/{page}/{name}  with JSON body
DELETE /api/{page}/{name}
```

HTTP method is either explicitly exported from the API file or inferred from the name:

| Name Prefix                  | Inferred Method |
| ---------------------------- | --------------- |
| `get*`, `fetch*`, `list*`    | GET             |
| `delete*`, `remove*`         | DELETE          |
| `update*`, `edit*`, `patch*` | PUT             |
| Everything else              | POST            |

Authentication via HTTP: include token as cookie (`token=...`) or `Authorization: Bearer ...` header.

### Built-In APIs

Two APIs are handled internally without files:

| Name      | Purpose                          |
| --------- | -------------------------------- |
| `session` | Returns the current user session |
| `logout`  | Logs out the user                |

### Type Generation

Types are automatically generated by `server/dev/typeMapGenerator.ts`:

1. Watches `_api/` folders for file changes
2. Extracts `ApiParams` interface and `main` return type from each file
3. Generates `src/_sockets/apiTypes.generated.ts`
4. Provides full autocomplete for API names, input data, and output types

---

## Sync Routing

### File Convention

```
src/{page}/_sync/{name}_server.ts  -->  Server-side validation (runs once)
src/{page}/_sync/{name}_client.ts  -->  Client-side handler (runs per client in room)
```

At least one of the two files must exist. Both are optional individually.

### How It Works

**Development:** The server's `dev/loader.ts` scans for folders ending in `sync`. For each `_server.ts` or `_client.ts` file, it registers with key `sync/{page}/{name}_server` or `sync/{page}/{name}_client`.

**Production:** Same build script generates static route maps.

### Name Resolution

Similar to APIs, the sync name is prefixed with the current page path:

```
Client at /examples calls syncRequest({ name: 'updateCounter', ... })
  --> fullname = "sync/examples/updateCounter"
  --> server looks for sync/examples/updateCounter_server and sync/examples/updateCounter_client
```

### Sync Flow

```
1. Client A sends syncRequest({ name, data, receiver: roomCode })
   |
2. Server validates message format
   |
3. If _server.ts exists:
   |  a. Check auth requirements
   |  b. Run main() for validation/DB operations
   |  c. Get serverOutput
   |
4. Get all sockets in the target room
   |
5. For each socket in room:
   |  a. Get that user's session
   |  b. If ignoreSelf and it's the sender, skip
   |  c. If _client.ts exists:
   |     - Run main() with { clientInput, serverOutput, user, functions, roomCode }
   |     - If returns { status: 'error' }, skip this client
   |     - If returns { status: 'success' }, emit to this client
   |  d. If no _client.ts, emit serverOutput directly
   |
6. Confirm success back to sender via sync-{responseIndex}
```

### Required Exports

**Server file (`_server.ts`):**

```typescript
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: {
    /* data from sender */
  };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({
  clientInput,
  user,
  functions,
  roomCode,
}: SyncParams): Promise<SyncServerResponse> => {
  // Validate and transform data
  return { status: "success" /* additional data for clients */ };
};
```

**Client file (`_client.ts`):**

```typescript
export interface SyncParams {
  clientInput: SyncClientInput<PagePath, SyncName>;
  serverOutput: SyncServerOutput<PagePath, SyncName>;
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({
  clientInput,
  serverOutput,
  user,
  functions,
  roomCode,
}: SyncParams): Promise<SyncClientResponse> => {
  // Filter: return error to skip this client, success to deliver
  return { status: "success" /* additional client-specific data */ };
};
```

### Receiving Sync Events

On the client, register callbacks to handle incoming sync events:

```typescript
const { upsertSyncEventCallback } = useSyncEvents();

upsertSyncEventCallback("updateCounter", ({ clientOutput, serverOutput }) => {
  // clientOutput = return from _client.ts (success only)
  // serverOutput = return from _server.ts
});
```

### Data Flow Types

| Type           | Source                | Description                                           |
| -------------- | --------------------- | ----------------------------------------------------- |
| `clientInput`  | Sender's `data` param | Original data passed to `syncRequest({ data: ... })`  |
| `serverOutput` | `_server.ts` return   | Data returned from server-side handler                |
| `clientOutput` | `_client.ts` return   | Data returned from client-side handler (success only) |

---

## Private Folders

Any folder prefixed with `_` is private and excluded from routing:

| Folder         | Purpose                                  |
| -------------- | ---------------------------------------- |
| `_api/`        | API handlers (registered separately)     |
| `_sync/`       | Sync handlers (registered separately)    |
| `_components/` | Page-specific or shared React components |
| `_functions/`  | Utility functions                        |
| `_providers/`  | React context providers                  |
| `_sockets/`    | Socket.io client utilities               |
| `_locales/`    | i18n translation JSON files              |

---

## Hot Reload

In development mode, the server watches for file changes:

1. `server/dev/hotReload.ts` monitors `src/` for changes in `_api/` and `_sync/` folders
2. On change, `server/dev/loader.ts` re-imports the modified module
3. `server/dev/typeMapGenerator.ts` regenerates `apiTypes.generated.ts` with updated types
4. No server restart needed for API/sync changes
5. Vite HMR handles frontend component changes
