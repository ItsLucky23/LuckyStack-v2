# {{PROJECT_TITLE}}

Generated with [`create-luckystack-app`](https://github.com/ItsLucky23/LuckyStack-v2).

## Get started

```bash
cp .env_template .env
cp .env.local_template .env.local
# Edit .env.local with your DATABASE_URL and (optional) OAuth secrets

npm run prisma:generate
npm run prisma:migrate:dev   # creates the User table

# In one terminal — backend (HTTP + Socket.io):
npm run server

# In another terminal — frontend (Vite, with proxy to the backend):
npm run client
```

Open <http://localhost:5173>.

## Where things live

| Path | What it is |
| --- | --- |
| `config.ts` | Project-wide framework config (CORS, session, logging, ...) |
| `deploy.config.ts` | Resource topology (Redis, Mongo) |
| `services.config.ts` | Service / preset definitions for multi-instance deploys |
| `luckystack/login/oauthProviders.ts` | Enabled OAuth providers |
| `luckystack/login/userAdapter.ts` | How auth flows look up / create users |
| `luckystack/core/clients.ts` | Override Prisma / Redis clients (TLS, Accelerate, ...) |
| `luckystack/server/index.ts` | Hook registrations + `customRoutes` mounts |
| `prisma/schema.prisma` | Database schema |
| `server/server.ts` | Server entry — usually no need to edit |
| `src/<page>/page.tsx` | Pages (file-based routing) |
| `src/<page>/_api/<name>_v1.ts` | API endpoints |
| `src/<page>/_sync/<name>_server_v1.ts` | Sync events |

## Docs

Full docs: <https://github.com/ItsLucky23/LuckyStack-v2#readme>
