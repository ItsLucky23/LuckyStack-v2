# ignore-self

> `ignoreSelf: true` on `syncRequest` tells `handleSyncRequest` to skip every recipient socket whose session token matches the sender's. The check is **token-based, not socket-id-based** — multi-tab users skip ALL of their own tabs. The originator's ack response still arrives.

For the full `syncRequest` signature see [`./sync-request.md`](./sync-request.md). For the fanout loop's surrounding mechanics see [`./room-fanout.md`](./room-fanout.md).

---

## 1. What the flag actually does

The originator passes `ignoreSelf: true`. Inside the per-recipient loop:

```ts
const tempToken = extractTokenFromSocket(tempSocket);

if (ignoreSelf && typeof ignoreSelf === 'boolean' && token === tempToken) {
  continue;
}

recipientCount++;
```

`token` is the sender's session token (resolved from their socket at the top of `handleSyncRequest`). `tempToken` is the recipient's session token (extracted from THAT socket via `extractTokenFromSocket`).

When the two match:

- That recipient is **not** emitted to.
- That recipient does **not** count toward `recipientCount` (so `postSyncFanout` sees a number that reflects actual sends).
- The fanout loop continues immediately to the next socket.

The originator still receives:

- The normal ack via `buildSyncResponseEventName(responseIndex)` (the success/error envelope with `serverOutput`).
- Any chunks emitted via the originator-targeted `stream(payload)` (those flow on the originator's unicast progress channel, not the broadcast room).

What the originator does NOT receive when `ignoreSelf: true`:

- The room frame (the `{ serverOutput, clientOutput, ... status: 'success' }` payload that `upsertSyncEventCallback` consumes).
- `broadcastStream` and `streamTo` chunks targeted at their own token room.

---

## 2. When to use `ignoreSelf: true`

The canonical case: **optimistic UI**. The sender already applied the local change before calling `syncRequest`, so receiving the broadcast back just causes a no-op re-render (and risks visual flicker if the local optimistic state and the broadcast payload differ subtly).

```ts
// Local update (optimistic):
setCards(prev => moveCardLocally(prev, cardId, toLane));

// Tell everyone else:
await syncRequest({
  name: 'board/moveCard',
  version: 'v1',
  data: { cardId, toLane },
  receiver: roomCode,
  ignoreSelf: true,
});
```

Other use cases:

- **Drift-tolerant counters / cursor positions / typing indicators** — the sender's state is authoritative locally; rebroadcasting to them is pure waste.
- **Chat message sends** — the sender already rendered "you said …" in the input box; the broadcast is for everyone else.
- **Acknowledgment-pattern sends** — the sender awaits the ack to know it persisted; they don't need a separate "your message arrived" frame.

---

## 3. When to leave `ignoreSelf: false` (or omit it)

Default to `false` (or just don't set it) when **the sender needs to receive the server's authoritative version** to reconcile their optimistic guess.

- **Server-assigned IDs** — the optimistic version had a temp UUID, the broadcast payload has the real DB primary key. The sender needs to listen.
- **Server-computed derived fields** — timestamps (`createdAt`), running totals (`balance`), search scores, anything the client could not have known.
- **Cross-validation refresh** — the sender wants to confirm "yes, my mutation actually landed in the shape I expected" via the broadcast.
- **Recipients are different users** — when the sender is NOT a member of the room they're sending to (e.g. an admin pushing an announcement), `ignoreSelf` is irrelevant. Leave it false.

If you're unsure, leave it `false`. Receiving an extra broadcast frame is cheap; **missing one is expensive** because you can't easily detect the absence.

---

## 4. Edge case: multiple sockets per user (tabs, devices)

`ignoreSelf` compares **session tokens**, not socket IDs. If a user has 3 tabs open:

- Tab A initiates `syncRequest({ ignoreSelf: true })`.
- Tabs A, B, and C are all in the room (they all auto-joined the `<sessionToken>` room AND any shared room they're members of).
- All three tabs share the same session token.

Result: **all three tabs skip the broadcast**, not just Tab A.

This is usually what you want — when you optimistically update a piece of state in any one tab, the framework's `SessionProvider` typically broadcasts the change to all tabs of the same user via the per-token room separately. But it's worth being aware of: `ignoreSelf` is a per-user filter, not a per-socket filter.

If you ever genuinely want "skip Tab A but notify Tabs B and C", you have to model that explicitly — either with separate logical session tokens per tab (atypical) or by leaving `ignoreSelf: false` and de-duplicating client-side.

---

## 5. Interaction with `recipientCount`

`recipientCount` is what `postSyncFanout` reports. Skipped recipients (whether via `ignoreSelf` or because the socket disappeared mid-fanout) are NOT counted.

Sample timeline:

- Room has 5 sockets, 3 of which belong to the sender's session token.
- `syncRequest({ ignoreSelf: true })` from one of the sender's sockets.
- Fanout skips all 3 of the sender's sockets.
- `recipientCount === 2`.
- `postSyncFanout` payload: `{ ..., recipientCount: 2 }`.

This makes metrics observe "actual sends", not "room size" — useful for "how many viewers did this update actually reach".

---

## 6. Interaction with streaming

`broadcastStream` and `streamTo` happen **inside** `_server`'s `main()`, BEFORE the fanout loop reaches the skip step. The skip is per-final-emit only.

Implication: a `broadcastStream` call sends chunks to **every socket in the room INCLUDING the sender's own sockets**, regardless of whether the final ack-step fanout will skip them.

If you need to exclude the sender from broadcast streaming too, use `streamTo` with an explicit list that excludes the sender's token:

```ts
// inside _server_v1.ts main()
const others = (await functions.session.getRoomMembers(roomCode)).filter(t => t !== user.id);
streamTo(others, { chunk: piece });
```

This isn't a common need — typically the sender genuinely does want to see their own LLM tokens stream because they initiated the conversation. But it's available.

---

## 7. Why the originator still gets the ack with `ignoreSelf: true`

The ack response (`buildSyncResponseEventName(responseIndex)`) is the protocol-level "your request succeeded / failed" envelope. It is **never** a fanout payload — it's a direct unicast `socket.emit` to the originator's responseIndex channel, and it carries `serverOutput` so the originator can reconcile their optimistic state with the server's authoritative version.

`ignoreSelf` only affects the **room fanout step**. The ack is wired through a separate channel that bypasses the fanout entirely.

This is critical: the originator's `syncRequest` `await` would never resolve if `ignoreSelf` suppressed the ack. The split between "broadcast payload" and "originator ack" is what makes the optimistic-UI pattern usable.

---

## 8. Quick reference

| Behavior with `ignoreSelf: true` |  |
|---|---|
| Sender's tabs skip the broadcast frame | yes |
| Sender receives ack with `serverOutput` | yes |
| Sender receives originator-targeted `stream(...)` chunks | yes |
| Sender receives `broadcastStream(...)` chunks | **yes — broadcastStream runs in `_server` before skip** |
| Sender receives `streamTo(...)` chunks (when token included) | **yes — same reason** |
| Other tabs of same user skipped too | yes — token match, not socket-id match |
| `recipientCount` counts skipped sockets | no |
| Same flag works on HTTP transport | yes — `handleHttpSyncRequest` has the same skip block |

---

## 9. Related

- Originator API: [`./sync-request.md`](./sync-request.md)
- Fanout mechanics: [`./room-fanout.md`](./room-fanout.md)
- Stream audience matrix: [`./streaming.md`](./streaming.md)
- Server handler params (`user.id` vs sender's token): [`./server-vs-client-handlers.md`](./server-vs-client-handlers.md)
