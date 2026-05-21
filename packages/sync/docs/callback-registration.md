# callback-registration

> How recipients subscribe to sync events on the client. Covers `useSyncEvents` (the React hook for component-scoped callbacks), the `upsertSyncEventCallback` / `upsertSyncEventStreamCallback` registration APIs, `useSyncEventTrigger` (manual local fire for testing), and `initSyncRequest` (one-time wiring of socket lifecycle handlers to the socket-status provider).

For the originator side see [`./sync-request.md`](./sync-request.md). For streaming payload shapes see [`./streaming.md`](./streaming.md).

---

## 1. `useSyncEvents()` — the component-scoped hook

```ts
import { useSyncEvents } from '@luckystack/sync/client';

const { upsertSyncEventCallback, upsertSyncEventStreamCallback } = useSyncEvents();
```

Returns two stable (`useCallback`-wrapped) registrar functions. The hook also installs a cleanup `useEffect` that removes every callback registered through this hook instance on unmount.

Key properties:

- **Component-scoped local registry.** Each `useSyncEvents()` call holds its own `Map<fullName, Callback>` so the cleanup effect only removes callbacks added by that component, not callbacks other components registered for the same route.
- **Automatic deduplication of same-key re-registration.** Calling `upsertSyncEventCallback` twice with the same name+version from the same component replaces the previous callback (idempotent). Calling it from different components adds independent entries.
- **`useCallback`-stable identity.** The registrar functions don't change identity between renders, so dependency arrays (`useEffect(..., [upsertSyncEventCallback])`) don't churn.

### Typical usage

```tsx
import { useEffect } from 'react';
import { useSyncEvents } from '@luckystack/sync/client';

export const BoardSubscriber = () => {
  const { upsertSyncEventCallback } = useSyncEvents();

  useEffect(() => {
    const unsubscribe = upsertSyncEventCallback({
      name: 'board/moveCard',
      version: 'v1',
      callback: ({ serverOutput, clientOutput }) => {
        if (serverOutput.status !== 'success') return;
        setCards(prev => moveCardLocally(prev, serverOutput.cardId));
      },
    });
    return unsubscribe;
  }, [upsertSyncEventCallback]);

  return null;
};
```

The returned `unsubscribe` lets you cancel before the component unmounts — useful when the subscription is conditional on props or routing.

---

## 2. `upsertSyncEventCallback({ name, version, callback })`

Subscribes to **non-stream** sync payloads — the `{ serverOutput, clientOutput, status: 'success' }` frames that `handleSyncRequest` emits at the end of the per-recipient loop.

```ts
upsertSyncEventCallback<F, V>(params: {
  name: F;                                     // SyncFullName literal, typed
  version: V;                                  // VersionsForFullName<F> literal
  callback: ({
    clientOutput: ClientOutputForFullName<F, V>,
    serverOutput: ServerOutputForFullName<F, V>,
  }) => void;
}): () => void  // returns unsubscribe function
```

### Typed payloads (rule 16, no casts)

Both `clientOutput` and `serverOutput` are typed via the generated `SyncTypeMap`. The framework's discriminated unions surface every possible status:

```ts
upsertSyncEventCallback({
  name: 'board/moveCard',
  version: 'v1',
  callback: ({ serverOutput, clientOutput }) => {
    // serverOutput is the typed union (success | error variants) from the generated map.
    if (serverOutput.status !== 'success') return;
    // After the narrowing, TS knows the success-shape fields are available.
    console.log(serverOutput.cardId, serverOutput.movedBy);
  },
});
```

Never cast these to `unknown` or `any` (root `CLAUDE.md` rule 16). If inference fails, regenerate the type map (`npm run ai:index`) — that's the source of truth.

### Validation rules

`upsertSyncEventCallback` rejects (returns the `noop` unsubscriber, logs in dev mode) when:

- `params.version` isn't a string -> `sync.invalidVersion`.
- `params.callback` isn't a function -> `sync.invalidCallback`.
- `params.name` isn't a valid service route name -> `routing.invalidServiceRouteName`.

These are dev-time guards. In production the runtime errors surface only if generated types are mis-applied at the call site.

### Multiple components subscribing to the same route

Supported and intentional. Each component's registrar pushes a separate callback into the route's array; `triggerSyncCallbacks` iterates and fires each. Cleanup is per-callback — unmounting Component A doesn't affect Component B's subscription.

### Duplicate callback handling (same reference)

If the **exact same callback function reference** is registered twice (rare — usually a bug where `useEffect` runs without dependency-checking), the registrar warns in dev mode and ignores the second add. The local registry still tracks the callback so the cleanup works. This guards against runaway callback arrays without breaking legitimate multi-component subscriptions.

---

## 3. `upsertSyncEventStreamCallback({ name, version, callback })`

Subscribes to **stream chunks** — the `{ status: 'stream', cb, fullName, ...payload }` frames emitted via `broadcastStream`, `streamTo`, or `_client.stream(...)`.

```ts
upsertSyncEventStreamCallback<F, V>(params: {
  name: F;
  version: V;
  callback: ({ stream }: { stream: SyncRouteStreamEvent<...> }) => void;
}): () => void
```

The `stream` parameter type is the union of:

- The route's `serverStream` type (from `broadcastStream` and `streamTo` payloads).
- The route's `clientStream` type (from per-recipient `_client.stream(payload)`).

If neither side ever streams, the callback type collapses to `never` and TS rejects the registration call at compile time — a compile-time guarantee that you can't subscribe to a non-streaming route.

```ts
upsertSyncEventStreamCallback({
  name: 'chat/sendMessage',
  version: 'v1',
  callback: ({ stream }) => {
    if ('chunk' in stream) appendToken(stream.chunk);
    else if (stream.status === 'started') showTypingIndicator(stream.author);
    else if (stream.status === 'done') hideTypingIndicator();
  },
});
```

Stream callbacks run for **every chunk** of every fanout to this recipient — there is no per-request scoping. Use `onStream` on `syncRequest` instead when you want per-request scoping for originator-targeted chunks.

The same dedup / multi-subscriber / unsubscribe semantics from `upsertSyncEventCallback` apply.

---

## 4. `useSyncEventTrigger()` — manual local fire

```ts
const { triggerSyncEvent, triggerSyncStreamEvent } = useSyncEventTrigger();

triggerSyncEvent('sync/board/moveCard/v1', { /* clientOutput */ }, { /* serverOutput */ });
triggerSyncStreamEvent('sync/board/moveCard/v1', { chunk: 'partial' });
```

Bypasses the wire entirely. The framework's internal `triggerSyncCallbacks` / `triggerSyncStreamCallbacks` are called directly, firing every registered subscriber as if the payload had arrived from the server.

Use cases:

- **Local testing** — fire a fake payload to verify your UI subscriber works without spinning up the server pipeline.
- **Optimistic local echo** — apply a payload to your own UI without sending it through the network (rare — usually optimistic UI just mutates local state directly, no need to round-trip the sync system).
- **Storybook / fixtures** — drive subscriber components with deterministic payloads.

The argument names are different from the wire format:

- First argument: the **full route name** (`sync/<page>/<name>/v<N>`). The `sync/` prefix is part of the internal routing key.
- Second argument: `clientOutput`.
- Third argument: `serverOutput`.

Note: the parameter order is `(name, clientOutput, serverOutput)` — opposite of what you might expect from reading the wire frame, which lists `serverOutput` first. The internal callback signature is `{ clientOutput, serverOutput }` (object) but the trigger helper passes positionally for ergonomics.

---

## 5. `initSyncRequest({ setSocketStatus, sessionRef })`

One-time wiring of socket lifecycle events to a status setter. Called at app boot from `SocketStatusProvider`. Not consumed by app code directly.

```ts
initSyncRequest({
  setSocketStatus,    // Dispatch from useState<{ self, [userId]: statusContent }>
  sessionRef,         // RefObject<SessionLayout | null>
});
```

Wires the following Socket.io events:

| Socket event | Action |
|---|---|
| `connect` | `setSocketStatus(prev => ({ ...prev, self: { ...self, status: 'CONNECTED' } }))` |
| `disconnect` | `setSocketStatus(prev => ({ ...prev, self: { ...self, status: 'DISCONNECTED' } }))` |
| `reconnectAttempt(attempt)` | Status `'RECONNECTING'` with `reconnectAttempt` set to the attempt number. |
| `userAfk({ userId, endTime })` | If `userId === session.id`, mark `self` disconnected with `endTime`. Otherwise mark the user as disconnected in the per-user map. |
| `userBack({ userId })` | Mark the user as `'CONNECTED'`, clear `endTime`. |
| `connect_error(err)` | Mark `self` disconnected, log + notify in dev mode. |

Idempotent: if `initSyncRequest` is called again later, the previous handlers are removed before new ones are attached (the module holds `activeLifecycleHandlers` for this). Safe to call across hot-reloads.

`sessionRef` is a `RefObject` (not a value) because the handlers must always read the **current** session at event-firing time, not the session at handler-construction time. Without the ref, a logout followed by a `userAfk` event would still treat the AFK as if it belonged to the old user.

---

## 6. Why callbacks must never cast `serverOutput` / `clientOutput`

Rule 16 in the repo root `CLAUDE.md`: generated types are mandatory; no `unknown` / `any` casts on typed transports.

Both `upsertSyncEventCallback` and `upsertSyncEventStreamCallback` give you fully typed payloads via the generated `SyncTypeMap`. The framework's discriminated unions handle the status branching cleanly:

```ts
// GOOD — uses the generated discriminated union
callback: ({ serverOutput }) => {
  if (serverOutput.status !== 'success') return;
  console.log(serverOutput.cardId);   // typed
}

// BAD — defeats inference, breaks contract evolution
callback: ({ serverOutput }: any) => {
  console.log((serverOutput as { cardId: string }).cardId);
}

// BAD — same problem, different syntax
const data = serverOutput as unknown as { cardId: string };
```

When inference fails:

1. Regenerate the type map: `npm run ai:index`.
2. Verify the `_server_v{N}.ts` return type is well-typed (no `any` in the return path).
3. If you still hit a wall, fix the typing source — don't paper over with casts at the call site.

---

## 7. Subscription cleanup checklist

- `useSyncEvents()` auto-cleans on component unmount (via `useEffect` cleanup). For most cases, just call the registrars in a `useEffect` and return their unsubscribers. That's belt-and-suspenders but cheap.
- Calling `upsertSyncEventCallback` outside React (e.g. from a `_provider` module-level subscribe) means you own the cleanup. Save the returned function and call it on teardown.
- Re-registering with the same name+version from the same component (same `useSyncEvents()` instance) replaces the previous callback — no leak.
- Re-registering from a **different** component adds an independent entry — both fire.

---

## 8. Quick reference

| API | Purpose | Scope |
|---|---|---|
| `useSyncEvents()` | React hook returning `{ upsertSyncEventCallback, upsertSyncEventStreamCallback }` | Component lifetime — auto-clean on unmount |
| `upsertSyncEventCallback({ name, version, callback })` | Subscribe to `{ serverOutput, clientOutput }` frames | Returns unsubscribe |
| `upsertSyncEventStreamCallback({ name, version, callback })` | Subscribe to stream chunks (`broadcastStream`, `streamTo`, `_client.stream`) | Returns unsubscribe |
| `useSyncEventTrigger()` | React hook returning `{ triggerSyncEvent, triggerSyncStreamEvent }` for local fire | Component-stable identity |
| `initSyncRequest({ setSocketStatus, sessionRef })` | One-time wire-up of socket lifecycle to status provider | App boot |

---

## 9. Related

- Originator API: [`./sync-request.md`](./sync-request.md)
- Stream payload shapes: [`./streaming.md`](./streaming.md)
- Server / client handler contracts (what produces the payloads): [`./server-vs-client-handlers.md`](./server-vs-client-handlers.md)
- Type-generation contract (rule 16): repo root [`.claude/CLAUDE.md`](../../../.claude/CLAUDE.md)
- `SocketStatusProvider` wiring: `src/_providers/SocketStatusProvider.tsx` (installer side)
