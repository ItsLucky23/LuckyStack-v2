# @luckystack/api

> Type-safe API request handlers for [LuckyStack](https://github.com/ItsLucky23/LuckyStack-v2). WebSocket-first via socket.io with HTTP fallback. File-based routing, generated route map, integrated rate limiting, validation, hooks, and Sentry tracing.

## Install

```bash
npm install @luckystack/api @luckystack/core @luckystack/login @luckystack/sentry socket.io
```

## Quickstart

API endpoints live in `src/{page}/_api/{name}_v{N}.ts` and are picked up by the file-based router. Each file exports `main`, plus optional metadata (`auth`, `method`, `rateLimit`).

```ts
// src/settings/_api/updateUser_v1.ts
import type { AuthProps } from '@luckystack/core';
import type { ApiResponse } from '@luckystack/core';

export const rateLimit: number | false = 20;
export const method = 'POST' as const;
export const auth: AuthProps = { login: true };

export interface ApiParams {
  data: { name: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user }: ApiParams): Promise<ApiResponse> => {
  await prisma.user.update({ where: { id: user.id }, data: { name: data.name } });
  return { status: 'success', result: { ok: true } };
};
```

The package exposes the two transport adapters that `@luckystack/server` wires into Socket.io and HTTP:

```ts
import handleApiRequest from '@luckystack/api';
import { handleHttpApiRequest } from '@luckystack/api';

io.on('connection', socket => {
  socket.on('apiRequest', (msg, ack) => handleApiRequest(socket, msg, ack));
});

httpServer.on('request', (req, res) => {
  if (req.url?.startsWith('/api/')) return handleHttpApiRequest(req, res);
});
```

You typically don't call these yourself — `createLuckyStackServer` does. Use this package directly only when building a custom transport.

## How it integrates

1. **Validates** the inbound payload against the Zod schema generated from your `ApiParams['data']` interface (via `@luckystack/devkit`).
2. **Rate-limits** by IP + token using `checkRateLimit` from `@luckystack/core`.
3. **Authenticates** via `getSession` from `@luckystack/login` when `auth.login === true`.
4. **Dispatches** the `preApiExecute` hook (may abort with a stop signal).
5. **Calls** your `main(...)` and captures errors via `tryCatch` (auto-forwarded to Sentry).
6. **Dispatches** the `postApiExecute` hook with the result + duration.
7. **Returns** the response via socket `ack` or HTTP body / SSE stream.

## Public API

| Export | Purpose |
| --- | --- |
| `handleApiRequest(socket, msg, ack)` | Socket.io request handler (default export). |
| `handleHttpApiRequest(req, res)` | HTTP fallback for `/api/*` routes; supports SSE streaming. |
| Type: `ApiHttpStreamEvent` | SSE event shape emitted by streaming endpoints. |

## Dependencies

- Runtime: `@luckystack/core`, `@luckystack/login`, `@luckystack/sentry`
- Peer: `socket.io`

## License

MIT — see [LICENSE](../../LICENSE).
