# TypeScript Program cache

Type generation and development-time type resolution share a compiler Program because rebuilding it for every route or request is expensive. Initial scans should reuse the same Program; reloads must invalidate it when underlying sources change. Invalidate the runtime alias-resolution cache alongside it, since otherwise a previously resolved alias may describe old source. The loader owns this lifecycle; do not create a second consumer-side cache that survives source updates.

The compiler is TypeScript 7, which runs as a separate native process rather than inside Node. One module owns that process for parsing, transpiling and the Program, so a generation run starts at most one. Whoever starts a bounded piece of work, such as a generation run or a test file, stops the process when the work ends, including on error. Otherwise an idle compiler outlives the work and holds its memory. Do not open a second API instance beside it: each one is another process holding its own copy of the Program.

Recursive type expansion needs bounded failure behavior and a visible unresolved symbol diagnostic. Silently emitting a permissive contract would hide a mismatch between TypeScript and runtime validation. Consult the cache and emitter source for exact expansion rules, return shapes and current thresholds instead of copying them into this document.
