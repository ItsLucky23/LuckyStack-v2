# LuckyStack Framework Documentation

> **Quick-start documentation for developers working with LuckyStack.**

---

## Quick Links

| Document | Purpose |
|----------|---------|
| [ARCHITECTURE_API.md](./ARCHITECTURE_API.md) | API request system, types, HTTP fallback |
| [ARCHITECTURE_SYNC.md](./ARCHITECTURE_SYNC.md) | Real-time sync events, room system |
| [ARCHITECTURE_SESSION.md](./ARCHITECTURE_SESSION.md) | Session management, Redis, OAuth |
| [ARCHITECTURE_SOCKET.md](./ARCHITECTURE_SOCKET.md) | Socket.io setup, events, connection |
| [ARCHITECTURE_AUTH.md](./ARCHITECTURE_AUTH.md) | Authentication providers, login flows |
| [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md) | Getting started, common patterns |

---

## Framework Overview

LuckyStack is a **socket-first React + Node.js framework** with:

- **Type-safe APIs** - Auto-generated types from file structure
- **Real-time sync** - Room-based event broadcasting
- **Hot reload** - File watcher injects types/templates automatically
- **OAuth built-in** - Google, GitHub, Discord, Facebook, credentials
- **HTTP fallback** - RESTful API access for testing/integrations

### Architecture at a Glance

```
Client (React + Vite)          Server (Node.js + Socket.io)
┌─────────────────────┐        ┌─────────────────────────────┐
│ apiRequest()        │───────→│ handleApiRequest.ts         │
│ syncRequest()       │───────→│ handleSyncRequest.ts        │
│ socketInitializer   │◄──────→│ socket.ts                   │
└─────────────────────┘        └─────────────────────────────┘
         │                              │
         ▼                              ▼
  apiTypes.generated.ts          src/*/_api/*.ts
  (auto-generated)               src/*/_sync/*.ts
```

### Future NPM Package Vision

| Package | Contains |
|---------|----------|
| `@luckystack/core` | Socket connection, base config, hot reload |
| `@luckystack/api` | apiRequest, API handlers, HTTP fallback |
| `@luckystack/sync` | syncRequest, sync handlers, room management |
| `@luckystack/session` | SessionProvider, session CRUD, OAuth |
| `@luckystack/presence` | Activity broadcaster, socket status |
