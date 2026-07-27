# Composed preset function collision — 2026-07-27

> Browser acceptance of a real LuckyStack 0.8.1 atomic-monolith consumer.

Last updated: 2026-07-27

| # | Finding | Severity | Status | Since | Resolved | Notes / link |
|---|---------|----------|--------|-------|----------|--------------|
| 1 | Runtime-map composition rejected the intentionally repeated full function registry across disjoint atomic presets, making API/sync requests return 500 | HIGH | fixed | 2026-07-27 | 2026-07-27 | Equivalent function entries are now deduplicated; route collisions and differing function implementations still fail closed. Regression coverage: `packages/server/src/runtimeMapsLoader.test.ts`. Governed by ADR 0042. |
| 2 | Generated production maps are loaded lazily on the first API/sync request, so `/readyz` can be green before a malformed or colliding map fails | MEDIUM | open | 2026-07-27 | — | The Flexbuddy acceptance run advertised healthy before item 1 surfaced on `system/session`. Design boot-time map attestation without breaking custom providers or the documented partial-load behavior. |

## Result

The failure was not duplicate service ownership. Phase-1 generation intentionally emits every injected function into every scoped preset, while v0.8.1 applied the route-ownership collision rule to those shared entries. The corrected merge contract distinguishes equivalent shared function wrappers from actual ownership or implementation drift.

The map loader remains lazy. A separate follow-up must decide whether production boot should eagerly attest all selected maps, and how that interacts with intentionally missing/partially available presets. Until then, readiness proves infrastructure health and provider registration, not successful generated-map resolution.
