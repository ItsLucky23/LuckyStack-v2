---
name: run-seeded-synthetic-apps-nightly
title: Run seeded synthetic applications nightly
status: accepted
date: 2026-07-28
deciders: [mathijs]
tags: [testing, nightly, browser, multiplayer, fuzz]
relates: [0043]
---

## Context

The blocking release matrix validates critical packaging and transport contracts, but a small fixed route set cannot represent realistic page-level workflows. Synthetic admin CRUD and multiplayer interactions add useful breadth, especially across multiple browser contexts and state transitions. Running several variants before every publish would multiply release latency and encourage teams to weaken or skip the gate.

Unseeded randomness is unsuitable for CI because a failure cannot be reproduced reliably.

## Decision

A separate nightly workflow runs real-registry routed consumer acceptance with deterministic seeds. Every seed generates different admin records, drives a full create/list/update/delete/verify page flow, and runs a two-browser multiplayer exchange through routed sync, the owning service, Redis fanout and one Socket.io connection per player.

The critical bounded profiles remain publish-blocking. Synthetic scenarios stay nightly unless a specific regression proves stable, fast and important enough to promote into the publish matrix. Every random value in these scenarios derives from the reported seed.

## Rejected alternatives

- **Add every synthetic seed to the publish gate.** This increases release latency without proportionally improving the critical packaging signal.
- **Use `Math.random()` or current time directly.** Failures become difficult or impossible to reproduce.
- **Mock the router, Redis or browser.** This would miss the cross-process consumer wiring these scenarios are intended to test.
- **Build a large permanent demo application.** It creates product-like maintenance overhead; generated focused fixtures keep the framework contract explicit.

## Consequences

- Nightly CI is heavier and installs Chromium plus candidate packages for multiple seeds.
- Failures include a seed that can be replayed locally.
- Admin state transitions, peer-targeted multiplayer delivery and per-browser socket counts receive recurring coverage.
- The publish gate remains bounded and fast enough to stay mandatory.
