---
name: gate-publication-on-real-registry-consumer-acceptance
title: Gate publication on real-registry consumer acceptance
status: accepted
date: 2026-07-28
deciders: [mathijs]
tags: [release, testing, verdaccio, upgrades, browser]
relates: [0021, 0025, 0027, 0037]
---

## Context

Package-unit tests, workspace builds and `file:` consumer fixtures do not exercise normal semver resolution, packed npm contents, scaffold installation, consumer bootstrap files or upgrade transitions. The routed HTTP method-map regression and the generated-preset production import regression both passed the existing release checks because no browser invoked a built, registry-installed split-service consumer.

A release must also remain safe for existing applications. Testing only a fresh scaffold cannot prove that `luckystack update` and `luckystack update --app` preserve consumer edits, deliver candidate sidecars and produce a working upgraded runtime.

## Decision

The publish workflow blocks on a consumer-acceptance matrix before npm publication. Candidate packages are built and published to an isolated local Verdaccio registry, then installed through ordinary semver resolution.

The blocking matrix covers bounded representative profiles rather than every Cartesian combination: a minimal fresh monolith, a broad package-enabled fresh scaffold, a fresh routed split deployment and an N-1 routed upgrade. Routed lanes launch two production backend presets, the router, Redis, Vite and Chromium. They verify adversarial explicit GET/POST/PUT/DELETE routes, routed sync fanout, `ignoreSelf` suppression, exactly one Socket.io WebSocket and successful owning-service execution.

The upgrade lane scaffolds the previous stable npm release from the public registry, installs the candidate from Verdaccio, runs both update scopes, proves a modified framework-owned file is preserved with a candidate `.new` sidecar, accepts that sidecar in the disposable fixture, then runs the same build and browser checks.

## Rejected alternatives

- **Rely on workspace/unit tests and package builds.** They cannot detect missing packed files, consumer bootstrap omissions or production-bundle dynamic-import mismatches.
- **Use `file:` dependencies or npm overrides.** They bypass the registry and semver path used by real consumers.
- **Test only fresh scaffolds.** This leaves update manifests, overwrite-if-pristine behavior and sidecar safety unverified.
- **Run consumer acceptance after npm publication.** npm artifacts are immutable; discovering a failure then requires another release rather than preventing the bad release.
- **Run the full database/package Cartesian matrix on every release.** It is too large and slow for a blocking gate; representative profiles block publication while broader provider matrices can run separately.

## Consequences

- Publishing waits for all consumer profiles to pass.
- Release CI is slower and requires Redis plus Chromium in routed lanes.
- Regressions in packed artifacts, scaffolding, upgrades, explicit routed methods, production preset loading and realtime fanout fail before npm receives immutable packages.
- New critical consumer wiring must be added to this matrix rather than covered only by workspace tests.
