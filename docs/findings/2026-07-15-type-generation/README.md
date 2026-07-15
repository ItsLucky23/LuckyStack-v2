# Type-generation: wire-type lie + ORM degradation — 2026-07-15

> AI findings ledger. Status of every item is tracked here (Findings Protocol).
> Scope: `@luckystack/devkit` type-map generation (`expandTypeDetailed`, extractors, emitter, zodEmitter) + the generated artifacts + the consumer session path · Tool/agents: 1 deep read-only investigation agent, key claims hand-verified · Supersedes: —

Last updated: 2026-07-15

**Headline:** the generator inlines the *server-side* return type, but the client receives *JSON*. `Date` is emitted as `Date` while an ISO `string` arrives. This is **not theoretical — it is live in this repo** (`system/session@v1`), and the lie is already true **server-side** because sessions round-trip through Redis as JSON. Separately, `DEPTH_LIMIT` is not the guard against MikroORM corruption — it is the **trigger** for it.

| # | Finding | Severity | Status | Since | Resolved | Notes / link |
|---|---------|----------|--------|-------|----------|--------------|
| T1 | **Live wire-type lie**: `system/session@v1` emits `createdAt: Date` / `lastLogin: null \| Date`, but the client receives an ISO `string` (socket.io default parser → `JSON.stringify` → `Date.prototype.toJSON`). `apiRequest.ts:591` `resolve(response as RequestOutput)` mints the lie. Hand-verified in `src/_sockets/apiTypes.generated.ts:780-782`. | HIGH | open | 2026-07-15 | — | No serialization projection exists repo-wide (`Jsonify\|toJSON\|superjson\|devalue` → 0 hits) |
| T2 | **The lie is already true server-side**: sessions persist via `session.ts:162` `setRaw(token, JSON.stringify(...))` and re-read at `:29-32` where `isSessionLayout` only checks `'id' in value`. So `user.createdAt` is typed `Date` but **is a `string` at runtime inside API handlers** — `user.createdAt.getTime()` throws. | HIGH | open | 2026-07-15 | — | `SessionLayout extends Omit<User,'password'>` (`config.ts:318`); Prisma declares `DateTime` |
| T3 | **The codebase already knows** — three independent workarounds: `config.ts:328-329` (author blocked by TS from widening `lastLogin`, widened only the non-Prisma `previousLogin` at `:331`); `src/docs/page.tsx:165` hardcodes `Date`→`toISOString()`; every timestamp route hand-writes `new Date().toISOString()`. `session_v1` is the only route that passes through an object it didn't construct — and the only one with the bug. | MED | open | 2026-07-15 | — | `packages/core/src/sessionTypes.ts:44` models it correctly as `Date \| string \| null`; the project type re-narrows it |
| T4 | **`DEPTH_LIMIT` is the corruption trigger, not the guard.** The `__@` symbol-key skip (`tsProgram.ts:341`) runs **only on the structural path**; both bailouts (`:211-219` cycle, `:222-227` depth) call `checker.typeToString(type)`, which serializes symbol keys **verbatim, ignoring the skip**. `stripSymbolKeyedMembers` is a text-level mop for a structural leak. | HIGH | open | 2026-07-15 | — | Already documented in `emitterArtifacts.ts:114-119` — the leak was known, the cause was not named |
| T5 | **Cycle guard is path-scoped, not global** (`stackTypeIds.delete` in the `finally` at `:379-383`); no memo cache → a type reached via a sibling branch re-expands from scratch → **exponential in breadth**. | MED | open | 2026-07-15 | — | Amplifies T4 |
| T6 | **`zodEmitter.ts:111-112` maps `Date` → `z.date()`**, which rejects strings — contradicting the docs generator (T3) which says Date-on-wire is a string. Both ship from `@luckystack/devkit`; Zod's is fail-closed. **Latent** (zero `z.date()` in `apiInputSchemas.generated.ts` — no route takes a `Date` input), but any consumer typing `data: { from: Date }` gets a route that rejects all valid input. | MED | open | 2026-07-15 | — | Fixed for free by the projection (`z.iso.datetime()`) |
| T7 | **No ORM wrapper is skipped**: `SKIP_EXPANSION` (`tsProgram.ts:53-56`) lists `Promise, Map, WeakMap, Set, WeakSet, Error, Date, RegExp, Buffer, ArrayBuffer, ReadonlyArray` — no `Collection`, `Reference`, `Ref`, `EntityManager`, `EntityRepository`. So `Collection<Post>` is **fully expanded** via `getPropertiesOfType`, and `Collection._em: EntityManager` drags in `Configuration → MikroORMOptions → driver → platform → connection → pool → pg/mysql2 .d.ts`. **12 isn't slightly low — it's off by an order of magnitude, and raising it makes things worse.** | HIGH | open | 2026-07-15 | — | ⚠️ **Inference, not verified**: `@mikro-orm` is NOT installed in this repo (`grep -c mikro package-lock.json` → 0) |
| T8 | **The shipped MikroORM starter cannot reproduce the bug.** `create-luckystack-app/src/index.ts:2701-2717` uses `EntitySchema<Item>` over a plain 3-scalar interface (deliberate, per the comment at `:2653-2654`) — depth 1, no symbol keys, no cycles. The generic is phantom. **The "55 routes" consumer is therefore on the decorator/`BaseEntity` path**, not our starter. | MED | open | 2026-07-15 | — | `stripSymbolKeyedMembers.test.ts:23,32,43` contains *real* downstream checker output (`isFullyCached\|recordCount`, type-IDs 1255/1542) — someone had the reproduction in hand |
| T9 | **Named-type-graph proposal REJECTED as primary fix** (the approach I proposed before this investigation). Two false premises: the generated file is **already not import-free** (`emitterArtifacts.ts:76-91` emits real imports), and **`DEPTH_LIMIT` would stay anyway** because every route output is an anonymous literal (`__object`, rejected at `tsProgram.ts:179`) — only *nested* entities are nameable. **Fatal blocker:** `expandTypeDetailed` is shared with `inputType` → `validateInputByType`; a named ref in prod (`runtimeTypeValidation.ts:476-482`, fail-closed, no resolver) ⇒ **every request to that route rejected**. | — | false-positive | 2026-07-15 | 2026-07-15 | Not a defect — a rejected design. Recorded so it isn't re-proposed |
| T10 | **`tsProgram.ts` has NO test file** — the file any fix must change is the one with no safety net. ~41 tests exist elsewhere in `typeMap/` (`routeMeta` 20, `apiMeta` 8, `stripSymbolKeyedMembers` 7, `functionsMeta` 6). | MED | open | 2026-07-15 | — | Write a golden-file test over this repo's 25 routes **before** touching the inliner |

## Recommendation (agent's, endorsed)

**Wire projection — model what crosses the wire, not the live ORM entity.** One rule (*"what does `JSON.stringify` do to this?"*) replaces `JSON_TYPE_NAMES`, the Prisma special-casing in `functionsMeta.ts:45-48`, and `Date`-in-`SKIP_EXPANSION`. It fixes MikroORM **by construction** (symbol keys are definitionally non-serializable; `Collection._em`'s cycle is unreachable because the projection stops at the first non-serializable node) and fixes T1/T2/T6 for free — and it makes the generator genuinely ORM-agnostic (Drizzle/TypeORM/Kysely need no new cases).

**The answer to "can we drop DEPTH_LIMIT and always resolve the whole tree" is: you don't want to.** The projection makes the tree *smaller*, not deeper — the remaining depth is the user's actual data shape, which is shallow and finite.

### Staged plan

| Step | Change | Risk |
|---|---|---|
| 1 | **Fix the leak**: apply the `__@` filter *inside* the two bailout paths (`tsProgram.ts:211-219`, `:222-227`), not just the structural path. Ships alone, zero behavior change for anyone healthy. **Worth doing regardless of 2-4.** | low |
| 2 | Add `Collection`/`Reference`/`Ref`/`Loaded`/`EntityManager`/`EntityRepository` to `SKIP_EXPANSION`. Tactical, ORM-specific, contradicts the ORM-agnostic goal — **only if the consumer needs relief before step 3.** Stopgap with an expiry. | low |
| 3 | Build the projection as an **opt-in expansion mode**, default **off**. Emit both texts; diff against this repo (`session_v1` flips `Date`→`string`, rest byte-identical). | medium |
| 4 | Flip the default **in a major**, `Date`→`string` in the CHANGELOG as breaking. **Only then** delete `DEPTH_LIMIT` + the cycle fallback. | breaking |

**Hard constraint (the single most important one):** the projection must be confined to **outputs**. Inputs must keep inlining — see T9's fail-closed prod validator. Do not touch `runtimeTypeResolver.ts`, `runtimeTypeValidation.ts`, or the `@luckystack/api` validation stages.

**Known-awkward edge:** `Buffer` is **transport-asymmetric** — it survives socket.io (binary attachment via `is-binary.js`) but degrades to `{type:'Buffer',data:[]}` over HTTP. A strictly-accurate projection must be transport-aware or conservatively model it as degraded. `BigInt` should become a **generation-time error** (the encoder throws at runtime) — that's a feature.

## Open questions / uncertainty

- **T7's depth ladder is inference** — `@mikro-orm` isn't installed here. Confirm against `@mikro-orm/core@6.6.14` before acting on step 2.
- **The 55-route consumer is unexplained in specifics.** The mechanism is established; their code was never seen. **Asking them for their `apiTypeDiagnostics.generated.json` would confirm it in seconds** — do this before committing to a fix.
- **Not traced:** whether `server/prod/runtimeMaps.ts` sources `inputType` from the generated file rather than the extractor. If it does, the input-side blast radius is larger than described.
- `Decimal`/`BigInt` behaviour is reasoned from the quoted serializer, not observed running.
