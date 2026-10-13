---
name: agents-is-the-canonical-instruction-file
title: AGENTS.md is the sole current shared instruction source
status: accepted
date: 2026-10-13
deciders: [ItsLucky23]
tags: [docs, ai-context, packaging, upgrades]
supersedes: []
relates: [0016, 0051, 0065]
---

## Context

A vendor-specific canonical contract and a generated shared copy create competing authority. The user requested one shared instruction filename throughout current repository, package and scaffold delivery, while preserving actual tool permissions and customized consumer work.

## Decision

Use hand-maintained `AGENTS.md` as the sole current shared instruction source. Do not regenerate it from a vendor-specific duplicate or ship both as parallel contracts. Tool configuration and command discovery remain governed by the tool's supported parser; changing an instruction filename grants no permissions or settings compatibility.

Older consumers retain ownership of customized legacy instructions. Transition proposals must preserve that content until the developer has reviewed its rules and approved retirement.

## Rejected alternatives

- **Keep both files in sync** — makes a second contract necessary forever and leaves direction/authority ambiguous.
- **Automatically delete legacy consumer files** — can erase application-specific rules the framework does not own.
- **Rename all tool settings to a shared directory** — invents compatibility and can silently disable permission gates.

## Consequences

Every consumer-delivery boundary must prove it uses the canonical instructions and preserves rendered ownership baselines. Stale generated bundles fail rather than silently delivering old contracts. Legacy migration references and frozen historical records are not new instruction sources.
