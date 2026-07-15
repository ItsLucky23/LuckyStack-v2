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
| **T11** | **🔴 THE REAL BUG (found 2026-07-15 by empirical repro): `expandTypeDetailed` THROWS.** `TypeError: Cannot read properties of undefined (reading 'name')` at `tsProgram.ts:322`, at **depth 6**, via `root.result.owner.items.property.embedded`. MikroORM's `EntityProperty.embedded?: [string, string]` is a **tuple reference**: `:283` tests the *instance* for `ObjectFlags.Tuple` → false (only the *target* carries it) → tuple branch dead; `:294` Reference branch → tuple target has **no symbol** → `targetName === ''` → not `Array`, not in `SKIP_EXPANSION` → falls through; `:322` reads `type.symbol.name` with **no optional chaining** (unlike `:60` and `:297`) → throws. **`extractors.ts` catches it**, so a route returning a MikroORM entity silently degrades to `{ status: string }` with one `console.error` — the entire `result` shape is lost — and `apiTypeDiagnostics.generated.json` does **NOT** flag it (it only tracks `getSourceFile` misses + zod-any fallbacks). **`DEPTH_LIMIT` is never reached.** This, not depth, is what the "55 routes" consumer is hitting. | **HIGH** | open | 2026-07-15 | — | Repro: `packages/devkit/src/typeMap/__fixtures__/mikroEntities.ts` + `extractorsMikro.test.ts` |
| T4 | ~~`DEPTH_LIMIT` is the corruption trigger, not the guard.~~ **REFUTED empirically.** **0 of 534 bailouts leak a `__@` marker.** `checker.typeToString` does NOT serialize symbol-keyed members verbatim: a **named** type renders as its name (`FixtureOwner`), never structurally — even with `InTypeAlias\|NoTruncation`; a symbol key renders as valid `[Symbol.iterator]` syntax, never `__@`. The `__@<name>@<id>` form is the *internal escaped name* (`symbol.getName()`), printable **only** by the structural path at `:353` — which `:341` already skips. **Consequence: `stripSymbolKeyedMembers`'s own comment (`emitterArtifacts.ts:114-119`), which blames "the typeToString FALLBACKS (cycle detection + depth limit)", is factually WRONG.** The helper is harmless belt-and-braces. Do not "fix" `DEPTH_LIMIT` expecting markers to appear. | — | **false-positive** | 2026-07-15 | 2026-07-15 | This was MY inference, stated with unwarranted confidence and propagated into the plan. The repro killed it |
| T5 | **Cycle guard is path-scoped, not global** (`stackTypeIds.delete` in the `finally` at `:379-383`); no memo cache → a type reached via a sibling branch re-expands from scratch. | MED | open | 2026-07-15 | — | Real, but the measured cost is modest (2,491→2,930 nodes, ~3ms) — not the "exponential" I claimed |
| T6 | **`zodEmitter.ts:111-112` maps `Date` → `z.date()`**, which rejects strings — contradicting the docs generator (T3) which says Date-on-wire is a string. Both ship from `@luckystack/devkit`; Zod's is fail-closed. **Latent** (zero `z.date()` in `apiInputSchemas.generated.ts` — no route takes a `Date` input), but any consumer typing `data: { from: Date }` gets a route that rejects all valid input. | MED | open | 2026-07-15 | — | Fixed for free by the projection (`z.iso.datetime()`) |
| T7 | **No ORM wrapper is skipped** — `SKIP_EXPANSION` (`tsProgram.ts:53-56`) has no `Collection`/`Reference`/`EntityManager`. **CONFIRMED.** But the two specifics I attached to it are **REFUTED by measurement**: (a) **`Collection` has NO `_em` property** — the deep chain is `Collection.property → EntityProperty.customType → Type.meta → EntityMetadata → indexes[]/properties[]`; (b) **"12 is off by an order of magnitude" is wrong — it is off by 2.** Measured: limit 12 → 491 depth-bailouts, maxDepth 13, 2,491 nodes; **limit 14 → 0 depth-bailouts**, 2,930 nodes, ~3ms; limit 30 → identical to 14. The graph is finite and shallow. **The cycle guard (43 bailouts, genuine entity cycle at depth 7), not the depth limit, is what bounds traversal.** | MED | open | 2026-07-15 | — | Measured on a test-local depth model pinned by a test asserting it agrees with the real expander (`DEPTH_LIMIT` is a module-local const, not injectable) |
| T8 | **The shipped MikroORM starter cannot reproduce the bug.** `create-luckystack-app/src/index.ts:2701-2717` uses `EntitySchema<Item>` over a plain 3-scalar interface (deliberate, per the comment at `:2653-2654`) — depth 1, no symbol keys, no cycles. The generic is phantom. **The "55 routes" consumer is therefore on the decorator/`BaseEntity` path**, not our starter. | MED | open | 2026-07-15 | — | `stripSymbolKeyedMembers.test.ts:23,32,43` contains *real* downstream checker output (`isFullyCached\|recordCount`, type-IDs 1255/1542) — someone had the reproduction in hand |
| T9 | **Named-type-graph proposal REJECTED as primary fix** (the approach I proposed before this investigation). Two false premises: the generated file is **already not import-free** (`emitterArtifacts.ts:76-91` emits real imports), and **`DEPTH_LIMIT` would stay anyway** because every route output is an anonymous literal (`__object`, rejected at `tsProgram.ts:179`) — only *nested* entities are nameable. **Fatal blocker:** `expandTypeDetailed` is shared with `inputType` → `validateInputByType`; a named ref in prod (`runtimeTypeValidation.ts:476-482`, fail-closed, no resolver) ⇒ **every request to that route rejected**. | — | false-positive | 2026-07-15 | 2026-07-15 | Not a defect — a rejected design. Recorded so it isn't re-proposed |
| T10 | **`tsProgram.ts` has NO test file** — the file any fix must change is the one with no safety net. | MED | **fixed** | 2026-07-15 | 2026-07-15 | Now 22 tests (`tsProgram.test.ts`) + 3 (`extractorsMikro.test.ts`) + a 6-case golden-file baseline over this repo's routes (`goldenRouteTypes.test.ts` + snapshot) + a decorator MikroORM fixture. The baseline LOCKS IN current behaviour incl. the wrong `createdAt: Date`, so a fix produces an intentional diff. Full suite green (1714) |
| T12 | **Dead code found during the repro (report-only): the tuple branch at `tsProgram.ts:283` never fires.** It tests the *instance* for `ObjectFlags.Tuple`, but only the *target* carries that flag. This is what lets a tuple reference fall through to the unguarded `:322`. | LOW | open | 2026-07-15 | — | Root cause of T11 |
| T13 | **`tsconfig.server.json` globs `packages/devkit/src/**/*` without `experimentalDecorators`**, so the decorator fixture triggers 7× TS1240 and breaks `tsc -b`. Mitigated in-scope with `// @ts-nocheck` (suppresses *reporting* only — the checker still computes every type, so the repro is unaffected). **Proper fix: `exclude` `__fixtures__/**` in `tsconfig.server.json` + `packages/devkit/tsconfig.json`, then drop the directive.** Precedent: `page_*.template.tsx`. | LOW | open | 2026-07-15 | — | Verified: the fixture type-checks exit 0 with the directive stripped |

## Recommendation (agent's, endorsed)

**Wire projection — model what crosses the wire, not the live ORM entity.** One rule (*"what does `JSON.stringify` do to this?"*) replaces `JSON_TYPE_NAMES`, the Prisma special-casing in `functionsMeta.ts:45-48`, and `Date`-in-`SKIP_EXPANSION`. It fixes MikroORM **by construction** (symbol keys are definitionally non-serializable; `Collection._em`'s cycle is unreachable because the projection stops at the first non-serializable node) and fixes T1/T2/T6 for free — and it makes the generator genuinely ORM-agnostic (Drizzle/TypeORM/Kysely need no new cases).

**The answer to "can we drop DEPTH_LIMIT and always resolve the whole tree" is: you don't want to.** The projection makes the tree *smaller*, not deeper — the remaining depth is the user's actual data shape, which is shallow and finite.

### Staged plan — REVISED 2026-07-15 after the empirical repro

The original step 1 ("apply the `__@` filter inside the two bailout paths") is **deleted: there
is no leak to fix** (T4 refuted). The real bug is a crash, and it is cheaper to fix than
anything previously planned.

| Step | Change | Risk |
|---|---|---|
| **1** | **Fix the throw at `tsProgram.ts:322`** — optional-chain the symbol read (matching `:60` and `:297`) and/or repair the dead tuple branch at `:283` to test the *target*'s `ObjectFlags.Tuple` (T12). **This alone stops MikroORM routes from silently degrading to `{ status: string }` and very likely resolves the consumer's 55 routes.** Ships alone. | low |
| **2** | **Make the silent catch visible.** `extractors.ts` swallows the throw into a `console.error` + default fallback, and `apiTypeDiagnostics.generated.json` does not record it — so a whole-shape loss is invisible to the DD-DEVKIT-D3 CI gate. An extraction that *threw* must be a first-class diagnostics reason. | low |
| **3** | **`DEPTH_LIMIT` 12 → 14.** Measured, not guessed: 14 exhausts the graph (0 depth-bailouts) in ~3ms with <2× node growth, and 30 is identical to 14. The cycle guard does the real bounding. | low |
| **4** | Build the **wire projection** as an opt-in expansion mode. Still the right architectural fix — it makes the generator ORM-agnostic and kills the `Date` lie — and it subsumes steps 1-3 by never traversing into `Collection`/`EntityProperty` at all (they don't survive `JSON.stringify`). But it is no longer the *urgent* fix. | medium |
| **5** | Flip the projection default, `Date`→`string` in the CHANGELOG as breaking. **Pending user decision:** default-on-with-opt-out in 0.7.0 (recommended — the current default is a type that lies and crashes at runtime, and the change surfaces as compile errors) vs. opt-in-until-1.0. | breaking |

**Hard constraint (the single most important one):** the projection must be confined to **outputs**. Inputs must keep inlining — see T9's fail-closed prod validator. Do not touch `runtimeTypeResolver.ts`, `runtimeTypeValidation.ts`, or the `@luckystack/api` validation stages.

**Known-awkward edge:** `Buffer` is **transport-asymmetric** — it survives socket.io (binary attachment via `is-binary.js`) but degrades to `{type:'Buffer',data:[]}` over HTTP. A strictly-accurate projection must be transport-aware or conservatively model it as degraded. `BigInt` should become a **generation-time error** (the encoder throws at runtime) — that's a feature.

## Open questions / uncertainty

- **The 55-route consumer would NOT show up in their `apiTypeDiagnostics.generated.json`** — that
  was my earlier suggestion and T11 invalidates it: the throw is swallowed by `extractors.ts` and
  never recorded as a diagnostic. Ask them instead for their **codegen console output** (the
  `console.error` lines) or simply check whether their degraded routes all return `{ status: string }`.
  Step 2 of the plan exists precisely to close this blind spot.
- **Not traced:** whether `server/prod/runtimeMaps.ts` sources `inputType` from the generated file
  rather than the extractor. If it does, the input-side blast radius is larger than described.
- `Decimal`/`BigInt` behaviour is reasoned from the quoted serializer, not observed running.
- The depth measurements come from a **test-local depth model**, because `DEPTH_LIMIT` is a
  module-local const and not injectable. Its fidelity is pinned by a test asserting it agrees with
  the real expander — but it is a model, not the shipped code path.

## Lessons for the next reader

This folder is a record of **confident inference being wrong in almost every specific while
pointing at a real bug**. The direction ("MikroORM type extraction is badly broken") held. The
mechanism (`__@` leak via bailouts, `Collection._em`, depth off by 10×, `DEPTH_LIMIT` as trigger)
was wrong on every count, and the true cause — an unguarded `type.symbol.name` on a tuple
reference — was simpler, cheaper to fix, and more damaging than anything hypothesised. What
settled it was installing `@mikro-orm` and running the real extractor over a real decorator
entity. **Nothing here was decidable by reading code.**
