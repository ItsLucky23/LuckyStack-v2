# Branch log — perf/devkit-checker-memo

## 2026-11-23 11:40 — Memoize the server checker's repeated queries (devkit 0.17.1)

**User prompt (summary):** speed up `generateTypeMaps` / `generateServerRequests` (consumer with 330 API and 57 sync routes: ~19 s locally, ~55 s in CI; ~70 % waiting on synchronous IPC to tsgo, mostly repeated `typeToString`, `getPropertyOfType`, `getTypeOfSymbol`, plus unused `getSymbolsInScope` calls). Memoize the three calls per checker, attach the memo in `getServerProgram`, skip the scope query without candidate names, add a golden test and a rebuild test, publish 0.17.1.

**What I did:**
- `memoizeChecker` wraps the server checker in a Proxy that caches the three answers on `Type`/`Symbol` object identity (plus the property name). `typeToString` with a location or flags and the batch form of `getTypeOfSymbol` bypass the cache. `getServerProgram` returns a Project view with that checker, so `invalidateProgramCache()` drops Program and memo together.
- Devkit never called `checker.getPropertyOfType`: the ~45k requests came from `type.getProperty('toJSON')` in the wire projection, which goes through the library's object registry and bypassed any checker wrapper. That call now uses `checker.getPropertyOfType` (the same compiler request), so the memo applies.
- `collectFallbackSymbolsFromTypeText` returns `[]` before `getSymbolsInScope` when no candidate name exists.
- Test with a temp fixture: full generation with and without the memo is byte-identical (diagnostics without `generatedAt`); after editing a shared file and invalidating, the route type shows the new field and the checker is a new object. Mutation checks: a property memo keyed only on the name, a symbol memo keyed on the name and a memo kept across Programs each fail the test.

**Files touched:** `packages/devkit/src/typeMap/{checkerMemo.ts,checkerMemo.test.ts,tsApi.ts,extractors.ts,tsProgram.ts}`, `packages/devkit/CHANGELOG.md`.

**Notes / decisions:**
- This repo (20 API + 5 sync routes), `generateTypeMaps.ts` incl. tsx start: main 6.3 s (2 runs), branch 2.8–3.8 s; the three generated files byte-identical, diagnostics differ only in `generatedAt`.
- Not measured here: the consumer project; the numbers in the CHANGELOG come from the user's reference patch on the 0.17.0 dist.
