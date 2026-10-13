# TypeScript Program cache

Type generation and development-time type resolution share a compiler Program because rebuilding it for every route or request is expensive. Initial scans should reuse the same Program; reloads must invalidate it when underlying sources change. Invalidate the runtime alias-resolution cache alongside it, since otherwise a previously resolved alias may describe old source. The loader owns this lifecycle; do not create a second consumer-side cache that survives source updates.

Recursive type expansion needs bounded failure behavior and a visible unresolved symbol diagnostic. Silently emitting a permissive contract would hide a mismatch between TypeScript and runtime validation. Consult the cache and emitter source for exact expansion rules, return shapes and current thresholds instead of copying them into this document.
