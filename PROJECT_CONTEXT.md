<!-- 
  to toggle markdown file press  
  1. ctrl + k
  2. v
-->


# UI-Builder Project Context

> **Human-readable documentation for AI assistants to understand this project.**  
> Last updated: 2026-01-28

---

## Project Overview

**UI-Builder** (internally called "LuckyStack") is a **creative platform** for:
- **Visual UI development** - Upload `.tsx/.jsx` files, compile with Babel, and render live in viewports
- **Idea organization** - Notes, drawings, and file management on an infinite 2D canvas
- **Future: Real-time collaboration** - Room-based sync infrastructure is built-in

The project is split into two logical parts:
1. **Framework** - Custom full-stack framework with authentication, sockets, and API routing
2. **Application (Sandbox)** - The main canvas-based workspace where users create

---

# Part 1: Framework Summary

The framework is a **custom-built React + Node.js stack** inspired by Next.js but with socket-first architecture.

## Root Configuration Files

| File | Purpose |
|------|---------|
| `config.ts` | Main app configuration (URLs, defaults, session layout). Gitignored - use `configTemplate.txt` |
| `envTemplate.txt` | Template for `.env` file with database, OAuth, and server secrets |
| `vite.config.ts` | Vite bundler config with path aliases (`src/`, `config`) and exclusions for server files |
| `index.html` | Entry point with two root divs: `#root` (app) and `#portalRoot` (modals/overlays z-999999999) |
| `redis.conf` | Redis configuration for session storage |
| `prisma/schema.prisma` | MongoDB database schema - currently only `user` model with OAuth providers |

## Server Architecture (`/server`)

The backend is **raw Node.js** (no Express) with a custom HTTP router and Socket.io.

### `server/server.ts` - Main Entry Point
- Creates HTTP server with CORS, security headers (Referrer-Policy, X-Frame-Options, X-XSS-Protection)
- HTTP route handling by path prefix:
  - `/auth/api/{provider}` → Redirects to OAuth provider or handles credentials login
  - `/auth/callback/{provider}` → Handles OAuth callback from providers
  - `/uploads/*` → Serves uploaded files (avatars, etc.)
  - `/assets/*` → Serves static assets
  - Everything else → Falls back to `index.html` for SPA routing
- In development mode: initializes hot-reload watchers and REPL console
- Initializes Socket.io via `loadSocket()`

### `server/auth/` - Authentication System

| File | Purpose |
|------|---------|
| `login.ts` | Handles credentials login/register and OAuth callback processing |
| `loginConfig.ts` | Defines 5 OAuth provider configs (credentials, Google, GitHub, Discord, Facebook) |
| `checkOrigin.ts` | Validates request origins against allowed domains (DNS, localhost, external origins) |

**Supported Providers:** credentials, Google, GitHub, Facebook, Discord

**Login Flow:**
1. Credentials: Validates email/password, hashes with bcrypt, creates/authenticates user
2. OAuth: Redirects to provider → callback exchanges code for token → fetches user info → creates/finds user
3. On successful login, generates random token and saves session to Redis

### `server/sockets/socket.ts` - Socket.io Server
Handles all real-time communication:
- **`apiRequest`** - RPC-style API calls from client (routed via `handleApiRequest.ts`)
- **`sync`** - Room-based sync events between clients (routed via `handleSyncRequest.ts`)
- **`joinRoom`** - Adds socket to a room (room code stored in session)
- **`updateLocation`** - Tracks user's current page path
- **`disconnect`** - Handles socket disconnection with optional activity broadcasting

### `server/sockets/handleApiRequest.ts` - API Request Handler
- Special handlers for `session` (returns user session) and `logout` (logs out user)
- Validates `auth` requirements before executing API functions
- **Auth Validation System** supports flexible conditions:
  - `login: true` - Requires user to be logged in
  - `additional: [{key, type?, value?, nullish?, mustBeFalsy?}]` - Custom field checks

### `server/sockets/handleSyncRequest.ts` - Sync Request Handler
- Validates server-side sync file before broadcasting
- Loops through all sockets in the room and runs client-side sync for each
- Supports `ignoreSelf` to exclude sender from receiving the event

### `server/functions/` - Server Utilities
| File | Purpose |
|------|---------|
| `session.ts` | Session CRUD in Redis + **auto-kicks previous sessions on login** |
| `redis.ts` | Redis client wrapper (ioredis) |
| `db.ts` | Prisma client export for MongoDB |
| `tryCatch.ts` | Error-safe async function wrapper |
| `sleep.ts` | Promise-based delay |
| `broadcaster.ts` | Utility for broadcasting to socket rooms |
| `game.ts` | Game-related utilities (for multiplayer games) |

### Session Kicking Feature (`session.ts`)
When a user logs in, the system automatically kicks all previous sessions for that user:
1. Looks up all active tokens for the user ID in Redis
2. For each existing session: emits `logout` event to connected sockets, deletes session data
3. Registers new token in the active users set
4. Broadcasts `updateSession` to all sockets with the new token

### `server/dev/` - Development Utilities
| File | Purpose |
|------|---------|
| `loader.ts` | Hot-reloads `_api` and `_sync` files without server restart |
| `hotReload.ts` | File watcher that triggers reloads on changes |

### `server/sockets/utils/` - Socket Utilities
| File | Purpose |
|------|---------|
| `logout.ts` | Handles logout: clears timers, leaves rooms, deletes session |
| `activityBroadcaster.ts` | Tracks user activity (AFK detection, reconnection) |

### Build Scripts (`/scripts`)
| Script | Purpose |
|--------|---------|
| `generateServerRequests.ts` | Scans `src/` for `_api/` and `_sync/` folders, generates route map |
| `bundleServer.ts` | Bundles server for production |
| `clearServerRequests.ts` | Clears generated route map for dev restart |

---

## Client Architecture (`/src`)

### Entry Point: `main.tsx`
- File-based routing similar to Next.js
- Scans for `page.tsx` in any non-underscore folder
- Wraps app in providers: `SocketStatus` → `Session` → `Translation` → `Avatar` → `MenuHandler` → `Router`

### Provider Hierarchy (Framework-level)
```
SocketStatusProvider   # Socket connection status
└── SessionProvider    # User session from Redis
    └── TranslationProvider  # i18n with JSON locale files
        └── AvatarProvider   # User avatar caching
            └── MenuHandlerProvider  # Global menu state
                └── RouterProvider   # React Router
```

### `src/_sockets/` - Client-Server Communication

These are the core functions for communicating with the backend:

#### `apiRequest({ name, data })` → Promise (Type-Safe)
- **Fully type-safe API calls** - TypeScript validates API names, input data, and output types
- Auto-prefixes with current path: `api/{path}/{name}`
- Has abort controllers for duplicate GET-like requests

**Type System Features:**
1. **Automatic type inference** - No manual type parameters needed for most cases
2. **Union types for duplicate names** - If same API name exists on multiple pages, accepts union of all input types
3. **Optional page path** - Pass `<'page/path'>` for exact types when duplicate names exist
4. **Required data validation** - `data` is required when API expects specific fields, optional for `Record<string, any>`
5. **Errors for invalid names** - TypeScript error if API name doesn't exist

**Examples:**
```typescript
// Auto-typed - works for unique API names
const result = await apiRequest({ name: 'adminOnly', data: {} });

// Union type - 'jow' exists on multiple pages
const result = await apiRequest({ 
  name: 'jow', 
  data: { email: 'x' } // OR { name: 'x' }
});

// Exact typing with page path
const result = await apiRequest<'examples/examples2'>({ 
  name: 'jow',
  data: { name: 'john' } // Must be { name: string }
});

// Error: API doesn't exist
const result = await apiRequest({ name: 'invalid' }); // ❌ TypeScript error

// Error: missing required data
const result = await apiRequest({ name: 'jow' }); // ❌ Property 'data' is missing
```

**Type Generation:**
- Types are auto-generated in `src/_sockets/apiTypes.generated.ts` by `server/dev/typeMapGenerator.ts`
- Watches `_api` folders and extracts input/output types from `ApiParams` interface and `main` function return type
- Regenerates on file changes via `server/dev/hotReload.ts`

#### `syncRequest({ name, data, receiver, ignoreSelf })` → Promise (Type-Safe)
- Sends real-time events to other clients in same room
- `receiver` is the room code (e.g., "abc123")
- `ignoreSelf` prevents the sender from receiving the event
- **Fully type-safe** - sync names, clientData, and serverData are validated

**Type System Features:**
1. **Automatic type inference** - No manual type parameters needed 
2. **Union types for duplicate names** - Same as apiRequest
3. **Optional page path** - Pass `<'page/path'>` for exact types
4. **Required data validation** - `data` required when sync expects specific fields

**Examples:**
```typescript
// Type-safe sync with auto-complete
await syncRequest({ 
  name: 'updateCounter', // ← Autocomplete for sync names
  data: { increase: true }, // ← Type-checked
  receiver: roomCode
});

// Exact typing with page path
await syncRequest<'examples'>({ 
  name: 'updateCounter',
  data: { increase: true },
  receiver: roomCode
});
```

#### `useSyncEvents()` Hook (Type-Safe)
```typescript
const { upsertSyncEventCallback } = useSyncEvents();

// Type-safe: clientOutput and serverData are inferred from sync definition
upsertSyncEventCallback('updateCounter', ({ clientOutput, serverData }) => {
  console.log(clientOutput.randomKey); // ← Type from _client file return (success only)
  console.log(serverData.increase);    // ← Type from _server file return
});
```

**Sync Type System:**
The sync type system has three distinct data types that flow through the system:

| Type | Source | Description |
|------|--------|-------------|
| `clientInput` | Sender's `data` param | Original data passed to `syncRequest({ data: ... })` |
| `serverData` | `_server.ts` return | Data returned from server-side sync handler |
| `clientOutput` | `_client.ts` return | Data returned from client-side handler (success only) |

**Type Generation:**
- Types auto-generated in `src/_sockets/apiTypes.generated.ts`
- Watches `_sync/*_server.ts` and `_sync/*_client.ts` files
- `clientOutput` only includes successful returns (error returns are filtered out)

#### `joinRoom(code)` → Promise
- Joins a socket room for sync events
- Room code stored in user session

### `src/_components/` - Reusable UI Components

| Component | Purpose |
|-----------|---------|
| `TemplateProvider.tsx` | Wraps pages in templates: `plain`, `main`, `sandbox` |
| `SessionProvider.tsx` | Provides session context and socket initialization |
| `Middleware.tsx` | Route authentication guards |
| `LoginForm.tsx` | OAuth login buttons |
| `MenuHandler.tsx` | Global menu/modal management |
| `Navbar.tsx` | Top navigation bar |
| `Tooltip.tsx` | Hover tooltips |
| `Dropdown.tsx` | Dropdown menus |
| `ConfirmMenu.tsx` | Confirmation dialogs |
| `TranslationProvider.tsx` | i18n with `src/_locales/{lang}.json` |

### Templates (`TemplateProvider.tsx`)

Pages export a `template` constant to specify their wrapper:

1. **`plain`** - Minimal wrapper, no UI chrome
2. **`main`** - Navbar with user info and navigation
3. **`sandbox`** - Full sandbox with all feature providers:
   ```
   GridProvider → BlueprintsProvider → BuilderPanelProvider → 
   MenusProvider → CodeProvider → DrawingProvider → NotesProvider → MainTemplate
   ```

### Page Routes

| Route | Template | Purpose |
|-------|----------|---------|
| `/` | plain | Root redirect based on session |
| `/login` | plain | OAuth login page |
| `/register` | plain | Registration (uses LoginForm) |
| `/home` | main | Sandbox selection (in progress) |
| `/settings` | main | User settings with `_api` folder |
| `/test` | main | Development testing with `_api` and `_sync` examples |
| `/sandbox` | sandbox | Main application canvas |

### API/Sync Convention

**API Routes** (server-only functions):
- Place files in `src/{page}/_api/{name}.ts`
- Export `main` function and optional `auth` guard
- Call from client: `apiRequest({ name: '{name}' })`

**Sync Routes** (real-time client-server events):
- `src/{page}/_sync/{name}_server.ts` - Runs on server for validation, returns `serverData`
- `src/{page}/_sync/{name}_client.ts` - Runs on receiving clients, returns `clientOutput`
- Both files use `clientInput` in SyncParams for the original sender's data
- Call from client: `syncRequest({ name: '{name}', data: clientInput, receiver: 'room-code' })`

---

## Styling

- **TailwindCSS v4** with custom colors in `src/index.css`
- Theme support: light (default) and dark mode via CSS classes
- Custom CSS variables for colors (`--color-background`, `--color-primary`, etc.)
- `src/NoteEditor.css` - ProseMirror/TipTap styles for notes
- `src/scrollbar-*.css` - Theme-specific scrollbar styles (not yet dynamically loaded)

---

# Part 2: Application Summary