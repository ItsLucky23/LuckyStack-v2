# Changelog

All notable changes to `@luckystack/devkit` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

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
  whole-shape loss is no longer invisible to it.

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
