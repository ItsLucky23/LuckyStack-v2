# @luckystack/login

> Authentication for [LuckyStack](https://github.com/ItsLucky23/LuckyStack-v2). Credentials + OAuth (Google / GitHub / Facebook / Discord), Redis-backed sessions, single-session enforcement, and lifecycle hooks (`preLogin`, `preRegister`, `preLogout`, `preSessionCreate`, `preSessionDelete` and their `post*` counterparts).

## Install

```bash
npm install @luckystack/login @luckystack/core @prisma/client socket.io
```

## Quickstart

```ts
import { loginWithCredentials, getSession, logout, registerHook } from '@luckystack/login';
import { dispatchHook } from '@luckystack/core';

// Block login for unverified users:
registerHook('preLogin', async ({ email }) => {
  const user = await prisma.user.findFirst({ where: { email } });
  if (user && !user.verified) {
    return { stop: true, errorCode: 'login.notVerified' };
  }
});

// Inside an /auth route handler:
const result = await loginWithCredentials({ email, password });
// → { status: true, reason, newToken, session } on success
// → { status: false, reason } on failure (including hook-stop with the hook's errorCode)
```

Sessions are stored in Redis under `${PROJECT_NAME}-session:<token>` and are sliding (every authenticated read extends the TTL by `ProjectConfig.session.expiryDays`).

## Hooks

`pre*` hooks fire before the side-effect and may return a `HookStopSignal` to abort. `post*` hooks fire after success. Payload types live in `./hookPayloads.ts` and are merged into `@luckystack/core`'s `HookPayloads` via module augmentation.

| Hook | Aborts | Fires from |
| --- | --- | --- |
| `preLogin` / `postLogin` | yes | `loginWithCredentials`, `loginCallback` |
| `preRegister` / `postRegister` | yes | `loginWithCredentials` (register branch), `loginCallback` (new OAuth user) |
| `preLogout` / `postLogout` | yes | `logout` |
| `preSessionCreate` / `postSessionCreate` | yes | `saveSession({ newUser: true })` |
| `preSessionDelete` / `postSessionDelete` | yes | `deleteSession` |

## Public API

| Export | Purpose |
| --- | --- |
| `loginWithCredentials(params)` | Email + password login or register. |
| `loginCallback(pathname, req, res)` | OAuth state-exchange handler — wire to `/auth/callback/<provider>`. |
| `createOAuthState(providerName)` | Issue a CSRF state token (Redis, NX, TTL from project config). |
| `oauthProviders` | Default provider list (`loginConfig`). Override by editing this in your project. |
| `saveSession(token, user, newUser?)` | Write to Redis + broadcast to existing connections. |
| `getSession(token)` | Read + slide expiration. |
| `deleteSession(token)` | Hard delete + clean up active-tokens set. |
| `getAllSessions()` | Admin utility — scans all sessions. |
| `logout({ token, socket, userId })` | End a single socket's session. |

Types: `BaseSessionLayout`, `SessionLocation`, `AuthProps` (re-exported from `@luckystack/core`); all `Pre*Payload` / `Post*Payload` types.

## Dependencies

- Runtime: `@luckystack/core`, `bcryptjs`, `validator`, `dotenv`
- Peer: `@prisma/client`, `socket.io`

Your Prisma schema must include a `User` model with at least: `id`, `email`, `provider` (enum `PROVIDERS`), `password` (nullable), `name`, `avatar`, `avatarFallback`, `admin`, `language`. See [`prisma/schema.prisma`](../../prisma/schema.prisma) for the canonical shape.

## License

MIT — see [LICENSE](../../LICENSE).
