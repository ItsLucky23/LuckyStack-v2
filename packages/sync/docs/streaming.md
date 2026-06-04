# streaming

> Four stream primitives are wired into a sync `_server_v{N}.ts` handler — each picks a different audience and cost profile. `_client_v{N}.ts` adds a fifth, per-recipient, primitive. The `createStreamThrottle` helper coalesces tiny pieces (LLM tokens at 3–10 chars apiece) into bigger chunks so a 1000-token response sends ~30 socket messages instead of 1000.

This doc covers the four primitives, the throttle, the recipient side, and the HTTP/SSE fallback.

For the originator-side `onStream` callback see [`./sync-request.md`](./sync-request.md). For recipient stream subscription see [`./callback-registration.md`](./callback-registration.md).

---

## 1. The four primitives — decision matrix

```
                            stream(payload)       Originator's socket only        cheapest
                            broadcastStream(p)    Every socket in `roomCode`      medium
_server_v{N}.ts param:      streamTo(tokens, p)   Selected session tokens         medium
                            (broadcastStream + streamTo fan out across ALL instances via the Redis adapter)

_client_v{N}.ts param:      stream(payload)       Per-recipient (one in the loop) cheapest per-target
```

### `stream(payload)` (server-only entry, originator-targeted)

Unicast back to the requesting socket only via `socket.emit(buildSyncProgressEventName(responseIndex), payload)`. Cheapest path — no room lookup, no per-recipient iteration. The originator consumes these via `syncRequest({ onStream })`.

Use for **per-user progress that nobody else cares about**: upload progress, search-result narrowing, "downloading models...".

### `broadcastStream(payload)`

Fanout to every socket in `roomCode`, **across all server instances** — always `io.to(roomCode).emit(...)`, which the Socket.io Redis adapter fans out cluster-wide. It does NOT inspect the local room size: the per-process room view only sees sockets on the current instance, so degrading to a per-socket unicast would silently drop members connected to other instances (see the multi-instance note below).

Use for **the entire room sees the same stream**: live AI chat tokens to a group, collab-editor diffs, multiplayer game ticks. Recipients consume via `upsertSyncEventStreamCallback`.

### `streamTo(tokens, payload)`

Selective fanout. `tokens` is one or many session tokens. Every socket joins a room named after its session token at connect time, so `io.to(tokens).emit(...)` reaches every device of every targeted user.

Use for **explicit subscribers**: "stream this only to the admin viewers", "send the heart-rate ticker only to the patient's care team", "user X just asked for a private side-stream from this same sync request".

### `_client_v{N}.ts` `stream(payload)` (per-recipient)

Inside the per-recipient loop of `handleSyncRequest`, each `_client` invocation receives a `stream` callback that emits ONLY to that one recipient. This runs **after** `_server` finishes and after the fanout loop has reached that recipient — chunks emitted here arrive at that recipient after the main `{ serverOutput, clientOutput, ... status: 'success' }` frame from `_server`, ordered.

Use for **per-recipient customization that needs to stream**: "send each viewer their own translated tokens", "throttle per-recipient based on their connection quality".

---

## 2. `createStreamThrottle({ flushEveryMs?, flushAtChars?, field? })`

Coalesces small pieces into bigger ones. Designed for LLM token streams where the provider yields 3–10 characters at a time and emitting one socket message per token is wasteful.

```ts
import { createStreamThrottle } from '@luckystack/sync';

const throttle = createStreamThrottle({
  flushEveryMs: 50,     // flush at most every 50ms (false = no timer flush)
  flushAtChars: 32,     // flush once buffered text crosses 32 chars
  field: 'chunk',       // payload key carrying the buffered text (default 'chunk')
});

for await (const piece of openaiStream) {
  throttle.push(piece.text, broadcastStream);
}
throttle.flush(broadcastStream);  // emit whatever is left after the loop ends
```

### Options

| Option | Default | Effect |
|---|---|---|
| `flushAtChars` | `32` (from `projectConfig.sync.streamThrottle.flushAtChars`) | Flush once `buffer.length >= flushAtChars`. Lower = more frequent emits = smoother UI but more network traffic. Higher = fewer emits but chunkier UI. |
| `flushEveryMs` | `50` (from config) | Timer-based flush — wakes up after Nms and emits whatever is buffered. Set to `false` to disable the timer (only flush at char threshold or explicit `flush()`). |
| `field` | `'chunk'` (from config) | Payload key carrying the buffered text. Override when your stream payload uses a different key (e.g. `'text'`, `'delta'`). |

### Returned handle

```ts
interface StreamThrottle {
  push(text: string, emit: (payload: Record<string, unknown>) => void): void;
  flush(emit: (payload: Record<string, unknown>) => void): void;
  reset(): void;  // discard buffered text without emitting — for aborts
}
```

The `emit` argument is the stream callback of your choice — `stream`, `broadcastStream`, or a partial of `streamTo`. The throttle stays agnostic of audience, which is why you pass `emit` per call instead of binding it at construction time. That lets a single throttle drive different audiences across `push` calls if you ever need it (rare).

### Why the timer is `.unref()`'d

When a `flushEveryMs` timer is scheduled, the throttle calls `timer.unref()` so a pending flush does not keep the Node.js event loop alive. This prevents short scripts and tests from hanging on a 50ms timer after the main work resolves.

### `reset()` for aborts

When the upstream LLM stream aborts (client disconnected mid-generation, generation error), call `throttle.reset()` to drop the buffered text without emitting. Forgetting to call `reset()` or `flush()` leaks the pending timer until it fires (and then emits a no-op). It's safe but noisy in logs.

---

## 3. End-to-end LLM token example

```ts
// src/chat/_sync/sendMessage_server_v1.ts
import { createStreamThrottle } from '@luckystack/sync';
import type { SessionLayout, Functions } from '@luckystack/core';

export const auth = { login: true };

export interface SyncParams {
  clientInput: { prompt: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
  broadcastStream: (payload?: Record<string, unknown>) => void;
}

export const main = async ({ clientInput, user, functions, roomCode, broadcastStream }: SyncParams) => {
  const throttle = createStreamThrottle({ flushEveryMs: 50, flushAtChars: 32 });
  let full = '';

  // 1. Mark message as in-progress for the room (so other clients show a typing indicator).
  broadcastStream({ status: 'started', author: user.id });

  // 2. Stream LLM tokens through the throttle.
  const [error, _] = await functions.tryCatch(async () => {
    for await (const piece of yourLlmStream(clientInput.prompt)) {
      full += piece.text;
      throttle.push(piece.text, broadcastStream);
    }
    throttle.flush(broadcastStream);
  });

  if (error) {
    throttle.reset();
    return { status: 'error', errorCode: 'chat.llmFailed' };
  }

  // 3. Persist the final message and emit a `done` marker.
  const message = await functions.db.message.create({ data: { authorId: user.id, body: full, roomId: roomCode } });
  broadcastStream({ status: 'done', messageId: message.id });

  return { status: 'success', messageId: message.id };
};
```

Recipients in `roomCode` see (in order):

1. `{ status: 'stream', cb, fullName, status: 'started', author }`
2. `{ status: 'stream', cb, fullName, chunk: '<32+ chars>' }` × N
3. `{ status: 'stream', cb, fullName, status: 'done', messageId }`
4. `{ status: 'success', serverOutput: { messageId }, clientOutput: {}, ... }`

The `status` field on the wire frame is always literal `'stream'` for chunks (set by `buildBroadcastFrame` in `streamEmitters.ts`); the inner `status: 'started' | 'done'` you set on the payload is a domain-level marker carried alongside `cb` and `fullName`.

---

## 4. Recipient side — consuming stream chunks

Two consumer surfaces on the client:

### A. `upsertSyncEventStreamCallback({ name, version, callback })`

The room-wide subscriber. Receives every chunk fanned out via `broadcastStream` and every chunk targeted at this socket via `streamTo`. Also receives per-recipient chunks emitted by `_client.stream(payload)`.

```ts
import { useSyncEvents } from '@luckystack/sync/client';

const { upsertSyncEventStreamCallback } = useSyncEvents();

useEffect(() => {
  return upsertSyncEventStreamCallback({
    name: 'chat/sendMessage',
    version: 'v1',
    callback: ({ stream }) => {
      if ('chunk' in stream) appendToken(stream.chunk);
      else if (stream.status === 'done') commitMessage(stream.messageId);
    },
  });
}, []);
```

The callback's `stream` parameter is typed via `SyncRouteStreamCallbackForFullName<F, V>` — TS folds together `serverStream` (from `broadcastStream` / `streamTo`) AND `clientStream` (from `_client.stream`) into a single discriminated union. If neither side ever streams, the callback type collapses to `never` and registration is a compile error.

### B. `syncRequest({ onStream })`

The originator-only listener. Subscribes to `buildSyncProgressEventName(responseIndex)` for the duration of one request. Receives ONLY chunks emitted via `stream(payload)` from `_server` (originator-targeted unicast).

```ts
await syncRequest({
  name: 'upload/processImage',
  version: 'v1',
  data: { fileId },
  receiver: tokenOfSelf,
  onStream: ({ percent }) => setProgress(percent),
});
```

Crucially, **`onStream` does NOT receive `broadcastStream` / `streamTo` chunks** — those go through `upsertSyncEventStreamCallback`. Use `onStream` for progress and partial results that are only relevant to the sender; use `upsertSyncEventStreamCallback` for everything else.

---

## 5. HTTP / SSE fallback

When a client uses the HTTP transport (`handleHttpSyncRequest`), the originator's `stream` callback is wired by `@luckystack/server` to a Server-Sent-Events writer. Each emit becomes one SSE event.

```ts
// On the server side, hooking up the SSE writer (illustrative — already done by @luckystack/server):
await handleHttpSyncRequest({
  name: 'chat/sendMessage/v1',
  data: req.body,
  receiver: roomId,
  token: extractToken(req),
  requesterIp: req.socket.remoteAddress,
  xLanguageHeader: req.headers['x-language'],
  acceptLanguageHeader: req.headers['accept-language'],
  stream: (payload) => {
    res.write(`event: stream\ndata: ${JSON.stringify(payload)}\n\n`);
  },
});
```

Public type:

```ts
export type HttpSyncStreamEvent = Record<string, unknown>;
```

Important: `broadcastStream` and `streamTo` chunks still flow over **Socket.io** even when the originator uses HTTP — recipients live on sockets regardless of how the request entered the server. Only the originator's `stream(payload)` chunks travel via SSE.

---

## 6. Performance notes

### `broadcastStream` is always a cross-instance room emit

```ts
io.to(receiver).emit(socketEventNames.sync, frame);
```

`broadcastStream` does NOT inspect local room membership. A previous "if room size <= 1, unicast to the lone socket" optimization was removed: the per-process room view only sees sockets on the LOCAL instance, so in a multi-instance cluster it dropped members connected to other instances. `io.to(room).emit(...)` lets the Redis adapter resolve the real recipients cluster-wide; `streamTo` uses the same `io.to(tokens).emit(...)` path.

### Stream-hook fire-and-forget

`preSyncStream` and `postSyncStream` hooks dispatch via `void dispatchHook(...)` — chunks never `await` the hook. Hook errors are swallowed by the hook dispatcher's own `tryCatch`. This matters because a slow Sentry breadcrumb (for example) must not delay chunk delivery to the user.

### Chunk-index counter

`postSyncStream` includes `chunkIndex` (1-based) so observers can correlate chunks within a single fanout. The counter is keyed by `(routeName, recipient)` and lives in-memory; it grows for the lifetime of the process but is bounded by the route × recipient cardinality (typically tens of thousands at most).

### Throttle math

For a 1000-token LLM response (~4000 chars), at `flushAtChars: 32` you emit ~125 messages instead of 1000 — an **8× reduction** with no perceptible UI lag. At `flushAtChars: 64` you get ~62 messages, but punctuation/whitespace can cause perceived stuttering. 32 is a good default.

---

## 7. Types reference

| Type | Where | Purpose |
|---|---|---|
| `CreateStreamThrottleOptions` | `@luckystack/sync` | Throttle constructor options. |
| `StreamThrottle` | `@luckystack/sync` | The handle returned by `createStreamThrottle`. |
| `HttpSyncStreamEvent` | `@luckystack/sync` | SSE event shape (alias of `Record<string, unknown>`). |
| `SyncRequestStreamEvent<T>` | `@luckystack/sync/client` | Payload shape passed to `onStream` (originator). |
| `SyncRouteStreamEvent<T>` | `@luckystack/sync/client` | Payload shape passed to `upsertSyncEventStreamCallback`. |
| `StreamPayload` | `@luckystack/core` | Base constraint — `Record<string, unknown>`-compatible. |

---

## 8. Cancellation (`abortSignal`) and backpressure (`flushPressure`)

Both helpers are injected into every `_server_v{N}.ts` handler alongside `stream` / `broadcastStream` / `streamTo`. Older handlers that do not destructure them still work — destructuring an extra key from a JS function param is a no-op, so the change is fully backwards compatible.

### `abortSignal: AbortSignal`

Aborts when **either** the originating client emits `syncCancel` (e.g. consumer wrote `syncRequest({ ..., signal })` and called `controller.abort()`) **or** the originator's socket disconnects.

Effects:

- Every emit through the framework's `stream` / `broadcastStream` / `streamTo` callbacks is short-circuited automatically once the signal aborts. Already-on-the-wire chunks are not unsent — there's no way to do that in Socket.io — but no new chunks will be queued.
- `flushPressure()` resolves immediately when the signal is aborted.
- The handler itself should check `abortSignal.aborted` inside long-running loops (LLM generation, DB cursor walks, file streaming) and break out — only the *emit* gate is wired automatically; the handler's own CPU work keeps going until you read the flag.

```ts
export const main = async ({ broadcastStream, abortSignal, flushPressure }: SyncParams) => {
  for await (const piece of yourLlmStream(prompt)) {
    if (abortSignal.aborted) break;        // bail on client cancel
    broadcastStream({ chunk: piece.text });
  }
  return { status: 'success' };
};
```

On the client side:

```ts
const controller = new AbortController();
const promise = syncRequest({
  name: 'chat/sendMessage',
  version: 'v1',
  data: { prompt: '...' },
  receiver: roomCode,
  signal: controller.signal,    // ← optional opt-in
});

// later — user clicked Stop:
controller.abort();
// `promise` resolves with { status: 'error', errorCode: 'request.aborted' }.
```

Same opt-in surface exists for `apiRequest({ signal })`.

### `flushPressure({ thresholdBytes? })`

Awaitable. Resolves when the worst-case Socket.io write buffer across the sockets you're streaming to drops below the threshold (default `1 MB`). Use it between large batches of small chunks so the Node.js write buffer doesn't balloon.

```ts
export const main = async ({ broadcastStream, flushPressure, abortSignal }: SyncParams) => {
  let i = 0;
  for await (const piece of yourLlmStream(prompt)) {
    if (abortSignal.aborted) break;
    broadcastStream({ chunk: piece.text });
    i++;
    //? Every 64 chunks, pause if the room is backed up. 1 MB default.
    //? Pass `thresholdBytes` to tighten or loosen the watermark.
    if (i % 64 === 0) await flushPressure();
  }
  return { status: 'success' };
};

// Tuning the threshold:
await flushPressure({ thresholdBytes: 256 * 1024 });   // pause if >= 256 KB pending
```

Notes:

- For `broadcastStream` / `streamTo`, `flushPressure` samples up to the first **32** sockets in the affected room and waits on the worst-case writer. Rooms larger than 32 trade fairness for O(1) cost.
- For originator-only `stream(payload)`, `flushPressure` polls the originator socket's engine.io write buffer. HTTP/SSE transport has no equivalent — `flushPressure` is a no-op on HTTP, since SSE backpressure is the caller's responsibility (Node's `res.write` returns `false` when full).
- Polling interval is ~10 ms; no busy-loop, no `drain` event (engine.io doesn't expose one in the public Socket.io API).
- Resolves immediately if `abortSignal` is aborted.

The same `flushPressure({ thresholdBytes? })` is also injected into `_api/<name>_v{N}.ts` handler params. There it always measures the originator socket only.

---

## 9. Related

- Originator API + `onStream`: [`./sync-request.md`](./sync-request.md)
- Recipient subscription: [`./callback-registration.md`](./callback-registration.md)
- Handler authoring (where streams come from): [`./server-vs-client-handlers.md`](./server-vs-client-handlers.md)
- Stream reconstruction demo page: [`/docs/STREAMING_RECONSTRUCTION.md`](../../../docs/STREAMING_RECONSTRUCTION.md)
- Full architecture: [`/docs/ARCHITECTURE_SYNC.md`](../../../docs/ARCHITECTURE_SYNC.md#streaming)
- Throttle config: `projectConfig.sync.streamThrottle.*`
