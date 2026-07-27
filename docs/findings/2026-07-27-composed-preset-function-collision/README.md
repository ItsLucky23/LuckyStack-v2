# Composed preset function collision — 2026-07-27

> Browser acceptance of a real LuckyStack 0.8.1 atomic-monolith consumer.

Last updated: 2026-07-27

| # | Finding | Severity | Status | Since | Resolved | Notes / link |
|---|---------|----------|--------|-------|----------|--------------|
| 1 | Runtime-map composition rejected the intentionally repeated full function registry across disjoint atomic presets, making API/sync requests return 500 | HIGH | fixed | 2026-07-27 | 2026-07-27 | Equivalent function entries are now deduplicated; route collisions and differing function implementations still fail closed. Regression coverage: `packages/server/src/runtimeMapsLoader.test.ts`. Governed by ADR 0042. |

## Result

The failure was not duplicate service ownership. Phase-1 generation intentionally emits every injected function into every scoped preset, while v0.8.1 applied the route-ownership collision rule to those shared entries. The corrected merge contract distinguishes equivalent shared function wrappers from actual ownership or implementation drift.
