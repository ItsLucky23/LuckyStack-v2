# LuckyStack AI Quick Index

Purpose: keep default context small, and jump to the right doc for details.

## Start Here

- Project overview and conventions: `README.md`
- Deep project context: `PROJECT_CONTEXT.md`
- AI rules: `.claude/CLAUDE.md`

## Architecture Docs (authoritative)

- Routing (pages, APIs, syncs, hot reload): `docs/ARCHITECTURE_ROUTING.md`
- API request system (socket + HTTP, contracts): `docs/ARCHITECTURE_API.md`
- Sync system (room fanout, server/client handlers): `docs/ARCHITECTURE_SYNC.md`
- Socket layer (events, room helpers): `docs/ARCHITECTURE_SOCKET.md`
- Auth flows (credentials + OAuth): `docs/ARCHITECTURE_AUTH.md`
- Session storage and lifecycle: `docs/ARCHITECTURE_SESSION.md`
- Setup and daily workflow: `docs/DEVELOPER_GUIDE.md`
- Hosting and deployment: `docs/HOSTING.md`

## Function Lookup (quick map)

### Routing / Loader / Watchers

- Dev loader: `server/dev/loader.ts`
- Hot reload watchers: `server/dev/hotReload.ts`
- Type/artifact generation: `server/dev/typeMapGenerator.ts`
- Production route map generation: `scripts/generateServerRequests.ts`

### API Runtime

- Socket API handler: `server/sockets/handleApiRequest.ts`
- HTTP API handler: `server/sockets/handleHttpApiRequest.ts`
- Client API caller: `src/_sockets/apiRequest.ts`
- Error normalization + i18n: `server/utils/responseNormalizer.ts`

### Sync Runtime

- Socket sync handler: `server/sockets/handleSyncRequest.ts`
- HTTP sync trigger: `server/sockets/handleHttpSyncRequest.ts`
- Client sync caller + callbacks: `src/_sockets/syncRequest.ts`

### Auth / Session

- Credentials + OAuth callback: `server/auth/login.ts`
- OAuth provider config: `server/auth/loginConfig.ts`
- Session persistence: `server/functions/session.ts`
- Request auth validation: `server/utils/validateRequest.ts`

### Socket Server / Client

- Socket server init/events: `server/sockets/socket.ts`
- Socket client init/events: `src/_sockets/socketInitializer.ts`

## Current Contracts (important)

- API handler success: `{ status: 'success', ...payload }`
- API handler error: `{ status: 'error', errorCode, errorParams?, httpStatus? }`
- Sync handler success: `{ status: 'success', ...payload }`
- Sync handler error: `{ status: 'error', errorCode, errorParams? }`

For details/examples, use:

- `docs/ARCHITECTURE_API.md`
- `docs/ARCHITECTURE_SYNC.md`

## Working Rule

When uncertain, do not infer behavior from old snippets. Check the matching architecture doc first, then verify implementation in the linked file above.