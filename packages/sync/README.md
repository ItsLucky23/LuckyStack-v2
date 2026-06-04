# @luckystack/sync

> Real-time sync transport for [LuckyStack](https://github.com/ItsLucky23/LuckyStack-v2). Type-safe room-based fanout, server + per-client validation, streaming, optimistic offline queue. Server entry plus a browser-safe `./client` subpath for React.

## Install

```bash
npm install @luckystack/sync @luckystack/core @luckystack/login @luckystack/error-tracking react socket.io socket.io-client
```

## Quickstart

A sync event is two files (one mandatory, one optional):

```ts
// src/board/_sync/moveCard_server_v1.ts  — runs ONCE per request, validates and produces serverOutput
export const auth = { login: true };

export interface SyncParams {
  data: { cardId: string; toLane: string };
  user: SessionLayout;
  receiver: string; // room code
  functions: Functions;
}

export const main = async ({ data, user, receiver }: SyncParams) => {
  await prisma.card.update({ where: { id: data.cardId }, data: { laneId: data.toLane } });
  return { status: 'success', serverOutput: { cardId: data.cardId, movedBy: user.id } };
};
```

Add a `_client_v1.ts` only when you need per-client filtering, per-target auth, or a custom `clientOutput`. If it would just `return { status: 'success' }`, leave it out.

### Client side

```tsx
import { syncRequest, upsertSyncEventCallback } from '@luckystack/sync/client';

upsertSyncEventCallback({
  name: 'board/moveCard',
  version: 'v1',
  callback: ({ serverOutput, clientOutput }) => {
    if (serverOutput.status !== 'success') return;
    setCards(prev => moveCardLocally(prev, serverOutput.cardId));
  },
});

await syncRequest({
  name: 'board/moveCard',
  version: 'v1',
  data: { cardId, toLane },
  receiver: roomCode,
  ignoreSelf: true,
});
```

## Subpaths

- `@luckystack/sync` — server-only transport adapters (`handleSyncRequest`, `handleHttpSyncRequest`). Wired by `@luckystack/server`.
- `@luckystack/sync/client` — browser-safe hooks (`syncRequest`, `useSyncEvents`, `upsertSyncEventCallback`). React 19 required.

## How it integrates

1. **Validates** server payload, then runs `_server_v{N}.ts` once.
2. **Dispatches** the `preSyncFanout` hook (may abort).
3. **Resolves** the room receiver list, optionally running `_client_v{N}.ts` once per recipient socket for per-client filtering or auth.
4. **Emits** the merged `{ serverOutput, clientOutput }` payload to each socket.
5. **Dispatches** `postSyncFanout` with the recipient count.

## Streaming

Sync handlers receive **four** stream primitives in their `_server` params, each picking a different audience and cost profile:

| Primitive | Audience | Use when |
| --- | --- | --- |
| `stream(payload)` | Originator only (cheapest) | Per-user progress nobody else cares about |
| `broadcastStream(payload)` | Everyone in `roomCode`, across all instances (Redis adapter) | Live AI chat tokens, collab editor diffs |
| `streamTo(tokens, payload)` | Specific session tokens | Selective subscribers (admin viewers, etc.) |
| `_client_v{N}.ts` `stream(...)` | Per-recipient (after `_server` finishes) | Per-target customization (filter / translate / brand) |

Plus `createStreamThrottle({ flushEveryMs, flushAtChars })` for coalescing tiny LLM tokens into bigger chunks — cuts message count by 10–100× without losing the "live" feel.

```ts
// src/chat/_sync/sendMessage_server_v1.ts — AI chat with live broadcast
import { createStreamThrottle } from '@luckystack/sync';

export const main = async ({ clientInput, broadcastStream }: SyncParams) => {
  const throttle = createStreamThrottle({ flushEveryMs: 50, flushAtChars: 32 });

  let full = '';
  for await (const piece of openaiStream) {
    full += piece.text;
    throttle.push(piece.text, broadcastStream);
  }
  throttle.flush(broadcastStream);

  return { status: 'success', message: full };
};
```

Recipients consume both `broadcastStream` and `streamTo` chunks via the same `upsertSyncEventCallback` they already use:

```ts
upsertSyncEventCallback({
  name: 'chat/sendMessage',
  version: 'v1',
  callback: ({ stream, status }) => {
    if (status === 'stream' && stream?.chunk) appendToken(stream.chunk);
  },
});
```

Full decision tree, performance notes, and additional examples live in [`docs/ARCHITECTURE_SYNC.md`](../../docs/ARCHITECTURE_SYNC.md#streaming).

## Public API

Server entry (`@luckystack/sync`):

| Export | Purpose |
| --- | --- |
| `handleSyncRequest(socket, msg, ack)` | Socket.io sync handler (default export). |
| `handleHttpSyncRequest(req, res)` | HTTP/SSE fallback. |
| `createStreamThrottle(options)` | Coalesce small stream pieces into bigger chunks (LLM-token-friendly). |
| Type: `HttpSyncStreamEvent` | SSE event shape. |
| Type: `StreamThrottle` / `CreateStreamThrottleOptions` | Throttle helper types. |

Configure stream throttling and offline-queue policy via `registerProjectConfig({ sync, offlineQueue })`. The shapes are exported from `@luckystack/core` as **`SyncConfig`** (with nested `SyncStreamThrottleConfig`) and **`OfflineQueueConfig`** — they cover the throttle defaults, fanout iteration tuning, and the queue's max-size + drop policy (`'reject'` triggers the `offline.queueFull` error code on overflow).

Client entry (`@luckystack/sync/client`):

| Export | Purpose |
| --- | --- |
| `syncRequest(opts)` | Fire a typed sync event, optionally with `ignoreSelf` and `receiver`. |
| `upsertSyncEventCallback({ name, version, callback })` | Subscribe to inbound sync payloads. |
| `useSyncEvents(...)` | React hook for component-scoped subscriptions. |

## Related architecture docs

- [`docs/ARCHITECTURE_SYNC.md`](../../docs/ARCHITECTURE_SYNC.md) — full sync lifecycle, streaming decision tree, performance notes.
- [`docs/ARCHITECTURE_SOCKET.md`](../../docs/ARCHITECTURE_SOCKET.md) — Socket.io + Redis adapter (required for cross-instance fanout).
- [`docs/ARCHITECTURE_ROUTING.md`](../../docs/ARCHITECTURE_ROUTING.md) — `_sync/` file conventions and `_server` / `_client` split.
- [`docs/STREAMING_RECONSTRUCTION.md`](../../docs/STREAMING_RECONSTRUCTION.md) — recreating the streaming demo page.

## Dependencies

- Runtime: `@luckystack/core`, `@luckystack/login`, `@luckystack/error-tracking`
- Peer (canonical ranges, standardized 2026-05-07):
  - `@prisma/client@^6.19.0` (transitively required via `@luckystack/core`)
  - `react@^19.2.0` (`/client` entry only)
  - `socket.io@^4.8.0`
  - `socket.io-client@^4.8.0`

## License

MIT — see [LICENSE](../../LICENSE).
