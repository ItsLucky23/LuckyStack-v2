# Developer Guide

> Getting started with LuckyStack development.

---

## Quick Start

### 1. Setup

```bash
# Install dependencies
npm install

# Copy config templates
cp configTemplate.txt config.ts
cp envTemplate.txt .env

# Edit .env with your credentials
# Edit config.ts with your settings
```

### 2. Start Development

```bash
# Terminal 1: Start backend
npm run server

# Terminal 2: Start frontend (Vite)
npm run client
```

### 3. Create Your First API

```typescript
// src/mypage/_api/hello.ts
import { AuthProps, SessionLayout } from "config";
import { Functions, ApiResponse } from "src/_sockets/apiTypes.generated";

export const auth: AuthProps = { login: false, additional: [] };

export interface ApiParams {
  data: { name: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data }: ApiParams): Promise<ApiResponse> => {
  return {
    status: "success",
    result: { message: `Hello, ${data.name}!` },
  };
};
```

Types are auto-generated! Just save the file and use:

```typescript
const result = await apiRequest({ name: "hello", data: { name: "World" } });
```

---

## Project Structure

```
luckystack/
├── src/                    # Frontend (React)
│   ├── _components/        # Shared UI components
│   ├── _functions/         # Client utilities
│   ├── _providers/         # React context providers
│   ├── _sockets/           # Socket client utilities
│   ├── _locales/           # i18n translations
│   ├── admin/              # Admin pages
│   └── {page}/             # Feature pages
│       ├── page.tsx        # Main page component
│       ├── _components/    # Page-specific components
│       ├── _api/           # API handlers for this page
│       └── _sync/          # Sync handlers for this page
│
├── server/                 # Backend (Node.js)
│   ├── auth/               # Authentication logic
│   ├── sockets/            # Socket event handlers
│   ├── functions/          # Shared server functions
│   ├── utils/              # Server utilities
│   ├── dev/                # Hot reload & type generation
│   └── server.ts           # Entry point
│
├── docs/                   # Architecture documentation
├── config.ts               # App configuration
└── .env                    # Environment variables
```

---

## Common Patterns

### Page with API and Sync

```
src/game/
├── page.tsx                # Main game UI
├── _components/
│   ├── Board.tsx
│   └── ScoreBoard.tsx
├── _api/
│   ├── createGame.ts       # POST - create new game
│   ├── getGameState.ts     # GET - fetch game state
│   └── deleteGame.ts       # DELETE - end game
└── _sync/
    ├── movePlayer_server.ts  # Server validates move
    └── movePlayer_client.ts  # Client processes move
```

### Using in Components

```tsx
import { apiRequest } from "src/_sockets/apiRequest";
import { syncRequest, upsertSyncEventCallback } from "src/_sockets/syncRequest";

function GameBoard() {
  const [state, setState] = useState(null);

  // Fetch initial state
  useEffect(() => {
    apiRequest({ name: "getGameState", data: { gameId } }).then((result) =>
      setState(result),
    );
  }, [gameId]);

  // Listen for moves
  useEffect(() => {
    upsertSyncEventCallback("movePlayer", ({ serverOutput }) => {
      setState((prev) => ({ ...prev, ...serverOutput }));
    });
  }, []);

  // Send a move
  const handleMove = (move) => {
    syncRequest({ name: "movePlayer", data: move });
  };

  return <Board onMove={handleMove} {...state} />;
}
```

---

## Hot Reload

The dev server watches for file changes and automatically:

1. **API files** (`_api/*.ts`) - Regenerates types in `apiTypes.generated.ts`
2. **Sync files** (`_sync/*.ts`) - Injects templates and updates types
3. **Components** - Vite HMR handles the rest

Just save and your types are updated!

---

## Testing APIs

### Via HTTP (curl/Postman)

```bash
# GET-style API
curl http://localhost/api/mypage/getGameState?gameId=123

# POST-style API
curl -X POST http://localhost/api/mypage/createGame \
  -H "Content-Type: application/json" \
  -d '{"name": "My Game"}'

# With auth
curl http://localhost/api/mypage/getGameState?gameId=123 \
  -H "Authorization: Bearer your-token-here"
```

### Via Browser Console

```javascript
// If socket is connected
socket.emit("apiRequest", {
  name: "api/mypage/hello",
  data: { name: "Test" },
  responseIndex: 999,
});

socket.on("apiResponse-999", console.log);
```

---

## Debugging

### Server Logs

Colorized console output:

- 🔵 **Blue** - API calls
- 🟢 **Green** - Success
- 🔴 **Red** - Errors
- 🟡 **Yellow** - Warnings
- 🟣 **Magenta** - HTTP requests

### Dev REPL

In server terminal, type commands directly:

```
> session.get('token-123')  // Check session
> io.sockets.sockets.size   // Connected sockets
```

### Sentry Integration

Errors are automatically captured if `SENTRY_DSN` is set in `.env`.

---

## Best Practices

1. **Keep APIs small** - One responsibility per file
2. **Use type inference** - Don't manually type API responses
3. **Handle errors** - Always return `{ status: 'error', message }` on failure
4. **Clean up callbacks** - Remove sync callbacks when component unmounts
5. **Use rooms** - Don't broadcast to everyone, use targeted rooms
