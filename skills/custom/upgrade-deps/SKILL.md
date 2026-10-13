---
name: upgrade-deps
description: Plan and verify dependency upgrades while preserving developer changes and authority.
category: tooling
---

# Dependency upgrade

Semver alone does not make patch/minor upgrades safe. Lockfile, peers, platform constraints and reachable behaviour need evidence.

1. Inspect Git status and preserve existing developer work. Use explicit isolation for upgrades when useful; never demand or perform a stash/reset as a shortcut.
2. Identify the installed/target gap and read target release/migration information before claiming its benefits or risks. Use `docs/UPGRADING.md` for LuckyStack packages and keep their release set coherent.
3. Propose a bounded upgrade group and obtain installation approval. Explain major changes individually; do not silently activate optional features.
4. Verify peer/runtime/platform compatibility, targeted regressions and the feature-boundary gate. Do not substitute a live data-modifying suite for unit tests by accident.
5. If verification fails, preserve evidence and explain a scoped rollback plan. Do not restore manifests/lockfiles over pre-existing work or loosen tests.
6. Report applied, failed and skipped upgrades accurately. Publishing/pushing/CI changes need their own scope; a dependency upgrade request is not permission for all three.

Prefer source/installed help to copied command loops, defaults or canned changelog examples. Capture durable decisions only after they become real.
