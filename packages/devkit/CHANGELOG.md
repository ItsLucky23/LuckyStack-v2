# Changelog

All notable changes to `@luckystack/devkit` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed — BREAKING

- **Route OUTPUT types now describe what the client RECEIVES, not what the handler
  returns.** Everything on an output path crosses the wire as JSON, and JSON has no
  `Date`: `Date.prototype.toJSON()` makes it an ISO string. So `createdAt: Date` was
  a lie TypeScript endorsed — `user.createdAt.getTime()` compiled and threw at
  runtime. Generated outputs now read `createdAt: string`.

  **Migration:** frontend code doing `user.createdAt.getTime()` no longer compiles.
  Parse it instead: `new Date(user.createdAt).getTime()`. That code was already
  broken at runtime; this converts a 3am crash into a red `tsc`. For hand-written
  types that cross the wire, `@luckystack/core` now exports `Jsonify<T>` as the
  type-level mirror (`type ClientUser = Jsonify<User>`).

  Generic `JSON.stringify` rules apply without ORM name lists: a type with
  `toJSON()` becomes its return type (covers `Date`, MikroORM's `Collection`,
  Prisma's `Decimal`); every function-valued property is dropped; an
  `undefined`/function/symbol union makes an object property optional and becomes
  `null` in an array slot. Binary types (`Buffer`, `ArrayBuffer`, typed arrays,
  Blob/File) now abort generation with an actionable error because HTTP JSON and
  Socket.io binary transport produce incompatible shapes.

  Wire-safe **INPUTS remain unprojected** because their text feeds the fail-closed
  runtime validator. A `Date` input annotation is now rejected during generation:
  JSON delivers an ISO string, so keeping `Date` would make the handler contract
  lie. Declare `string`, validate it, then convert explicitly.

  This also means a route returning an ORM entity no longer aborts generation: the
  projection never walks into `EntityProperty`/`EntityMetadata`, because those do not
  survive serialization. Measured on a real MikroORM entity: 44,000 chars with 5
  unresolved symbols before, 149 chars with 0 after — matching what
  `JSON.stringify` actually produces, field for field.

### Fixed

- Inferred function-injection values containing checker-owned
  `typeof import("C:/absolute/path")` types now emit a portable type query back
  to the consumer's exported value. This prevents Drizzle's schema-parameterized
  SQLite client from becoming malformed generated TypeScript on the second
  artifact generation.
- Prisma outputs containing a `JsonValue` field no longer collapse the entire
  model (including nested relations) to `JsonValue`; JSON-type recognition now
  matches the type itself instead of any mention inside its rendered object.
  Real Prisma `Result.GetResult`, Drizzle relational-query, and populated
  MikroORM `EntityDTO<Loaded<...>>` graphs now pin three-level Date projection.

Codegen fixes surfaced by a MikroORM/MongoDB consumer (verified against a real
MikroORM project + `tsc`); consumers can drop the corresponding
`node_modules/@luckystack/devkit/dist` patches once on this version.

- **DEVKIT-1** — a route returning a MikroORM entity no longer corrupts
  `apiTypes.generated.ts`. Symbol-keyed entity members (`[OptionalProps]`,
  `[loadedType]`, `[selectedType]`) serialize as the invalid identifier
  `__@<name>@<id>`; they are now dropped from the inlined type (skipped in
  `expandTypeDetailed`, plus a brace-aware content-level safety net for the
  cycle/depth `typeToString` fallback paths).
- **DEVKIT-2** — `SessionLayout` used to sit on an internal whitelist that kept
  the identifier without ever emitting its import, tripping the unresolved-type
  validator. It now runs through normal import collection, like `AuthProps`.
- **DEVKIT-3** — the per-route error arm lists its real fields explicitly
  (`message?`, `errorParams?`, `httpStatus?`) alongside the `[key: string]:
  unknown` index signature, so `res.errorParams` narrows to its type after a
  status check instead of collapsing to `unknown`.
- **DEVKIT-4** — a route that hands its stream emitter to a helper (no literal
  `stream(...)` call in `main`) now infers the payload type from the declared
  `stream: ApiStreamEmitter<T>` on `ApiParams` instead of degrading to `never`.
- **DEVKIT-5** — private helper subtrees under a marker (`_api/_lib/*`,
  `_sync/_lib/__tests__/*`) are skipped by route-naming validation + discovery
  instead of being flagged as invalid route files.
- **DEVKIT-6** — `expandTypeDetailed` no longer throws on a tuple type, so a
  route returning a MikroORM entity keeps its real payload shape instead of
  silently degrading to `{ status: string }`. The tuple branch tested the
  *instance* for `ObjectFlags.Tuple`, but TypeScript puts that flag on the
  tuple's *target* (only the empty tuple `[]` is its own target) — so every
  non-empty tuple fell through to an unguarded `type.symbol.name` read and threw
  `TypeError: Cannot read properties of undefined (reading 'name')`.
  `extractors.ts` caught it, so the entire `result` shape was lost with only a
  `console.error` to show for it. MikroORM's
  `EntityProperty.embedded?: [string, string]` made every entity-returning route
  hit this. The branch now tests the target, and the symbol read is
  optional-chained to match the existing guards.
  **Note:** a route that leaks an ORM entity into its payload will now surface
  MikroORM's own types (`EntityProperty`, `EntityMetadata`, …) as unresolved
  symbols, which `generateTypeMapFile()` reports as a hard abort. That is the
  intended posture (DD-DEVKIT-D1: never silent) — the fix is to return a plain
  DTO from the route rather than the entity.

### Added

- **Extraction failures are now a first-class diagnostics reason.** A type
  extraction that THREW is reported in `apiTypeDiagnostics.generated.json` as
  `reason: 'extraction-error'`, with the thrown message in a new optional
  `detail` field, instead of being indistinguishable from a route that simply
  declares no shape (both previously emitted `default-fallback`). Per
  DD-DEVKIT-D3 a CI gate can fail on a non-zero `fallbackCount`, so a
  whole-shape loss is no longer invisible to it. API `stream` and sync
  `serverStream` / `clientStream` fields now use the same diagnostics seam; a
  thrown stream extraction can no longer hide behind the legitimate `never`
  default.

### Changed

- **`DEPTH_LIMIT` raised from 12 to 14** in the type inliner. Measured, not
  guessed: 14 fully exhausts the deepest real graph we have (a decorator-based
  MikroORM entity: `BaseEntity` + `Collection` + a `ManyToOne` cycle) with zero
  depth bailouts in ~3ms, and a limit of 30 traverses identically — it is the
  cycle guard, not the depth limit, that bounds the walk. At 12 that graph was
  truncated in 491 places. Raising it also *shrinks* the emitted text (a
  truncated node is re-rendered verbosely by `checker.typeToString`). Every
  route type in this repo is byte-identical before and after.

## [0.1.0]

### Added

- Initial public release as part of the LuckyStack package split.
