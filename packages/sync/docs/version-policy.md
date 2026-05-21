# version-policy

> Every sync route is keyed by a string-literal `version` (`'v1'`, `'v2'`, ...). Versions live in the **filename** (`{name}_server_v{N}.ts` / `{name}_client_v{N}.ts`), travel as part of the wire route key (`sync/<page>/<name>/v<N>`), and are exposed to TypeScript via the generated `SyncTypeMap` so `syncRequest` and `upsertSyncEventCallback` enforce them at compile time. Adding a `v2` never replaces `v1` — both files coexist on disk and both versions resolve independently at runtime. This is how the framework lets you ship a breaking change to one set of consumers while older clients keep working unchanged.

For the originator-side call signature see [`./sync-request.md`](./sync-request.md). For the handler files see [`./server-vs-client-handlers.md`](./server-vs-client-handlers.md).

---

## 1. Why versions are mandatory string literals

`syncRequest` and `upsertSyncEventCallback` both require `version` as a string-literal property:

```ts
await syncRequest({
  name: 'board/moveCard',
  version: 'v1',                // <- string literal, required
  data: { cardId, toLane },
  receiver: roomCode,
});
```

The type system traces it back through the generated map:

```
SyncTypeMap (generated from _sync files)
  -> SyncRouteRecord (page/name -> version -> shape map)
  -> SyncFullName  = keyof SyncRouteRecord
  -> VersionsForFullName<F> = Extract<keyof SyncRouteRecord[F], string>
  -> ClientInputForFullName / ServerOutputForFullName / ClientOutputForFullName / *Stream
```

In `packages/sync/src/syncRequest.ts`:

```ts
type SyncRouteRecord = UnionToIntersection<{
  [P in keyof SyncTypeMap]: {
    [N in keyof SyncTypeMap[P] as P extends 'root'
      ? `system/${Extract<N, string>}`
      : `${Extract<P, string>}/${Extract<N, string>}`]: SyncTypeMap[P][N]
  }
}[keyof SyncTypeMap]>;

type SyncFullName = Extract<keyof SyncRouteRecord, string>;
type VersionsForFullName<F extends SyncFullName> = Extract<keyof SyncRouteRecord[F], string>;
```

Three consequences:

1. **No `version` argument means no compile.** TypeScript can't pick a payload shape if it doesn't know which version's `clientInput` / `serverOutput` to use.
2. **A typo in `version` is a compile error.** `version: 'v2'` against a route that only has `v1` widens `VersionsForFullName<F>` to a union that excludes `'v2'`, so the literal fails the constraint.
3. **`data`, `serverOutput`, `clientOutput`, and stream payloads are all version-scoped.** A `v1` consumer cannot accidentally read the `v2` shape because the type for that branch is inferred per `(name, version)` pair.

Why **strings** not numbers: string-literal types narrow under TS template literals (`` `${Extract<N, string>}/${Extract<V, string>}` ``). Number literals don't compose cleanly into route keys (`sync/board/moveCard/1` looks wrong on the wire and would lose the "v" prefix everyone expects). Filename + wire format + map keys all agree on `v{N}`.

---

## 2. File-naming convention

A sync route version lives in one file per side:

```
src/{page}/_sync/{name}_server_v{N}.ts   <- required when v{N} should run server logic
src/{page}/_sync/{name}_client_v{N}.ts   <- optional per-recipient overlay
```

Concrete examples:

```
src/board/_sync/moveCard_server_v1.ts            <- moveCard, v1
src/board/_sync/moveCard_server_v2.ts            <- moveCard, v2 (lives alongside v1)
src/board/_sync/moveCard_client_v2.ts            <- v2 added a per-recipient filter; v1 still has no client file
src/chat/_sync/sendMessage_server_v1.ts          <- chat/sendMessage, v1 only
src/test/nestedTest/_sync/room_server_v1.ts      <- nested page, route = 'test/nestedTest/room'
```

The dev loader (`@luckystack/devkit`'s scanner, see `/docs/ARCHITECTURE_ROUTING.md`) walks `src/` and registers every file matching `_(server|client)_v\d+\.ts$` inside an `_sync` folder. The runtime map key is `${page}/${name}/v${N}_(server|client)` so the two sides for the same `(name, version)` are paired by the route layer.

In `handleSyncRequest`, the wire key gets composed from the parsed route name + the literal version:

```ts
// fullName carried on the wire: 'sync/<page>/<name>/v<N>'
const fullName = `sync/${sanitizedName}/${version}`;
```

Both versions of `moveCard` coexist on the same server with separate map entries: `board/moveCard/v1_server` and `board/moveCard/v2_server`. Picking the right one is purely a function of what `version` the originator sent.

---

## 3. Adding `v2` without breaking `v1`

The framework explicitly supports running multiple versions of the same route side-by-side. The migration flow:

### Step 1 — Author `v2` files alongside `v1`

```
src/board/_sync/moveCard_server_v1.ts        <- unchanged, keep shipping
src/board/_sync/moveCard_server_v2.ts        <- new shape, new contract
```

Both files export their own `main`, their own `SyncParams`, and (in `_server`) their own `auth`. The runtime treats them as fully independent handlers — there is no shared state, no fallthrough, no `version: 'latest'` sentinel.

### Step 2 — Regenerate the type map

```
npm run ai:index
```

The generated `SyncTypeMap` now carries a `{ v1, v2 }` key set for `board/moveCard`. Both `syncRequest({ name: 'board/moveCard', version: 'v1', ... })` and `version: 'v2'` typecheck; each gets its version-specific `data` / response inference.

### Step 3 — Migrate consumers at their own pace

```ts
// Old caller — still compiles, still works against the original _server_v1.ts.
await syncRequest({
  name: 'board/moveCard',
  version: 'v1',
  data: { cardId, toLane },
  receiver: roomCode,
});

// New caller — typechecks against the new shape.
await syncRequest({
  name: 'board/moveCard',
  version: 'v2',
  data: { cardId, toLane, expectedRevision },
  receiver: roomCode,
});
```

Subscriber side is the same — two `upsertSyncEventCallback` registrations for `(name, v1)` and `(name, v2)` if you need both, or just the new one if the page is fully migrated.

### Step 4 — When **every** consumer is on `v2`, delete `v1`

Only after you have ground-truth evidence that no client emits or subscribes to `v1` should the `_server_v1.ts` / `_client_v1.ts` files be removed. Removing earlier breaks any straggler client (stale browser tab, mobile app waiting on app-store review, third-party integration) immediately with `sync.notFound`.

The framework has no built-in usage telemetry for this. Project-level options:

- Log `routeName` in the `preSyncFanout` hook with the version segment parsed, ship to your analytics, watch the `v1` line trend to zero.
- Add a `preSyncAuthorize` hook that warns once per unique session token when `v1` traffic arrives.
- Gate the deletion behind a release that's been live long enough to flush any stale clients (typically 1–2 release cycles for web SPAs, several weeks for native apps).

---

## 4. Why AI must NEVER hot-replace a version in place

In-place edits to `_server_v1.ts` / `_client_v1.ts` are reserved for **bug fixes that do not change the contract**. The contract is the shape of `clientInput` (request), the shape of `serverOutput` and `clientOutput` (responses), and any emitted stream payload shape (`serverStream` / `clientStream`).

A change is **breaking** if any of the following move:

- `clientInput` gains a required field, removes a field, or narrows a field's type.
- `serverOutput` removes a field, renames a field, narrows a literal, or changes the `status` union.
- `clientOutput` does any of the above.
- `serverStream` / `clientStream` payload shape changes — recipients consuming the stream channel will silently break.
- `auth` becomes stricter (`login: false` -> `true`, new `additional` predicates rejecting previously-allowed users).

For any of these, **add a `v{N+1}` file**. Leave `v1` alone. The cost of a duplicate file is trivial; the cost of breaking deployed clients during a rolling release is not.

Bug fixes that **are** allowed in-place on an existing version:

- Database query optimization that returns the same shape.
- Adding a new optional field to `serverOutput` (additive, not breaking — existing consumers ignore it).
- Tightening server-side validation in a way that previously-accepted-but-illegitimate inputs are now rejected (security fix).
- Internal refactors of the handler body that preserve the inferred return type.

If in doubt: bump the version. The framework was designed around the assumption that versions are cheap.

---

## 5. Shape evolution rules per version

Within a single version, every shape is independent and unaffected by other versions. Across versions, you have full freedom — but recognize that **shapes are inferred, not declared**, so a change to the file's return type is automatically a change to the generated map type. There is no separate version manifest.

| Shape | Source | Where the shape change shows up |
|---|---|---|
| `clientInput` | `_server`'s `SyncParams.clientInput` (or the equivalent interface) | `data` argument on `syncRequest({ name, version, data })` |
| `serverOutput` | `_server`'s `main(...)` return value (minus `status`) | `result` on the originator's response envelope, `serverOutput` on recipient callbacks |
| `clientOutput` | `_client`'s `main(...)` return value (minus `status`), or `{}` if no `_client` file | `clientOutput` on recipient callbacks |
| `serverStream` | Inferred from `stream` / `broadcastStream` / `streamTo` call sites in `_server`'s `main` | `onStream` callback typing, `upsertSyncEventStreamCallback` union |
| `clientStream` | Inferred from `stream` call sites in `_client`'s `main` | `upsertSyncEventStreamCallback` union |

A stage that never streams (no call sites in `main`) collapses its stream type to `never`. The consumer-side callback (`onStream` or `upsertSyncEventStreamCallback`) then refuses to compile if you try to subscribe — preventing dead listeners.

Practical consequence: adding `broadcastStream({ chunk })` to `_server_v1.ts` after `v1` consumers already exist *widens* their `serverStream` to a non-`never` shape — this is **non-breaking** for existing `upsertSyncEventCallback` subscribers (they don't care about stream payloads), but it *does* enable new `upsertSyncEventStreamCallback` registrations. Removing the only stream call site in `_server` later collapses `serverStream` back to `never` and *will* break any registered stream subscriber at compile time on next type-map regeneration. Bump the version when in doubt.

---

## 6. Interaction with Zod input schemas (`apiInputSchemas.generated.ts`)

`@luckystack/devkit` extracts `clientInput` from each `_server_v{N}.ts` via the type-map emitter and generates a Zod schema **per route per version**. The runtime calls `validateInputByType({ typeText, value, rootKey, filePath })` against the route's specific schema during `handleSyncRequest`.

Implication:

- `v1` and `v2` have **independent** Zod schemas. Tightening validation in `v2` does not affect `v1` traffic.
- Renaming a field in `v2`'s `clientInput` means `v2`'s generated schema rejects the old field name; `v1`'s schema is unaffected.
- The schema file (`src/_sockets/apiInputSchemas.generated.ts`) regenerates on type-map runs. Don't hand-edit it — the regenerator overwrites.

---

## 7. Wire-format and runtime key reference

| Layer | Format | Example |
|---|---|---|
| Filename | `{name}_(server\|client)_v{N}.ts` | `moveCard_server_v2.ts` |
| Route in `syncRequest` | `'<page>/<name>'` + `version: 'v{N}'` | `name: 'board/moveCard', version: 'v2'` |
| Wire `name` (Socket.io emit) | `'sync/<page>/<name>/v{N}'` | `'sync/board/moveCard/v2'` |
| Wire `cb` (callback handle) | `'<page>/<name>/v{N}'` | `'board/moveCard/v2'` |
| Runtime map key (server side) | `'<page>/<name>/v{N}_(server\|client)'` | `'board/moveCard/v2_server'` |
| Recipient subscription key | `'sync/<page>/<name>/v{N}'` (internal) | `'sync/board/moveCard/v2'` |
| Root-level sync | `'system/<name>'` -> `'sync/system/<name>/v{N}'` | `'system/heartbeat'` -> `'sync/system/heartbeat/v1'` |

The five fragments above all carry the same `v{N}` segment. If you ever see a route key without it, that's a bug — the version is part of every layer of the routing.

---

## 8. Worked example — shipping a breaking change

Initial state:

```ts
// src/board/_sync/moveCard_server_v1.ts
export const auth = { login: true };
export interface SyncParams {
  clientInput: { cardId: string; toLane: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}
export const main = async ({ clientInput, functions }: SyncParams) => {
  await functions.db.card.update({ where: { id: clientInput.cardId }, data: { laneId: clientInput.toLane } });
  return { status: 'success', cardId: clientInput.cardId };
};
```

We want to add optimistic-locking with `expectedRevision`. That's a **new required field on `clientInput`** -> breaking change -> new version.

Step 1: copy + edit:

```ts
// src/board/_sync/moveCard_server_v2.ts
export const auth = { login: true };
export interface SyncParams {
  clientInput: { cardId: string; toLane: string; expectedRevision: number };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}
export const main = async ({ clientInput, functions }: SyncParams) => {
  const card = await functions.db.card.findUnique({ where: { id: clientInput.cardId } });
  if (!card) return { status: 'error', errorCode: 'board.cardNotFound' };
  if (card.revision !== clientInput.expectedRevision) {
    return { status: 'error', errorCode: 'board.staleRevision' };
  }
  await functions.db.card.update({
    where: { id: clientInput.cardId },
    data: { laneId: clientInput.toLane, revision: card.revision + 1 },
  });
  return { status: 'success', cardId: clientInput.cardId, revision: card.revision + 1 };
};
```

Step 2: regenerate the type map. New caller can typecheck against `v2`; old caller stays on `v1`.

Step 3: migrate caller code branch-by-branch:

```ts
// New code path uses v2:
const response = await syncRequest({
  name: 'board/moveCard',
  version: 'v2',
  data: { cardId, toLane, expectedRevision: localCard.revision },
  receiver: roomCode,
});

if (response.status === 'error' && response.errorCode === 'board.staleRevision') {
  // Resolve drift via a refetch flow.
}
```

Step 4: after every code path is migrated and the analytics show zero `v1` traffic, delete `moveCard_server_v1.ts`. Regenerate the type map again — `version: 'v1'` becomes a compile error everywhere it lingers, and you fix or remove those call sites.

---

## 9. Anti-patterns

### Anti-pattern: mutating `v1`'s contract in place

```ts
// BAD — clientInput gains a required field on v1.
// Every existing client sending {cardId, toLane} now fails with sync.invalidInputType.
export interface SyncParams {
  clientInput: { cardId: string; toLane: string; expectedRevision: number };
  ...
}
```

Fix: add `v2` instead.

### Anti-pattern: faking versioning by branching inside `main`

```ts
// BAD — the route reports a single shape to the type map but branches at runtime.
export const main = async ({ clientInput }: SyncParams) => {
  if ('expectedRevision' in clientInput) { /* new behavior */ }
  else { /* legacy behavior */ }
  ...
};
```

Fix: separate files, separate versions. The point of versioning is *static* enforcement so consumers can't mix the two shapes.

### Anti-pattern: bumping version for non-breaking changes

```ts
// BAD — added a logger, bumped to v2 anyway.
```

Fix: in-place edit `v1`. The contract did not change; consumers do not need to migrate.

### Anti-pattern: skipping versions (`v1` -> `v3`)

```ts
// BAD — file is named _server_v3.ts but there is no v2.
```

Allowed by the framework (it just maps `v3` to its own entry), but confusing for humans. Use sequential numbers (`v1`, `v2`, `v3`) unless you have a reason not to.

### Anti-pattern: casting at the call site to "fix" a missing version literal

```ts
// BAD — defeats the entire version inference chain.
await syncRequest({ name: 'board/moveCard' as any, version: someString as any, ... });
```

This violates rule 16 (no `as any` / `as unknown` on typed transports). If you don't know the version statically, the design needs to change — versions are an authoring-time decision, not a runtime one.

---

## 10. Quick reference

| Action | Version policy |
|---|---|
| Fixing a bug that doesn't change shapes | Edit existing version in place. |
| Adding an optional field to `serverOutput` | Edit existing version in place (additive). |
| Adding a required field to `clientInput` | New version (`v{N+1}`). |
| Removing a field from `serverOutput` / `clientOutput` | New version. |
| Renaming a field anywhere in the contract | New version. |
| Tightening `auth.login` from `false` to `true` | New version. |
| Adding new stream emitter (when previously stream was `never`) | New version recommended (subscriber type widens — non-breaking now, but breaks if you ever remove it again). |
| Deleting an unused version | After confirming zero traffic, remove both `_server_v{N}.ts` and `_client_v{N}.ts`, then regenerate the type map. |

---

## 11. Related

- File-based routing (sync sections): [`/docs/ARCHITECTURE_ROUTING.md`](../../../docs/ARCHITECTURE_ROUTING.md#sync-routing)
- Originator call signature: [`./sync-request.md`](./sync-request.md)
- Server / client handler authoring: [`./server-vs-client-handlers.md`](./server-vs-client-handlers.md)
- Streaming shape inference: [`./streaming.md`](./streaming.md) §7
- Recipient subscription: [`./callback-registration.md`](./callback-registration.md)
- Error contract (including `sync.invalidInputType` from regenerated Zod schemas): [`./error-states.md`](./error-states.md)
- Type-map regeneration: `npm run ai:index` (`@luckystack/devkit`)
- Sync type contract: rule 16 in repo root [`.claude/CLAUDE.md`](../../../.claude/CLAUDE.md)
