---
name: lighthouse
description: Measure approved frontend performance and propose source-backed improvements.
category: audit
---

# Performance audit

Measure a production-equivalent build for deployment conclusions. Development instrumentation, a single score and a chunk filename cannot prove a production bottleneck.

1. Agree on target flows, environment and explicit browser approval. Ask before tool installation or a new long-lived server; use actual runtime URLs.
2. Run the installed performance tool with its current help/configuration. Hold device/network/load conditions stable and repeat enough to expose variation.
3. Correlate observed delays with actual source/bundle evidence when available. Distinguish a measured bottleneck from a speculative code-split suggestion.
4. Report conditions, comparable runs, impact and the minimal verification for a proposed change. Do not promise byte/time savings without evidence or silently apply refactors.
5. Apply only selected fixes, rerun the same assertion and preserve raw traces outside committed source. Capture a requested scan's finite ledger at wrap-up.

Follow `AGENTS.md` and the browser policy. A missing measurement is a skip/blocker, not a green performance result.
