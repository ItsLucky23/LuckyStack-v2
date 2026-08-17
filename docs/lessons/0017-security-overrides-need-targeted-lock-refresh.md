---
name: security-overrides-need-targeted-lock-refresh
title: Security override edits do not necessarily refresh existing transitive lock pins
severity: high
area: package-lock.json
date: 2026-08-17
tags: [npm, security, overrides, lockfile, release]
---

# 0017 — Security override edits do not necessarily refresh existing transitive lock pins

## What happened

The v0.8.4 release gate found newly disclosed high-severity advisories in locked transitive dependencies. A first pass broadened the root `overrides` and ran a regular `npm install`, but `fast-uri`, `ip-address`, Hono, and its Node adapter remained on their vulnerable lockfile versions. The production audit therefore still failed despite the corrected override policy.

## Root cause

Changing a range-scoped npm override does not guarantee that an already-valid transitive package-lock selection is reconsidered. A normal install can preserve that lock pin until the affected package is explicitly updated.

## How to avoid

After changing a security override, inspect the resolved version in `package-lock.json` and rerun both the complete and production audits. If the vulnerable pin remains, use a targeted `npm update <affected packages>` so npm recalculates those transitive selections. Never treat a changed `overrides` block or a zero-exit install as proof that the lockfile is safe.
