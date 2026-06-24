# @luckystack/api

> Type-safe API request handlers for [LuckyStack](https://github.com/ItsLucky23/LuckyStack-v2). WebSocket-first via socket.io with HTTP fallback. File-based routing, generated route map, integrated rate limiting, validation, hooks, and error-tracking tracing.

## Install

```bash
npm install @luckystack/api @luckystack/core @luckystack/error-tracking socket.io
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
  socket.on('apiRequest', msg => handleApiRequest({ msg, socket, token }));
});

httpServer.on('request', async (req, res) => {
  if (req.url?.startsWith('/api/')) {
    const result = await handleHttpApiRequest({ name: body.name, data: body.data, token });
    res.end(JSON.stringify(result));
  }
});
```

You typically don't call these yourself — `createLuckyStackServer` does. Use this package directly only when building a custom transport.

## How it integrates

1. **Validates** the inbound payload against the Zod schema generated from your `ApiParams['data']` interface (via `@luckystack/devkit`).
2. **Rate-limits** by IP + token using `checkRateLimit` from `@luckystack/core`.
3. **Authenticates** via `readSession` from `@luckystack/core` (the session-provider registry; `@luckystack/login` is the optional default provider, not a hard dependency) when `auth.login === true`.
4. **Dispatches** the `preApiExecute` hook (may abort with a stop signal).
5. **Calls** your `main(...)` and captures errors via `tryCatch` (auto-forwarded to Sentry).
6. **Dispatches** the `postApiExecute` hook with the result + duration.
7. **Returns** the response via socket `ack` or HTTP body / SSE stream.

## Generated types

`apiRequest` (in `@luckystack/core/client`) is fully typed against the route map emitted by `@luckystack/devkit` from your `_api/*` files (default location: `src/_sockets/apiTypes.generated.ts`). Use route-name + version literals so inference works:

```ts
const result = await apiRequest({
  name: 'settings/updateUser',
  version: 'v1',
  data: { name: 'Alice' },
});

if (result.status === 'success') {
  // result is typed from the matching `main` return type.
}
```

Do not wrap `apiRequest` in `unknown` / `any` shims (see `.claude/CLAUDE.md` rule 16). If inference fails, fix the typing source or regenerate maps instead.

## Public API

| Export | Purpose |
| --- | --- |
| `handleApiRequest({ msg, socket, token })` | Socket.io request handler (default export). |
| `handleHttpApiRequest({ name, data, token, ... })` | HTTP fallback for `/api/*` routes; returns `Promise<ApiNetworkResponse>` and supports SSE streaming via a `stream` callback. |
| Type: `ApiHttpStreamEvent` | SSE event shape emitted by streaming endpoints. |

## Related architecture docs

- [`docs/ARCHITECTURE_API.md`](../../docs/ARCHITECTURE_API.md) — full request lifecycle, streaming, error contract.
- [`docs/ARCHITECTURE_ROUTING.md`](../../docs/ARCHITECTURE_ROUTING.md) — `_api/` file conventions and method inference.

## Dependencies

- Runtime: `@luckystack/core`, `@luckystack/error-tracking` (`@luckystack/login` is NOT a runtime dependency — sessions resolve through core's session-provider registry; login is the optional default provider)
- Peer (canonical ranges, standardized 2026-05-07):
  - `@prisma/client@^6.19.0` (transitively required via `@luckystack/core`)
  - `socket.io@^4.8.0`

## License

MIT — see [LICENSE](../../LICENSE).
