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

## [0.1.0]

### Added

- Initial public release as part of the LuckyStack package split.
