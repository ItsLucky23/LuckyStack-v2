# create-luckystack-app

Scaffold a new [LuckyStack](https://github.com/ItsLucky23/LuckyStack-v2) project.

## Prerequisites

- Node.js 20+
- A reachable Redis instance (`REDIS_HOST` / `REDIS_PORT` in `.env.local`)
- A database supported by Prisma (MongoDB, MySQL, PostgreSQL, or SQLite). The default `prisma/schema.prisma` uses MongoDB; switch the provider before `prisma generate` if you want something else.

## Usage

```bash
npx create-luckystack-app my-app
cd my-app

# Fill in real secrets (Redis password, OAuth client IDs, etc.):
cp .env.local_template .env.local
$EDITOR .env.local

# Two terminals:
npm run server    # starts the backend
npm run client    # starts Vite
```

Open <http://localhost:5173>.

## What it generates

A starter project pre-configured with:

- The `luckystack/` overlay folder for per-package configuration (login providers, user adapter, Prisma/Redis clients, hooks).
- A recommended `prisma/schema.prisma` matching `defaultPrismaUserAdapter`.
- `config.ts`, `deploy.config.ts`, `services.config.ts` already wired up.
- `.env_template` + `.env.local_template` documenting every env var the framework reads.
- A working `server/server.ts` that calls `bootstrapLuckyStack`.
- A minimal Vite + React 19 frontend with proxy rules for `/api`, `/sync`, `/auth`, `/socket.io`, `/livez`, `/readyz`, `/_docs`.

## Options

| Flag | Default | Description |
| --- | --- | --- |
| `--no-install` | (install runs) | Skip the `npm install` after copying. |
| `--help`, `-h` | — | Show help. |

## Related architecture docs

- [`docs/DEVELOPER_GUIDE.md`](https://github.com/ItsLucky23/LuckyStack-v2/blob/master/docs/DEVELOPER_GUIDE.md) — full walkthrough after scaffolding.
- [`docs/ARCHITECTURE_PACKAGING.md`](https://github.com/ItsLucky23/LuckyStack-v2/blob/master/docs/ARCHITECTURE_PACKAGING.md) — overlay folder convention + `bootstrapLuckyStack`.

## License

MIT — see the [repository LICENSE](https://github.com/ItsLucky23/LuckyStack-v2/blob/master/LICENSE).
